import axios, { AxiosInstance, isAxiosError } from 'axios';
import fs from 'fs';
import path from 'path';

export interface ApiConfig {
  baseUrl: string;
  tokenPath?: string;
  versionPath?: string;
  logPath?: string;
  apiKey?: string;
  authType?: 'bearer' | 'api-key' | 'custom';
  customHeaderName?: string;
}

export interface ModuleVersion {
  name: string;
  version: string;
  updateTime?: string;
}

// 日志请求参数
export interface LogQueryParam {
  pageSize: string;
  pageNum: string;
  indexvalue: string;
  logType: string;
  serviceName?: string;
  canary?: string;
  traceId?: string;
  logLevel?: string[];
  timestamp?: {
    startDate: string | null;
    endDate: string | null;
  };
  filterParam?: {
    searchType: string;
    termChecked: boolean;
    matchChecked: boolean;
    wildcardChecked: boolean;
    operator?: string;
    value?: string;
    searchValue?: string;
  };
}

// 分析后的日志信息
export interface AnalyzedLogInfo {
  id: string;
  logType: string;
  logLevel: string;
  serviceName: string;
  reqUrl: string;
  httpMethod?: string;
  httpStatus?: string;
  clientIp?: string;
  operator?: string;
  runTime?: number;
  errorClass?: string;
  errorMessage?: string;
  stackTrace?: string;
  vueFile?: string;
  requestParams?: string;
  tags?: Record<string, any>;
  originalLog: any;
}

export class ApiClient {
  private client: AxiosInstance;
  private config: ApiConfig;
  private token: string | null = null;

