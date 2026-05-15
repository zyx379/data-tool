import { GITLAB_CONFIG } from '../config';
import { CodeInfo, ToolResult } from '../types';
import { getCodeRepositoriesByProjectId, matchCodeRepository, inferBranchFromTag } from '../../database/sqlite';

export interface GitLabFileRequest {
  projectName: string;
  filePath?: string;
  branch?: string;
}

export interface GitLabConfig {
  baseUrl: string;
  token: string;
  defaultBranch: string;
}

export function updateGitLabConfig(config: Partial<GitLabConfig>) {
  if (config.baseUrl) GITLAB_CONFIG.baseUrl = config.baseUrl;
  if (config.token) GITLAB_CONFIG.token = config.token;
  if (config.defaultBranch) GITLAB_CONFIG.defaultBranch = config.defaultBranch;
}

async function getFileContent(
  repoUrl: string,
  token: string,
  filePath: string,
  branch: string,
  startLine?: number,
  endLine?: number,
  searchPattern?: string
): Promise<string | null> {
  try {
    let projectPath = repoUrl;
    if (projectPath.startsWith('http')) {
      projectPath = projectPath.replace(/^https?:\/\/gitlab\.zoesoft\.com\.cn\//, '');
    }

    console.log('Fetching file:', filePath);
    console.log('Original repo URL:', repoUrl);
    console.log('Extracted project path:', projectPath);

    const encodedFilePath = filePath.replace(/\//g, '%2F');
    const encodedProjectPath = projectPath.replace(/\//g, '%2F');

    let url = `${GITLAB_CONFIG.baseUrl}/api/v4/projects/${encodedProjectPath}/repository/files/${encodedFilePath}?ref=${branch}&private_token=${token}`;
    console.log('GitLab file URL (attempt 1):', url);

    let response = await fetch(url);

    if (!response.ok) {
      const fallbackBranch = branch === 'main' ? 'master' : 'main';
      url = `${GITLAB_CONFIG.baseUrl}/api/v4/projects/${encodedProjectPath}/repository/files/${encodedFilePath}?ref=${fallbackBranch}&private_token=${token}`;
      console.log(`GitLab file URL (attempt 2 with branch ${fallbackBranch}):`, url);
      response = await fetch(url);
    }

    if (!response.ok) {
      console.error(`GitLab file fetch failed: ${response.status} for ${url}`);
      return null;
    }

    const data = await response.json() as any;
    const fullContent = Buffer.from(data.content, 'base64').toString('utf-8');
    const allLines = fullContent.split('\n');
    const totalLines = allLines.length;

    if (searchPattern) {
      const matched: string[] = [];
      const lowerPattern = searchPattern.toLowerCase();
      for (let i = 0; i < allLines.length; i++) {
        if (allLines[i].toLowerCase().includes(lowerPattern)) {
          const start = Math.max(0, i - 10);
          const end = Math.min(allLines.length, i + 11);
          if (matched.length > 0) matched.push('---');
          matched.push(`[匹配行 ${i + 1}，上下文 ${start + 1}-${end}]:`);
          matched.push(...allLines.slice(start, end));
        }
      }
      if (matched.length === 0) {
        return `在文件中未找到 "${searchPattern}"\n文件共 ${totalLines} 行，请尝试其他关键词`;
      }
      const result = matched.join('\n');
      if (result.length > 8000) {
        return result.substring(0, 8000) + `\n... (搜索结果过长已截断，共 ${totalLines} 行，请缩小搜索范围)`;
      }
      return result;
    }

    if (startLine !== undefined && endLine !== undefined) {
      const start = Math.max(1, startLine) - 1;
      const end = Math.min(totalLines, endLine);
      const selected = allLines.slice(start, end);
      let result = selected.map((l, i) => `${start + i + 1}: ${l}`).join('\n');
      if (result.length > 10000) {
        result = selected.slice(0, 400).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
        result += `\n... (截断，共 ${end - start} 行，请缩小 startLine/endLine 范围)`;
      }
      return result;
    }

    const MAX_LINES = 300;
    if (totalLines > MAX_LINES) {
      const preview = allLines.slice(0, MAX_LINES).map((l, i) => `${i + 1}: ${l}`).join('\n');
      return preview + `\n\n⚠️ 文件共 ${totalLines} 行，仅显示前 ${MAX_LINES} 行。\n💡 提示：使用 startLine + endLine 参数获取指定行范围，或使用 searchPattern 搜索关键词（如方法名、类名）。`;
    }

    return allLines.map((l, i) => `${i + 1}: ${l}`).join('\n');
  } catch (error) {
    console.error('GitLab file content error:', error);
    return null;
  }
}

async function listRepositoryFiles(repoUrl: string, token: string, path: string = '', branch: string): Promise<string[]> {
  try {
    let projectPath = repoUrl;
    if (projectPath.startsWith('http')) {
      projectPath = projectPath.replace(/^https?:\/\/gitlab\.zoesoft\.com\.cn\//, '');
    }

    console.log('Original repo URL:', repoUrl);
    console.log('Extracted project path:', projectPath);
    console.log('Requested branch:', branch);

    const encodedProjectPath = projectPath.replace(/\//g, '%2F');

    const fetchTree = async (dirPath: string, useBranch: string): Promise<any[]> => {
      const encodedPath = dirPath.replace(/\//g, '%2F');
      const url = `${GITLAB_CONFIG.baseUrl}/api/v4/projects/${encodedProjectPath}/repository/tree?path=${encodedPath}&ref=${useBranch}&per_page=100&private_token=${token}`;
      const resp = await fetch(url);
      if (!resp.ok) return [];
      return await resp.json() as any[];
    };

    const tryBranches = async (dirPath: string): Promise<any[]> => {
      let entries = await fetchTree(dirPath, branch);
      if (entries.length === 0) {
        const fallback = branch === 'main' ? 'master' : (branch === 'master' ? 'main' : 'master');
        if (fallback !== branch) {
          console.log(`Empty result for ${branch}, trying ${fallback}...`);
          entries = await fetchTree(dirPath, fallback);
        }
      }
      return entries;
    };

    let allFiles: string[] = [];

    const rootEntries = await tryBranches('');
    const rootBlobs = rootEntries.filter((e: any) => e.type === 'blob').map((e: any) => e.path);
    const rootTrees = rootEntries.filter((e: any) => e.type === 'tree').map((e: any) => e.path);
    allFiles.push(...rootBlobs);

    const isSourceLike = (name: string) =>
      /\.(java|ts|js|vue|tsx|jsx|py|go|rs|kt|scala|cs|rb|php)$/i.test(name);

    const visited = new Set<string>();

    for (const tree of rootTrees.slice(0, 10)) {
      if (visited.has(tree)) continue;
      visited.add(tree);

      const entries = await tryBranches(tree);
      const treeBlobs = entries.filter((e: any) => e.type === 'blob').map((e: any) => e.path);
      const treeTrees = entries.filter((e: any) => e.type === 'tree').map((e: any) => e.path);
      allFiles.push(...treeBlobs);

      const hasSourceFiles = treeBlobs.some(isSourceLike);
      const isSourceDir = /^(src|lib|app|pages|components|views|router|store|modules|services|controllers|models|utils|common|config)$/i.test(tree.split('/').pop() || '');

      if (hasSourceFiles || isSourceDir) {
        for (const nested of treeTrees.slice(0, 5)) {
          const nestedPath = nested;
          if (visited.has(nestedPath)) continue;
          visited.add(nestedPath);
          const nestedEntries = await tryBranches(nestedPath);
          const nestedBlobs = nestedEntries.filter((e: any) => e.type === 'blob').map((e: any) => e.path);
          allFiles.push(...nestedBlobs);

          if (nestedBlobs.some(isSourceLike)) {
            const deepTrees = nestedEntries.filter((e: any) => e.type === 'tree').map((e: any) => e.path);
            for (const deep of deepTrees.slice(0, 3)) {
              if (visited.has(deep)) continue;
              visited.add(deep);
              const deepEntries = await tryBranches(deep);
              allFiles.push(...deepEntries.filter((e: any) => e.type === 'blob').map((e: any) => e.path));
            }
          }
        }
      }
    }

    console.log(`Found ${allFiles.length} files total`);
    return allFiles;
  } catch (error) {
    console.error('GitLab list files error:', error);
    return [];
  }
}

export async function getCode(
  serviceName?: string,
  filePath?: string,
  branch?: string,
  tag?: string,
  projectId?: string,
  startLine?: number,
  endLine?: number,
  searchPattern?: string
): Promise<ToolResult> {
  try {
    console.log('========== [GET_CODE] START ==========');
    console.log('Input params:', { serviceName, filePath, branch, tag, projectId, startLine, endLine, searchPattern });
    
    // 如果提供了 projectId，尝试从代码仓库配置中匹配
    let repoConfig: any = null;
    if (projectId) {
      const repos = getCodeRepositoriesByProjectId(projectId);
      console.log('Available repositories:', repos.map(r => ({ 
        name: r.name, 
        patterns: r.servicePatterns 
      })));
      
      if (repos.length === 0) {
        console.log('❌ [GET_CODE] ERROR: No repositories found');
        return { 
          success: false, 
          error: `未找到代码仓库配置，请在项目管理中添加仓库配置` 
        };
      }
      
      // 处理字符串 "undefined" 或 "null" 的情况
      const cleanServiceName = (serviceName === 'undefined' || serviceName === 'null') ? undefined : serviceName;
      
      if (cleanServiceName) {
        console.log(`Matching service: "${cleanServiceName}"`);
        repoConfig = matchCodeRepository(projectId, cleanServiceName);
        console.log(`Match result: ${repoConfig ? repoConfig.name : 'NONE'}`);
      } else {
        console.log('⚠️ serviceName is empty, will use fallback');
      }
      
      if (!repoConfig) {
        if (cleanServiceName) {
          console.log(`❌ No repository matched for "${cleanServiceName}"`);
          return { 
            success: false, 
            error: `未找到与服务名 "${cleanServiceName}" 匹配的代码仓库。请检查项目管理中的代码仓库配置，确保服务匹配模式包含此服务名。` 
          };
        }
        console.log(`⚠️ Using fallback repository: ${repos[0].name}`);
        console.log(`⚠️ REASON: serviceName is empty - LLM may have skipped query_log step`);
        repoConfig = repos[0];
      }
      
      console.log(`✅ Selected repository: ${repoConfig.name}`);
    }

    if (!repoConfig) {
      return { 
        success: false, 
        error: `未找到代码仓库配置，请在项目管理中添加仓库配置` 
      };
    }

    let targetBranch: string = branch || '';
    if (!targetBranch && tag) {
      targetBranch = inferBranchFromTag(tag) || '';
      console.log(`Inferred branch from tag ${tag}: ${targetBranch}`);
    }
    if (!targetBranch) {
      targetBranch = 'master';
    }

    console.log('Using branch:', targetBranch);

    // 确定 Token：使用仓库配置的 Token，或者回退到全局配置
    const token = repoConfig.gitLabToken || GITLAB_CONFIG.token;

    if (!token) {
      return { 
        success: false, 
        error: 'GitLab token 未配置，请在仓库配置中或设置中配置 GitLab 访问令牌' 
      };
    }

    console.log('========== [GET_CODE] Fetching from GitLab ==========');
    
    if (!filePath && (searchPattern || startLine !== undefined || endLine !== undefined)) {
      return {
        success: false,
        error: '使用 searchPattern/startLine/endLine 时必须指定 filePath。请先用不带参数的 get_code 获取文件列表，再选择具体文件搜索。'
      };
    }

    if (filePath) {
      const lastSegment = filePath.split('/').pop() || '';
      const isDirectoryLike =
        filePath.endsWith('/') ||
        !lastSegment.includes('.') ||
        /^(src|resources|mapper|dao|service|controller|config|model|entity|dto|vo|utils|common|handler|filter|interceptor|listener|aspect|enums|exception|feign|impl)$/i.test(lastSegment);

      if (isDirectoryLike) {
        console.log(`⚠️ Path looks like a directory: ${filePath}`);
        return {
          success: false,
          error: `"${filePath}" 看起来是一个目录而不是文件。请先用不带 filePath 的 get_code 获取文件列表，找到具体的文件名后再获取内容。提示：MyBatis XML 映射文件通常位于 resources/mapper/ 目录下。`
        };
      }

      console.log(`Fetching file: ${filePath}`);
      const content = await getFileContent(repoConfig.repositoryUrl, token, filePath, targetBranch, startLine, endLine, searchPattern);
      
      if (content === null) {
        console.log(`❌ Failed to get file: ${filePath}`);
        return { 
          success: false, 
          error: `获取文件失败: ${filePath} (分支: ${targetBranch})` 
        };
      }

      console.log(`✅ Got file content (length: ${content.length})`);
      const codeInfo: CodeInfo = {
        filePath,
        content,
        serviceName: serviceName || repoConfig.name,
        branch: targetBranch,
      };

      return { success: true, data: codeInfo };
    } else {
      console.log(`Listing repository files...`);
      const files = await listRepositoryFiles(repoConfig.repositoryUrl, token, '', targetBranch);
      
      if (files.length === 0) {
        console.log('❌ No files found in repository');
        return { 
          success: false, 
          error: `仓库 ${repoConfig.name} 中没有找到代码文件 (分支: ${targetBranch})` 
        };
      }

      const codeFiles = files.slice(0, 30);

      console.log(`✅ Found ${files.length} files (showing ${codeFiles.length})`);
      return { 
        success: true, 
        data: {
          serviceName: serviceName || repoConfig.name,
          repositoryName: repoConfig.name,
          branch: targetBranch,
          tag: tag,
          files: codeFiles,
          totalFiles: files.length,
        } 
      };
    }
  } catch (error) {
    console.error('❌ [GET_CODE] Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export function buildCodeQueryPrompt(serviceName?: string, codeData?: any): string {
  let prompt = `## 代码查询结果\n\n`;
  if (serviceName) {
    prompt += `**服务名称**: ${serviceName}\n`;
  }
  if (codeData?.repositoryName) {
    prompt += `**仓库**: ${codeData.repositoryName}\n`;
  }
  if (codeData?.branch) {
    prompt += `**分支**: ${codeData.branch}`;
    if (codeData.tag) {
      prompt += ` (Tag: ${codeData.tag})`;
    }
    prompt += `\n\n`;
  }

  if (codeData?.files) {
    prompt += `**代码文件列表** (共 ${codeData.totalFiles || 'unknown'} 个文件，显示前 ${codeData.files.length} 个):\n`;
    codeData.files.forEach((file: string) => {
      prompt += `- ${file}\n`;
    });
    prompt += `\n请告诉用户如何使用 get_code 工具获取具体文件内容。\n`;
  } else if (codeData?.filePath) {
    prompt += `**文件路径**: ${codeData.filePath}\n\n`;
    prompt += `**代码内容**:\n`;
    const displayContent = codeData.content ? codeData.content.substring(0, 3000) : '';
    const truncated = codeData.content && codeData.content.length > 3000;
    prompt += `\`\`\`\n${displayContent}${truncated ? '\n... (内容过长已截断)' : ''}\n\`\`\`\n`;
  }

  return prompt;
}
