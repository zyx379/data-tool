import { GITLAB_CONFIG } from '../config';
import { CodeInfo, ToolResult } from '../types';

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

async function searchProject(serviceName: string): Promise<string | null> {
  if (!GITLAB_CONFIG.token) {
    console.warn('GitLab token not configured');
    return null;
  }

  try {
    const searchUrl = `${GITLAB_CONFIG.baseUrl}/api/v4/projects?search=${encodeURIComponent(serviceName)}&private_token=${GITLAB_CONFIG.token}`;
    const response = await fetch(searchUrl);
    
    if (!response.ok) {
      console.error(`GitLab search failed: ${response.status}`);
      return null;
    }

    const projects = await response.json() as any[];
    
    if (projects.length === 0) {
      const fuzzySearchUrl = `${GITLAB_CONFIG.baseUrl}/api/v4/projects?search=${encodeURIComponent(serviceName.toLowerCase())}&private_token=${GITLAB_CONFIG.token}`;
      const fuzzyResponse = await fetch(fuzzySearchUrl);
      if (fuzzyResponse.ok) {
        const fuzzyProjects = await fuzzyResponse.json() as any[];
        if (fuzzyProjects.length > 0) {
          return String(fuzzyProjects[0].id);
        }
      }
      return null;
    }

    const exactMatch = projects.find((p: any) => 
      p.name.toLowerCase() === serviceName.toLowerCase() ||
      p.path_with_namespace.toLowerCase() === serviceName.toLowerCase()
    );

    return exactMatch ? String(exactMatch.id) : String(projects[0].id);
  } catch (error) {
    console.error('GitLab project search error:', error);
    return null;
  }
}

async function getFileContent(projectId: string, filePath: string, branch: string): Promise<string | null> {
  if (!GITLAB_CONFIG.token) {
    return null;
  }

  try {
    const encodedPath = encodeURIComponent(filePath);
    const url = `${GITLAB_CONFIG.baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedPath}?ref=${branch}&private_token=${GITLAB_CONFIG.token}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`GitLab file fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch (error) {
    console.error('GitLab file content error:', error);
    return null;
  }
}

async function listRepositoryFiles(projectId: string, path: string = '', branch: string): Promise<string[]> {
  if (!GITLAB_CONFIG.token) {
    return [];
  }

  try {
    const encodedPath = encodeURIComponent(path);
    const url = `${GITLAB_CONFIG.baseUrl}/api/v4/projects/${projectId}/repository/tree?path=${encodedPath}&ref=${branch}&private_token=${GITLAB_CONFIG.token}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
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
  serviceName: string,
  filePath?: string,
  branch?: string
): Promise<ToolResult> {
  try {
    if (!GITLAB_CONFIG.token) {
      return { 
        success: false, 
        error: 'GitLab token 未配置，请在设置中配置 GitLab 访问令牌' 
      };
    }

    const projectId = await searchProject(serviceName);
    
    if (!projectId) {
      return { 
        success: false, 
        error: `未找到项目: ${serviceName}，请确认服务名称是否正确` 
      };
    }

    const targetBranch = branch || GITLAB_CONFIG.defaultBranch;

    if (filePath) {
      const content = await getFileContent(projectId, filePath, targetBranch);
      
      if (content === null) {
        return { 
          success: false, 
          error: `获取文件失败: ${filePath}` 
        };
      }

      const codeInfo: CodeInfo = {
        filePath,
        content,
        serviceName,
        branch: targetBranch,
      };

      return { success: true, data: codeInfo };
    } else {
      const files = await listRepositoryFiles(projectId, '', targetBranch);
      
      if (files.length === 0) {
        return { 
          success: false, 
          error: `项目 ${serviceName} 中没有找到代码文件` 
        };
      }

      const codeFiles = files
        .filter(f => f.endsWith('.java') || f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.vue') || f.endsWith('.tsx') || f.endsWith('.jsx'))
        .slice(0, 20);

      return { 
        success: true, 
        data: {
          serviceName,
          branch: targetBranch,
          files: codeFiles,
          totalFiles: files.length,
        } 
      };
    }
  } catch (error) {
    console.error('Get code error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export function buildCodeQueryPrompt(serviceName: string, codeData: any): string {
  let prompt = `## 代码查询结果\n\n`;
  prompt += `**服务名称**: ${serviceName}\n`;
  prompt += `**分支**: ${codeData.branch || 'main'}\n\n`;

  if (codeData.files) {
    prompt += `**代码文件列表** (共 ${codeData.totalFiles} 个文件，显示前 ${codeData.files.length} 个):\n`;
    codeData.files.forEach((file: string) => {
      prompt += `- ${file}\n`;
    });
    prompt += `\n请告诉用户如何使用 /getcode 命令获取具体文件内容，例如：\n`;
    prompt += `/getcode ${serviceName} src/main/java/com/his/Service.java\n`;
  } else if (codeData.filePath) {
    prompt += `**文件路径**: ${codeData.filePath}\n\n`;
    prompt += `**代码内容**:\n`;
    prompt += `\`\`\`\n${codeData.content.substring(0, 2000)}${codeData.content.length > 2000 ? '\n... (内容过长已截断)' : ''}\n\`\`\`\n`;
  }

  return prompt;
}
