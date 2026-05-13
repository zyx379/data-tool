import { DeepSeekClient, parseToolCalls, createToolResultMessage, ChatCompletionResponse } from './deepseek';
import { executeTool, buildToolPrompt, ToolExecutionContext } from './tools';
import { buildSimpleLogDisplay } from './tools/queryLog';
import {
  ConversationMessage,
  ToolCall,
  AnalysisStepData,
  StepCallback,
  AnalysisRequest,
  ServiceIdentification,
  RepositoryMatchResult,
  VersionAndCodeResult,
  ToolResult,
} from './types';
import { SYSTEM_PROMPT, SERVICE_IDENTIFY_PROMPT, DEEP_ANALYSIS_PROMPT } from './config';
import {
  getProjectConfig,
  getCodeRepositoriesByProjectId,
  matchCodeRepository,
  inferBranchFromTag,
  getGlobalConfig,
} from '../database/sqlite';
import { getFirstTokenFromRedis, RedisConfig } from '../redis';
import { ApiClient } from '../api-client';
import { getCode } from './tools/gitLab';

export class HISAnalysisAgent {
  private deepseekClient: DeepSeekClient;
  private maxIterations = 10;
  private callback: StepCallback | null = null;
  private context: ToolExecutionContext | null = null;

  constructor() {
    this.deepseekClient = new DeepSeekClient();
  }

