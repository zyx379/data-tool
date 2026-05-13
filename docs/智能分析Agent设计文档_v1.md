# 智能分析 Agent 设计文档

## 1. 概述

### 1.1 项目背景
HIS（医院信息系统）在运行过程中会产生大量日志，传统的日志分析方式需要人工排查，效率低下。本系统通过引入智能 Agent，实现自动化问题定位和分析，提高运维效率。

### 1.2 核心目标
- 自动化日志分析和问题定位
- 整合多源数据（日志、代码、业务数据）
- 提供可操作的解决方案建议
- 支持交互式对话式分析

---

## 2. 功能说明

### 2.1 核心功能

#### 2.1.1 日志查询与分析
- **功能描述**：根据日志ID查询综合日志（log-http*），提取关键信息
- **关键信息提取**：
  - 服务名称（service_name）
  - 请求方法与URL
  - 状态码与响应时间
  - 错误类名与错误信息
  - 堆栈信息
  - Vue文件路径
  - 请求参数
  - 客户端IP与操作人

#### 2.1.2 代码检索
- **功能描述**：根据服务名称从GitLab仓库获取相关代码
- **支持功能**：
  - 按服务名获取整个项目
  - 按文件路径获取特定文件
  - 分支切换支持

#### 2.1.3 业务数据查询
- **功能描述**：执行SQL查询获取业务上下文数据
- **应用场景**：
  - 查询患者信息
  - 查询订单状态
  - 查询业务指标
  - 数据验证与核对

#### 2.1.4 智能分析
- **功能描述**：综合多源信息进行深度分析
- **分析内容**：
  - 问题根因分析
  - 影响范围评估
  - 解决方案建议
  - 预防措施推荐

#### 2.1.5 交互式对话
- **功能描述**：支持用户与Agent进行多轮对话
- **交互能力**：
  - 追问细节
  - 补充信息
  - 验证假设
  - 调整分析方向

### 2.2 辅助功能

#### 2.2.1 模块版本管理
- 自动获取各模块版本信息
- 版本历史记录
- 版本比对功能

#### 2.2.2 分析历史管理
- 历史记录存储
- 记录状态追踪（分析中/已完成/已解决/未解决）
- 反馈记录功能

---

## 3. Agent 架构设计

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户界面层 (Renderer)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  新建分析页面  │  │  分析历史页面  │  │   分析详情对话页面    │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        IPC 通信层 (Electron)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Agent 核心层 (Main Process)                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  HISAnalysisAgent                         │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Agent 主循环 (runAgentLoop)            │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  DeepSeek API│  │  工具系统     │  │   对话记忆管理       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────────┐
│   日志查询    │    │   GitLab代码   │    │   业务数据库查询   │
│    工具       │    │    获取工具    │    │       工具        │
└───────────────┘    └───────────────┘    └───────────────────┘
```

### 3.2 核心组件

#### 3.2.1 HISAnalysisAgent（主 Agent 类）

**文件位置**：`main/agent/agent.ts`

**主要职责**：
- 协调分析流程
- 管理对话上下文
- 调用 LLM API
- 执行工具调用
- 控制迭代次数

**核心方法**：
- `analyze(request)`：启动新的分析任务
- `chat(userMessage, dataSourceId)`：继续对话
- `runAgentLoop(dataSourceId)`：Agent 主循环
- `reset()`：重置对话状态

**配置参数**：
```typescript
interface AgentConfig {
  apiKey?: string;           // DeepSeek API Key
  baseUrl?: string;          // API 基础 URL
  model?: string;            // 模型名称
  maxIterations?: number;    // 最大迭代次数（默认5）
  streamCallback?: (content: string) => void;  // 流式回调
}
```

#### 3.2.2 工具系统（Tools）

**文件位置**：`main/agent/tools/`

**工具列表**：

| 工具名称 | 功能描述 | 参数 |
|---------|---------|------|
| `query_log` | 查询日志详情 | logId, tableName |
| `get_code` | 从GitLab获取代码 | serviceName, filePath |
| `query_business_data` | 执行SQL查询 | sql, description |

**工具定义**：`main/agent/config.ts`

#### 3.2.3 DeepSeek 客户端

**文件位置**：`main/agent/deepseek.ts`

**主要功能**：
- 封装 DeepSeek API 调用
- 支持流式响应
- 工具调用解析
- 消息格式化

#### 3.2.4 对话记忆管理

**数据结构**：`main/agent/types.ts`

```typescript
interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}
```

### 3.3 工作流程

#### 3.3.1 新建分析流程

```
用户输入问题描述和日志ID
         ↓
   初始化 Agent
         ↓
   推送系统提示词
         ↓
   推送用户问题
         ↓
   ┌──────────────────────┐
   │   Agent 主循环开始    │
   └──────────────────────┘
         ↓
   调用 LLM 获取响应
         ↓
   是否有工具调用？
    ├─ 是 → 执行工具 → 添加工具结果到对话 → 返回循环
    └─ 否 → 结束分析 → 返回结果
