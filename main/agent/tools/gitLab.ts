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

async function getFileContent(repoUrl: string, token: string, filePath: string, branch: string): Promise<string | null> {
  try {
    // 从仓库URL中提取项目路径
    let projectPath = repoUrl;
    if (projectPath.startsWith('http')) {
      projectPath = projectPath.replace(/^https?:\/\/gitlab\.zoesoft\.com\.cn\//, '');
    }
    
    console.log('Original repo URL:', repoUrl);
    console.log('Extracted project path:', projectPath);
    
    // GitLab API 项目路径需要把 / 替换为 %2F
    const encodedFilePath = filePath.replace(/\//g, '%2F');
    const encodedProjectPath = projectPath.replace(/\//g, '%2F');
    
    // 尝试第一个分支
    let url = `${GITLAB_CONFIG.baseUrl}/api/v4/projects/${encodedProjectPath}/repository/files/${encodedFilePath}?ref=${branch}&private_token=${token}`;
    console.log('GitLab file URL (attempt 1):', url);
    
    let response = await fetch(url);
    
    // 如果失败，尝试另一个常见分支名：main <-> master
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
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch (error) {
    console.error('GitLab file content error:', error);
    return null;
  }
}

async function listRepositoryFiles(repoUrl: string, token: string, path: string = '', branch: string): Promise<string[]> {
  try {
    // 从仓库URL中提取项目路径
    let projectPath = repoUrl;
    if (projectPath.startsWith('http')) {
      projectPath = projectPath.replace(/^https?:\/\/gitlab\.zoesoft\.com\.cn\//, '');
    }
    
    console.log('Original repo URL:', repoUrl);
    console.log('Extracted project path:', projectPath);
    console.log('Requested branch:', branch);
    
    // GitLab API 项目路径需要把 / 替换为 %2F
    const encodedPath = path.replace(/\//g, '%2F');
    const encodedProjectPath = projectPath.replace(/\//g, '%2F');
    
    // 尝试第一个分支
    let url = `${GITLAB_CONFIG.baseUrl}/api/v4/projects/${encodedProjectPath}/repository/tree?path=${encodedPath}&ref=${branch}&private_token=${token}`;
    console.log('GitLab tree URL (attempt 1):', url);
    
    let response = await fetch(url);
    
    // 如果失败，尝试另一个常见分支名：main <-> master
    if (!response.ok) {
      const fallbackBranch = branch === 'main' ? 'master' : 'main';
      url = `${GITLAB_CONFIG.baseUrl}/api/v4/projects/${encodedProjectPath}/repository/tree?path=${encodedPath}&ref=${fallbackBranch}&private_token=${token}`;
      console.log(`GitLab tree URL (attempt 2 with branch ${fallbackBranch}):`, url);
      response = await fetch(url);
    }
    
    if (!response.ok) {
      console.error(`GitLab list files failed: ${response.status} for ${url}`);
      return [];
    }

    const files = await response.json() as any[];
    return files.filter((f: any) => f.type === 'blob').map((f: any) => f.path);
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
  projectId?: string
): Promise<ToolResult> {
  try {
    console.log('========== [GET_CODE] START ==========');
    console.log('Input params:', { serviceName, filePath, branch, tag, projectId });
    
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
      targetBranch = repoConfig.defaultBranch || 'master';
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
    
    if (filePath) {
      console.log(`Fetching file: ${filePath}`);
      const content = await getFileContent(repoConfig.repositoryUrl, token, filePath, targetBranch);
      
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

      const codeFiles = files
        .filter(f => f.endsWith('.java') || f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.vue') || f.endsWith('.tsx') || f.endsWith('.jsx'))
        .slice(0, 20);

      console.log(`✅ Found ${files.length} files (showing ${codeFiles.length} code files)`);
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