  constructor(config: ApiConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
    });
    
    // 根据配置设置认证头
    this.setupAuthHeaders();
  }

  setToken(token: string) {
    this.token = token;
    this.setupAuthHeaders();
  }

  getToken(): string | null {
    return this.token;
  }

  private setupAuthHeaders() {
    // 清除之前的认证头
    delete this.client.defaults.headers.common['Authorization'];
    delete this.client.defaults.headers.common['X-API-Key'];
    if (this.config.customHeaderName) {
      delete this.client.defaults.headers.common[this.config.customHeaderName];
    }

    const authType = this.config.authType || 'bearer';
    
    if (authType === 'bearer' && this.token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
    } else if (authType === 'api-key' && this.config.apiKey) {
      this.client.defaults.headers.common['X-API-Key'] = this.config.apiKey;
    } else if (authType === 'custom' && this.config.customHeaderName && this.token) {
      this.client.defaults.headers.common[this.config.customHeaderName] = this.token;
    }
    
    if (this.config.apiKey && !this.client.defaults.headers.common['X-API-Key']) {
      this.client.defaults.headers.common['X-API-Key'] = this.config.apiKey;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.config.versionPath) {
        throw new Error('Version path not configured');
      }
      await this.client.get(this.config.versionPath);
      return true;
    } catch (error) {
      console.error('API connection test failed:', error);
      return false;
    }
  }

  async getModuleVersions(): Promise<ModuleVersion[]> {
    try {
      if (!this.config.versionPath) {
        throw new Error('Version path not configured');
      }
      
      const response = await this.client.get(this.config.versionPath);
      
      return this.parseModuleVersions(response.data);
    } catch (error) {
      console.error('Failed to get module versions:', error);
      if (isAxiosError(error)) {
        console.error('HTTP状态码:', error.response?.status);
        console.error('响应数据:', error.response?.data);
      }
      throw error;
    }
  }

  private parseModuleVersions(data: any): ModuleVersion[] {
    let modules: ModuleVersion[];
    
    const targetModules = [
      '医嘱前端', '医嘱后端',
      '收费前端', '收费后端',
      '药剂前端',
      '门诊前端',
      '公共前端', '公共后端',
      '临床路径前端',
      '医保后端'
    ];

    if (Array.isArray(data)) {
      return data.map((item: any) => ({
        name: item.name || item.module || item.serviceName || item.key || '',
        version: item.version || item.tag || item.currentVersion || item.value || item.ver || '',
        updateTime: item.updateTime || item.lastUpdate || item.updateDate || item.time || ''
      }));
    }

    if (data.data && Array.isArray(data.data)) {
      return data.data.map((item: any) => ({
        name: item.cNName || item.name || item.module || item.serviceName || item.key || '',
        version: item.version || item.tag || item.currentVersion || item.value || item.ver || '',
        updateTime: item.deployTime ? new Date(item.deployTime).toLocaleString('zh-CN') : (item.updateTime || item.lastUpdate || item.updateDate || item.time || '')
      }));
    }

    if (data.modules && Array.isArray(data.modules)) {
      return data.modules.map((item: any) => ({
        name: item.name || item.module || item.serviceName || item.key || '',
        version: item.version || item.tag || item.currentVersion || item.value || item.ver || '',
        updateTime: item.updateTime || item.lastUpdate || item.updateDate || item.time || ''
      }));
    }

    if (data.result && Array.isArray(data.result)) {
      return data.result.map((item: any) => ({
        name: item.name || item.module || item.serviceName || item.key || '',
        version: item.version || item.tag || item.currentVersion || item.value || item.ver || '',
        updateTime: item.updateTime || item.lastUpdate || item.updateDate || item.time || ''
      }));
    }

    if (typeof data === 'object' && data !== null) {
      if (data.code !== undefined || data.status !== undefined || data.success !== undefined) {
        if (data.data && data.data !== data) {
          return this.parseModuleVersions(data.data);
        }
        if (data.result && data.result !== data) {
          return this.parseModuleVersions(data.result);
        }
      }
      
      modules = [];
      for (const key of Object.keys(data)) {
        const isTargetModule = targetModules.some(m => {
          const cleanKey = key.replace(/[^\u4e00-\u9fa5]/g, '');
          const cleanTarget = m.replace(/[^\u4e00-\u9fa5]/g, '');
          return key.includes(m) || m.includes(key) || cleanKey.includes(cleanTarget) || cleanTarget.includes(cleanKey);
        });
        
        if (isTargetModule) {
          const item = data[key];
          modules.push({
            name: key,
            version: typeof item === 'string' ? item : (item.version || item.tag || item.currentVersion || item.value || item.ver || ''),
            updateTime: typeof item === 'object' ? (item.updateTime || item.lastUpdate || item.updateDate || item.time || '') : ''
          });
        }
      }
      return modules;
    }

    return [];
  }

  // 获取日志列表
  async getLogs(queryParam: LogQueryParam): Promise<{ total: number; logs: AnalyzedLogInfo[] }> {
    try {
      if (!this.config.logPath) {
        throw new Error('Log path not configured');
      }

      const response = await this.client.post(this.config.logPath, queryParam);
      
      return this.parseLogs(response.data);
    } catch (error) {
      console.error('Failed to get logs:', error);
      if (isAxiosError(error)) {
        console.error('HTTP状态码:', error.response?.status);
        console.error('响应数据:', error.response?.data);
      }
      throw error;
    }
  }

  // 解析并分析日志数据
  private parseLogs(data: any): { total: number; logs: AnalyzedLogInfo[] } {
    const result: { total: number; logs: AnalyzedLogInfo[] } = {
      total: 0,
      logs: []
    };

    let mapList: any[] = [];
    
    if (data.data && data.data.mapList && Array.isArray(data.data.mapList)) {
      mapList = data.data.mapList;
      result.total = data.data.pageCount || mapList.length;
    } else if (Array.isArray(data)) {
      mapList = data;
      result.total = mapList.length;
    }

    for (const log of mapList) {
      const analyzedLog = this.analyzeLog(log);
      result.logs.push(analyzedLog);
    }

    return result;
  }

  // 分析单条日志，提取有用信息
  private analyzeLog(log: any): AnalyzedLogInfo {
    const result: AnalyzedLogInfo = {
      id: log.id || '',
      logType: log.logType || '',
      logLevel: log.logLevel || '',
      serviceName: log.serviceName || '',
      reqUrl: log.reqUrl || '',
      originalLog: log
    };

    // 提取HTTP信息
    if (log.tags) {
      result.tags = log.tags;
      
      // 从 tags.http.method 获取请求方法
      if (log.tags['http.method']) {
        result.httpMethod = log.tags['http.method'];
      }
      
      // 从 tags.http.statusCode 获取状态码
      if (log.tags['http.statusCode']) {
        result.httpStatus = log.tags['http.statusCode'];
      }
      
      // 从 tags.http.header 中查找Vue文件路径
      if (log.tags['http.header']) {
        const headers = log.tags['http.header'];
        result.vueFile = this.findVueFileInHeaders(headers);
      }
    }

    // 提取其他信息
    result.clientIp = log.clientIp;
    result.operator = log.operator;
    result.runTime = log.runTime;
    
    // 错误信息
    if (log.exClassName) {
      result.errorClass = log.exClassName;
    }
    if (log.exMsg) {
      result.errorMessage = log.exMsg;
    }
    if (log.stack) {
      result.stackTrace = log.stack;
    }

    // 请求参数
    if (log.requestParam) {
      result.requestParams = log.requestParam;
    }

    return result;
  }

  // 从请求头中查找Vue文件路径
  private findVueFileInHeaders(headers: any): string | undefined {
    if (!headers) return undefined;

    const headersString = typeof headers === 'string' ? headers : JSON.stringify(headers);
    
    // 常见的Vue文件路径模式
    const vuePatterns = [
      /([\w/\\-]+\.vue)/g,
      /view\/([\w/\\]+)/g,
      /views\/([\w/\\]+)/g,
      /components\/([\w/\\]+)/g,
      /page[s]*\/([\w/\\]+)/g
    ];

    for (const pattern of vuePatterns) {
      const matches = headersString.match(pattern);
      if (matches && matches.length > 0) {
        // 找到第一个匹配的Vue文件
        return matches[0];
      }
    }

    return undefined;
  }
}