```

#### 3.3.2 工具执行流程

```
LLM 返回工具调用指令
         ↓
   解析工具名称和参数
         ↓
   根据工具名称路由
         ↓
   ┌─────────────────────────────────┐
   │   query_log  │  get_code  │ ... │
   └─────────────────────────────────┘
         ↓
   执行具体工具逻辑
         ↓
   返回工具执行结果
         ↓
   格式化结果添加到对话
```

---

## 4. 技术实现

### 4.1 技术栈

| 层级 | 技术选型 |
|-----|---------|
| 前端框架 | React + TypeScript |
| 状态管理 | Zustand |
| UI 组件 | Tailwind CSS |
| 桌面应用 | Electron |
| 后端运行时 | Node.js |
| 数据库 | SQLite（本地） + Oracle/Dameng（业务） |
| 缓存 | Redis |
| LLM | DeepSeek API |
| 代码仓库 | GitLab API |

### 4.2 核心算法

#### 4.2.1 Agent 思考-行动循环

**伪代码**：
```
function runAgentLoop():
    iteration = 0
    while iteration < maxIterations:
        response = callLLM(conversation)
        
        if hasToolCalls(response):
            for toolCall in response.toolCalls:
                result = executeTool(toolCall)
                addToConversation(toolResultMessage)
        else:
            break
            
        iteration += 1
        
    return finalResult
```

#### 4.2.2 工具调用解析

从 LLM 响应中解析工具调用，支持 OpenAI 兼容格式：
- `tool_calls` 字段解析
- 参数 JSON 验证
- 错误处理与重试

### 4.3 数据流转

```
用户界面 (React)
    ↓ [IPC: api:startAnalysis]
主进程 IPC 处理器
    ↓
HISAnalysisAgent.analyze()
    ↓
Agent 主循环
    ├─→ DeepSeek API (LLM 推理)
    ├─→ Tool: query_log (API 调用)
    ├─→ Tool: get_code (GitLab API)
    └─→ Tool: query_business_data (数据库查询)
    ↓
返回分析结果
    ↓ [IPC 回调]
更新前端状态 (Zustand)
    ↓
渲染对话界面
```

---

## 5. 系统提示词设计

### 5.1 系统提示词（SYSTEM_PROMPT）

**文件位置**：`main/agent/config.ts`

**核心内容**：
1. 角色定义：专业的 HIS 运维分析助手
2. 工作流程：按步骤执行分析
3. 工具使用规则：明确何时使用哪个工具
4. 输出格式要求：规范的分析报告格式
5. 注意事项：确保分析质量

### 5.2 提示词工程要点

- **明确角色**：限定在 HIS 运维领域
- **流程引导**：给出清晰的分析步骤
- **工具约束**：规定工具使用顺序和场景
- **输出规范**：要求结构化的分析结果
- **质量要求**：强调可操作性和准确性

---

## 6. 状态管理

### 6.1 分析状态（AnalysisStore）

**文件位置**：`renderer/stores/analysisStore.ts`

**状态字段**：
```typescript
{
  records: AnalysisRecord[];           // 分析历史记录
  currentRecord: AnalysisRecord | null; // 当前查看的记录
  streamingContent: string;             // 流式响应内容
  moduleVersions: ModuleVersion[];      // 模块版本列表
  isLoadingVersions: boolean;           // 版本加载状态
  versionsError: string | null;         // 版本错误信息
  logs: AnalyzedLogInfo[];              // 日志列表
  isLoadingLogs: boolean;               // 日志加载状态
  logsError: string | null;             // 日志错误信息
  logsTotal: number;                    // 日志总数
  currentTraceId: string;               // 当前Trace ID
  selectedLog: AnalyzedLogInfo | null;  // 选中的日志
}
```

**分析记录结构**：
```typescript
interface AnalysisRecord {
  id: string;
  title: string;
  description: string;
  logId: string;
  projectId: string;
  projectName: string;
  aiModel: string;
  status: AnalysisStatus;  // analyzing | completed | unconfirmed | resolved | unresolved
  feedback?: string;
  conversation: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}