  async runStepByStep(request: AnalysisRequest, callback: StepCallback): Promise<void> {
    this.callback = callback;

    // 从全局配置读取 AI 设置
    const globalConfig = getGlobalConfig();
    const aiApiKey = globalConfig?.deepseekApiKey || '';
    const aiBaseUrl = globalConfig?.deepseekBaseUrl || undefined;
    const aiModel = globalConfig?.deepseekModel || 'deepseek-chat';

    if (!aiApiKey) {
      callback.onStepError('query_log', '未配置 DeepSeek API Key，请在「全局设置」中配置');
      return;
    }

    this.deepseekClient = new DeepSeekClient({
      apiKey: aiApiKey,
      baseUrl: aiBaseUrl,
      model: aiModel,
    });

    const projectConfig = getProjectConfig(request.projectId);
    const apiBaseUrl = request.apiBaseUrl || projectConfig?.apiBaseUrl;
    const apiLogPath = request.apiLogPath || projectConfig?.apiLogPath;
    const apiVersionPath = request.apiVersionPath || projectConfig?.apiVersionPath;
    const apiTokenPath = request.apiTokenPath || projectConfig?.apiTokenPath;

    let apiToken = request.apiToken;
    if (!apiToken && projectConfig?.redisHost && projectConfig?.redisPort) {
      try {
        const redisConfig: RedisConfig = {
          host: projectConfig.redisHost!,
          port: projectConfig.redisPort!,
          password: projectConfig.redisPassword || undefined,
          db: projectConfig.redisDb || undefined,
        };
        apiToken = await getFirstTokenFromRedis(redisConfig) ?? undefined;
      } catch (e) {
        console.error('获取Redis Token失败:', e);
      }
    }

    this.context = {
      projectId: request.projectId,
      apiBaseUrl,
      apiToken,
      apiLogPath,
      apiTokenPath,
      apiVersionPath,
      logId: request.logId,
    };

    const conversation: ConversationMessage[] = [];
    conversation.push({
      role: 'user',
      content: `问题描述: ${request.description}\n日志ID: ${request.logId}`,
    });

    let logResult: ToolResult | null = null;
    let serviceIdentification: ServiceIdentification | null = null;
    let repositoryMatch: RepositoryMatchResult | null = null;
    let versionAndCode: VersionAndCodeResult | null = null;

    try {
      // ===== 步骤1: 查询日志 =====
      const step1 = this.createStepData('query_log', '🔍 步骤 1：查询日志');
      callback.onStepStart('query_log');
      callback.onStepUpdate({ ...step1, status: 'loading' });

      logResult = await executeTool('query_log', { logId: request.logId }, this.context);

      if (!logResult.success) {
        const errorMsg = logResult.error || '日志查询失败';
        callback.onStepError('query_log', errorMsg);
        return;
      }

      const logDisplay = buildSimpleLogDisplay(logResult.data);
      const step1Complete = this.createStepData('query_log', '🔍 步骤 1：查询日志', logDisplay, logResult.data);
      callback.onStepComplete(step1Complete);

      // ===== 步骤2: 识别服务 =====
      const step2 = this.createStepData('identify_service', '🤔 步骤 2：识别服务');
      callback.onStepStart('identify_service');
      callback.onStepUpdate({ ...step2, status: 'loading' });

      const logData = logResult.data;
      const firstErrorLog = logData.errorLogs?.[0] || logData.allLogs?.[0];
      const serviceName = firstErrorLog?.serviceName || '未知服务';
      const reqUrl = firstErrorLog?.reqUrl || '';
      const vueFile = firstErrorLog?.vueFile || '';
      const errorClass = firstErrorLog?.errorClass || '';
      const errorMessage = firstErrorLog?.errorMessage || '';

      const identifyContent = `请分析以下日志信息，判断该服务是前端还是后端：

服务名: ${serviceName}
请求URL: ${reqUrl}
Vue文件: ${vueFile || '无'}
错误类型: ${errorClass || '无'}
错误信息: ${errorMessage || '无'}`;

      const identification = await this.deepseekClient.chatSimple(
        identifyContent,
        SERVICE_IDENTIFY_PROMPT
      );

      let parsedId: ServiceIdentification;
      try {
        const cleanResponse = identification.replace(/```json\n?|\n?```/g, '').trim();
        const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
        parsedId = jsonMatch
          ? JSON.parse(jsonMatch[0])
          : {
              serviceName,
              isFrontend: !!vueFile,
              reasoning: '基于日志特征自动判断',
              suggestedDirection: vueFile ? 'frontend' : 'backend',
            };
      } catch {
        parsedId = {
          serviceName,
          isFrontend: !!vueFile,
          reasoning: '基于日志特征自动判断',
          suggestedDirection: vueFile ? 'frontend' : 'backend',
        };
      }

      serviceIdentification = parsedId;

      const identifyDisplay = `**识别到的服务**: ${parsedId.serviceName}（${parsedId.isFrontend ? '前端' : '后端'}）

**建议优先排查方向**: ${parsedId.suggestedDirection === 'frontend' ? '前端 Vue 应用' : '后端 Java 服务'}

**判断理由**: ${parsedId.reasoning}`;

      const step2Complete = this.createStepData('identify_service', '🤔 步骤 2：识别服务', identifyDisplay, parsedId);
      callback.onStepComplete(step2Complete);

      // ===== 步骤3: 匹配代码仓库 =====
      const step3 = this.createStepData('match_repository', '📦 步骤 3：匹配代码仓库');
      callback.onStepStart('match_repository');
      callback.onStepUpdate({ ...step3, status: 'loading' });

      const repos = getCodeRepositoriesByProjectId(request.projectId);
      const matchedRepo = matchCodeRepository(
        request.projectId,
        serviceIdentification.serviceName,
        reqUrl
      );

      if (!matchedRepo) {
        repositoryMatch = {
          matched: false,
          availableRepositories: repos.map(r => ({ name: r.name })),
        };

        const noMatchDisplay = `❌ 当前报错的服务 **"${serviceIdentification.serviceName}"** 不在项目维护的代码仓库列表中。

**请求URL**: ${reqUrl || '无'}
**已配置的仓库**:
${repos.map(r => `- ${r.name} (匹配模式: ${r.servicePatterns})`).join('\n')}

> 请在项目管理中添加对应的代码仓库配置后重试。`;

        const step3Complete = this.createStepData('match_repository', '📦 步骤 3：匹配代码仓库', noMatchDisplay, repositoryMatch);
        callback.onStepComplete(step3Complete);
        return;
      }

      repositoryMatch = {
        matched: true,
        repository: {
          id: matchedRepo.id,
          name: matchedRepo.name,
          repositoryUrl: matchedRepo.repositoryUrl,
          servicePatterns: matchedRepo.servicePatterns,
          defaultBranch: matchedRepo.defaultBranch || 'master',
        },
        availableRepositories: repos.map(r => ({ name: r.name })),
      };

      const matchDisplay = `✅ 匹配成功！

**匹配仓库**: ${matchedRepo.name}
**仓库地址**: ${matchedRepo.repositoryUrl}
**匹配模式**: ${matchedRepo.servicePatterns}
**默认分支**: ${matchedRepo.defaultBranch || 'master'}`;

      const step3Complete = this.createStepData('match_repository', '📦 步骤 3：匹配代码仓库', matchDisplay, repositoryMatch);
      callback.onStepComplete(step3Complete);

      // ===== 步骤4: 获取版本信息并拉取代码 =====
      const step4 = this.createStepData('fetch_version_and_code', '📥 步骤 4：获取版本信息并拉取代码');
      callback.onStepStart('fetch_version_and_code');
      callback.onStepUpdate({ ...step4, status: 'loading' });

      let versionTag = '';
      let moduleName = serviceIdentification.serviceName;
      let inferredBranch = matchedRepo.defaultBranch || 'master';

      if (apiBaseUrl && apiVersionPath && apiToken) {
        try {
          const versionClient = new ApiClient({
            baseUrl: apiBaseUrl,
            versionPath: apiVersionPath,
            apiKey: 'HIS5',
          });
          versionClient.setToken(apiToken);

          const versions = await versionClient.getModuleVersions();
          console.log('[STEP4] Module versions:', JSON.stringify(versions, null, 2));

          const matchedVersion = this.matchModuleVersion(
            versions,
            matchedRepo.name,
            serviceIdentification.serviceName
          );

          if (matchedVersion) {
            versionTag = matchedVersion.version;
            moduleName = matchedVersion.name;
            inferredBranch = inferBranchFromTag(versionTag);
            console.log(`[STEP4] Matched version: tag=${versionTag}, branch=${inferredBranch}`);
          }
        } catch (e) {
          console.warn('[STEP4] Failed to get version info:', e);
        }
      }

      let codeResult: ToolResult;
      if (versionTag) {
        codeResult = await getCode(
          serviceIdentification.serviceName,
          undefined,
          undefined,
          versionTag,
          request.projectId
        );
      } else {
        codeResult = await getCode(
          serviceIdentification.serviceName,
          undefined,
          inferredBranch,
          undefined,
          request.projectId
        );
      }

      if (!codeResult.success) {
        const errorMsg = codeResult.error || '代码获取失败';
        callback.onStepError('fetch_version_and_code', errorMsg);
        return;
      }

      versionAndCode = {
        versionTag,
        moduleName,
        branch: codeResult.data?.branch || inferredBranch,
        files: codeResult.data?.files || [],
        totalFiles: codeResult.data?.totalFiles || 0,
        repositoryName: codeResult.data?.repositoryName || matchedRepo.name,
      };

      const codeFilesDisplay = versionAndCode.files.slice(0, 15).join('\n');
      const truncatedNote = versionAndCode.files.length > 15
        ? `\n\n... 还有 ${versionAndCode.files.length - 15} 个文件未显示`
        : '';

      const versionDisplay = `**匹配到的版本 Tag**: ${versionTag || '未获取到版本信息'}
**推断的分支**: ${versionAndCode.branch}
**仓库**: ${versionAndCode.repositoryName}

**代码文件列表** (共 ${versionAndCode.totalFiles} 个文件，显示前 ${Math.min(versionAndCode.files.length, 15)} 个):
${codeFilesDisplay}${truncatedNote}`;

      const step4Complete = this.createStepData('fetch_version_and_code', '📥 步骤 4：获取版本信息并拉取代码', versionDisplay, versionAndCode);
      callback.onStepComplete(step4Complete);

      // ===== 步骤5: 深度分析 (LLM Loop) =====
      const step5 = this.createStepData('deep_analysis', '🧠 步骤 5：深度分析');
      callback.onStepStart('deep_analysis');
      callback.onStepUpdate({ ...step5, status: 'loading' });

      const logPrompt = buildToolPrompt('query_log', { logId: request.logId }, logResult);
      const contextPrompt = `## 分析上下文

### 已识别服务
- 服务名: ${serviceIdentification.serviceName}
- 类型: ${serviceIdentification.isFrontend ? '前端' : '后端'}
- 建议方向: ${serviceIdentification.suggestedDirection}

### 匹配仓库
- 仓库名: ${matchedRepo.name}
- 仓库地址: ${matchedRepo.repositoryUrl}
- 分支: ${versionAndCode.branch}

### 代码文件 (前20个)
${versionAndCode.files.slice(0, 20).join('\n')}

${logPrompt}

请根据以上信息进行深度分析。你可以使用以下工具：
- **get_code(serviceName, filePath)**：获取具体文件内容或关联服务代码
- **query_more_logs(serviceName, logLevel, timeRange)**：查询更多日志
- **get_table_schema(tableNamePattern)**：查看表结构
- **query_business_data(sql, description)**：查询业务数据

请逐步分析，每次只调用一个工具，基于结果继续深入。`;

      conversation.push({
        role: 'assistant',
        content: contextPrompt,
      });

      const analysisConversation = await this.runDeepAnalysis(conversation, request);
      const analysisContent = analysisConversation
        .filter(m => m.role === 'assistant' && m.content)
        .map(m => m.content)
        .join('\n\n');

      const step5Complete = this.createStepData('deep_analysis', '🧠 步骤 5：深度分析', analysisContent || '分析完成', { conversation: analysisConversation });
      callback.onStepComplete(step5Complete);

      // ===== 步骤6: 结论 =====
      const step6 = this.createStepData('conclusion', '📋 步骤 6：分析结论');
      callback.onStepStart('conclusion');
      callback.onStepUpdate({ ...step6, status: 'loading' });

      const finalMessages: ConversationMessage[] = [
        ...analysisConversation,
        {
          role: 'user',
          content: `请根据以上所有分析结果，输出最终结论。包含以下内容：
1. **问题根因**：导致错误的根本原因
2. **影响范围**：影响的功能模块和用户
3. **涉及代码**：具体文件和代码位置
4. **解决方案**：可操作的修复步骤
5. **预防措施**：如何避免类似问题`,
        },
      ];

      const conclusionResponse = await this.deepseekClient.chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          ...finalMessages.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool').slice(-15),
        ],
        { tools: false, temperature: 0.3 }
      );