```

---

## 7. 配置管理

### 7.1 DeepSeek 配置

```typescript
export const DEEPSEEK_CONFIG = {
  apiKey: 'sk-...',              // API Key
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',         // 模型名称
  maxTokens: 4096,               // 最大Token数
  temperature: 0.7,              // 温度参数
};
```

### 7.2 GitLab 配置

```typescript
export const GITLAB_CONFIG = {
  baseUrl: 'http://gitlab.zoesoft.com.cn',
  token: 'glpat-...',            // 访问令牌
  defaultBranch: 'main',         // 默认分支
};
```

### 7.3 Agent 配置

- `maxIterations`：最大迭代次数（默认5）
- 控制 Agent 不会无限循环
- 平衡分析深度和响应时间

---

## 8. 扩展机制

### 8.1 添加新工具

**步骤**：

1. 在 `main/agent/tools/` 下创建新工具文件
2. 实现工具函数，遵循 `ToolExecutor` 接口
3. 在 `main/agent/tools/index.ts` 中注册
4. 在 `main/agent/config.ts` 中添加工具定义

**示例**：
```typescript
// 1. 创建工具文件
export async function myNewTool(args: MyToolArgs, dataSourceId: string): Promise<ToolResult> {
  // 实现逻辑
}

// 2. 注册工具
registerTool('my_new_tool', myNewTool, toolDefinition);
```

### 8.2 自定义提示词

修改 `main/agent/config.ts` 中的 `SYSTEM_PROMPT`，可以：
- 调整 Agent 角色定位
- 优化工作流程
- 添加特定领域知识
- 调整输出格式

### 8.3 多 Agent 协作（未来扩展）

可以引入多个专门 Agent：
- **日志分析 Agent**：专注于日志理解
- **代码分析 Agent**：专注于代码审查
- **SQL 专家 Agent**：专注于数据查询
- **协调 Agent**：负责任务分发和结果整合

---

## 9. 最佳实践

### 9.1 日志查询优化

- 优先使用日志ID精确查询
- 合理设置查询范围
- 注意日志表的索引优化

### 9.2 Agent 迭代控制

- 简单问题设置 `maxIterations=2-3`
- 复杂问题可设置为 `5-8`
- 监控 Token 使用量

### 9.3 提示词优化

- 使用清晰的指令
- 提供示例输出格式
- 明确约束条件
- 定期根据反馈迭代

---

## 10. 故障排查

### 10.1 常见问题

| 问题 | 可能原因 | 解决方案 |
|-----|---------|---------|
| Agent 不调用工具 | 提示词问题 | 检查 SYSTEM_PROMPT |
| 工具调用失败 | 参数错误 | 验证工具参数格式 |
| API 调用超时 | 网络问题 | 检查网络连接和代理 |
| Token 消耗过高 | 对话太长 | 优化上下文管理 |

### 10.2 日志记录

系统在 `logs/` 目录下记录 API 响应，便于排查问题。

---

## 11. 未来规划

### 11.1 短期规划
- [ ] 支持更多日志类型（SQL、Dubbo等）
- [ ] 优化 Agent 提示词
- [ ] 添加分析模板
- [ ] 支持批量日志分析

### 11.2 长期规划
- [ ] 多 Agent 协作
- [ ] 知识库集成
- [ ] 自动化修复建议
- [ ] 问题预测与预警

---

## 附录

### A. 文件结构

```
data-tool/
├── main/
│   └── agent/
│       ├── agent.ts              # 主 Agent 类
│       ├── config.ts             # 配置与提示词
│       ├── deepseek.ts           # DeepSeek API 客户端
│       ├── types.ts              # 类型定义
│       ├── index.ts              # 导出入口
│       └── tools/
│           ├── index.ts          # 工具注册中心
│           ├── queryLog.ts       # 日志查询工具
│           ├── gitLab.ts         # GitLab 工具
│           └── queryBusinessData.ts  # 业务数据工具
├── renderer/
│   ├── pages/
│   │   └── Schema.tsx            # 智能分析页面
│   └── stores/
│       └── analysisStore.ts      # 分析状态管理
└── docs/
    └── 智能分析Agent设计文档.md  # 本文档
```

### B. API 参考

详见代码注释和类型定义。

---

**文档版本**：v1.0  
**最后更新**：2026-05-12  
**维护团队**：HIS 运维工具组