      const conclusion = conclusionResponse.choices[0]?.message?.content || '分析完成，请查看上述步骤获取详细信息。';
      const step6Complete = this.createStepData('conclusion', '📋 步骤 6：分析结论', conclusion);
      callback.onStepComplete(step6Complete);

    } catch (error) {
      const errorMsg = (error as Error).message || '分析过程发生未知错误';
      console.error('[AGENT] Step-by-step analysis error:', error);
      callback.onStepError('deep_analysis', errorMsg);
    }
  }

  private async runDeepAnalysis(
    conversation: ConversationMessage[],
    request: AnalysisRequest
  ): Promise<ConversationMessage[]> {
    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;
      console.log(`[AGENT] Deep analysis iteration ${iterations}`);

      const messages = [
        { role: 'system', content: DEEP_ANALYSIS_PROMPT },
        ...conversation,
      ];

      let response: ChatCompletionResponse;
      let streamContent = '';

      try {
        response = await this.deepseekClient.chat(
          messages as ConversationMessage[],
          {
            tools: true,
            stream: true,
            onChunk: (chunk) => {
              const delta = chunk.choices[0]?.delta;
              if (delta?.content) {
                streamContent += delta.content;
                if (this.callback) {
                  this.callback.onStreamChunk(delta.content);
                }
              }
            },
          }
        );
      } catch (e) {
        console.error(`[AGENT] Deep analysis iteration ${iterations} failed:`, e);
        break;
      }

      const assistantContent = response.choices[0]?.message?.content || streamContent;
      const toolCalls = parseToolCalls(response);

      if (assistantContent) {
        const assistantMsg: ConversationMessage = {
          role: 'assistant',
          content: assistantContent,
        };
        conversation.push(assistantMsg);
      }

      if (toolCalls.length === 0) {
        console.log('[AGENT] No more tool calls, deep analysis complete');
        break;
      }

      for (const tc of toolCalls) {
        console.log(`[AGENT] Executing tool: ${tc.name}`, tc.arguments);

        const assistantToolMsg: ConversationMessage = {
          role: 'assistant',
          content: `调用工具: ${tc.name}`,
          toolCalls: [tc],
        };
        conversation.push(assistantToolMsg);

        if (this.context) {
          this.context.logId = request.logId;
        }

        const result = await executeTool(tc.name, tc.arguments, this.context!);
        const toolPrompt = buildToolPrompt(tc.name, tc.arguments, result);

        const toolMsg = createToolResultMessage(
          tc.id || `call_${iterations}`,
          tc.name,
          toolPrompt
        );
        conversation.push(toolMsg);
      }
    }

    return conversation;
  }

  private matchModuleVersion(
    versions: Array<{ name: string; version: string; updateTime?: string }>,
    repoName: string,
    serviceName: string
  ): { name: string; version: string } | null {
    if (!versions || versions.length === 0) return null;

    const moduleNameMap: Record<string, string[]> = {
      '医嘱后端': ['医嘱后端', 'pres-service', 'doctor', 'medical'],
      '收费后端': ['收费后端', 'charge-service', 'payment'],
      '公共后端': ['公共后端', 'optimus-service', 'common-service', '公共模块后端'],
      '临床路径前端': ['临床路径前端', 'clinicpath', '临床路径'],
      '收费前端': ['收费前端', 'charge-web', '收费前端模块'],
      '药剂前端': ['药剂前端', 'drug-web', 'pharmacy'],
      '公共前端': ['公共前端', 'component-web', '公共模块前端'],
      '门诊前端': ['门诊前端', 'outp-web', 'outpatient'],
      '医嘱前端': ['医嘱前端', 'pres-web', '医嘱前端模块'],
    };

    const keywords = moduleNameMap[repoName] || [repoName, serviceName];

    for (const version of versions) {
      const versionName = (version.name || '').toLowerCase();
      for (const keyword of keywords) {
        if (versionName.includes(keyword.toLowerCase())) {
          return { name: version.name, version: version.version };
        }
      }
    }

    const repoLower = repoName.toLowerCase();
    for (const version of versions) {
      const versionName = (version.name || '').toLowerCase();
      if (versionName.includes(repoLower) || repoLower.includes(versionName)) {
        return { name: version.name, version: version.version };
      }
    }

    return null;
  }

  private createStepData(
    id: AnalysisStepData['id'],
    title: string,
    content: string = '',
    data?: any
  ): AnalysisStepData {
    return {
      id,
      status: 'pending',
      title,
      content,
      data,
      error: undefined,
      timestamp: new Date().toISOString(),
    };
  }
}

export function createAgent(): HISAnalysisAgent {
  return new HISAnalysisAgent();
}