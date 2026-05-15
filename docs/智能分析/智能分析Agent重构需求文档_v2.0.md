# 智能分析 Agent 重构需求文档 v2.0

## 0. 文档目的

本文档是智能分析模块（`main/agent/` 和 `renderer/pages/Schema.tsx` 中的 AnalysisPage）的**重构需求说明书**，供后续开发（Cursor 等 AI 编码工具）使用。

由于 Cursor 等国外 AI 工具无法理解以下内容，本文档专门补充说明：
- HIS 医院信息系统业务背景
- 内网 GitLab（gitlab.zoesoft.com.cn）对接逻辑
- DeepSeek API 对接方式
- 内部 portal-service / log-manage-service 接口说明
- 版本号与分支的映射规则
- 模块名与服务名的中文映射关系

---

## 1. 项目背景与业务上下文

### 1.1 项目是什么
这是一个 **HIS（医院信息系统）运维辅助工具**，基于 Electron + React + TypeScript 构建。核心功能是：
- 连接 Oracle / 达梦数据库，查询表结构和业务数据
- 通过 DeepSeek LLM 智能分析系统日志，定位问题根因
- 对接内网 GitLab 获取微服务源代码进行分析
- 对接 Redis 获取认证 Token

### 1.2 业务领域术语
| 术语 | 含义 |
|------|------|
| 医嘱 | 医生开具的诊疗指令（处方、检查、护理等） |
| 收费 | 门诊/住院费用结算 |
| 药剂 | 药品管理和发药 |
| 门诊 | 门诊就诊流程 |
| 临床路径 | 标准化诊疗流程 |
| 医保 | 医疗保险结算对接 |
| 公共模块 | 通用组件、配置、日志等基础服务 |
| 前端/后端 | 前端 = Vue Web 应用，后端 = Java 微服务 |

### 1.3 模块与服务的对应关系
系统中维护了以下目标模块，每个模块对应一个 GitLab 代码仓库：

| 模块名称 | 服务名关键词 | 前后端 | GitLab 仓库路径 |
|---------|------------|--------|----------------|
| 医嘱后端 | pres-service | 后端 | onelink/fj-common/onelink-micro-pres-fj-common |
| 收费后端 | charge-service | 后端 | onelink/fj-common/onelink-micro-charge-fj-common |
| 公共后端 | optimus-service | 后端 | onelink/fj-common/onelink-micro-optimus-fj-common |
| 临床路径前端 | clinicpath | 前端 | onelink/fj-common/onelink-web-clinicpath-fj-common |
| 收费前端 | charge-web | 前端 | onelink/fj-common/onelink-web-his-charge-fj-common |
| 药剂前端 | drug-web | 前端 | onelink/fj-common/onelink-web-his-drug-fj-common |
| 公共前端 | component-web | 前端 | onelink/fj-common/onelink-web-his-fj-component |
| 门诊前端 | outp-web | 前端 | onelink/fj-common/onelink-web-outp-fj-common |
| 医嘱前端 | pres-web | 前端 | onelink/fj-common/onelink-web-pres-fj-common |

---

## 2. 现状分析：当前流程的问题

### 2.1 当前流程
```
用户填写表单（问题描述 + 日志ID + 模块版本 + 代码测试面板）
    ↓
点击"开始分析"
    ↓
Agent 后台执行（用户看不到中间过程）
    ├── 强制调用 query_log
    ├── LLM 循环分析
    │   ├── 可能调用 get_code
    │   └── 可能调用 query_business_data
    └── 返回最终结果
```

### 2.2 核心问题
1. **表单过于复杂**：用户需要先看到模块版本、日志内容、代码测试面板，信息过载
2. **分析过程黑盒**：用户点击"开始分析"后只能等待，看不到中间步骤和推理过程
3. **流程难走通**：LLM 调用工具不稳定，经常跳过步骤或参数为空
4. **展现逻辑不清晰**：前端没有分步骤展示，用户不知道当前进行到哪一步

---

## 3. 目标流程设计（重构后）

### 3.1 简化后的分析表单

**只保留两个字段**：
- 问题描述（文本域，必填）
- 日志 ID（输入框，必填）
- 项目（自动从当前激活项目读取，只读展示）

**移除以下内容**（移到后续步骤逐步展示）：
- ~~模块版本表格~~
- ~~日志内容展示面板~~
- ~~代码获取测试面板~~
- ~~AI 模型选择~~（使用全局配置的默认模型）

### 3.2 分步骤交互流程

点击"开始分析"后，进入**对话式分步骤分析界面**。每一步都是 AI 驱动 + 工具调用，结果逐步渲染到对话中。

#### 步骤 1：查询并展示日志内容
```
【系统自动执行】
├── 调用 query_log 工具，根据日志ID查询 log-http* 索引
├── 从返回的日志中筛选 logLevel 为 WARN 或 ERROR 的日志
└── 在对话中展示：
    ├── 日志总数（如：共找到 5 条日志）
    ├── 仅展示错误日志（WARN/ERROR 级别）
    │   ├── 服务名 (serviceName)
    │   ├── 请求 URL (reqUrl)
    │   ├── 状态码 (httpStatus)
    │   ├── 错误类名 (errorClass)
    │   ├── 错误信息 (errorMessage)
    │   ├── 堆栈信息 (stackTrace)
    │   ├── Vue 文件路径 (vueFile)
    │   └── 请求参数 (requestParams)
    └── 如果全部是 INFO 级别，则展示摘要说明"未发现错误日志"
```

#### 步骤 2：识别服务并决定分析方向
```
【AI 分析】
├── 从步骤1的日志中提取 serviceName
├── 判断该服务是前端（Vue Web）还是后端（Java 微服务）
│   └── 判断依据：日志中的 vueFile 字段、reqUrl 特征、errorClass 类型
├── AI 输出：
│   ├── 识别到的服务：XXX（前端/后端）
│   ├── 建议优先排查方向：前端 / 后端
│   └── 理由说明
└── 用户可以在对话中纠正或补充
```

#### 步骤 3：匹配代码仓库
```
【系统自动执行】
├── 从数据库查询当前项目下配置的代码仓库列表（code_repositories 表）
├── 使用 matchCodeRepository(projectId, serviceName, reqUrl) 匹配
│   └── 匹配逻辑：将 serviceName + reqUrl 与每个仓库的 servicePatterns 做包含匹配
├── 如果未匹配到任何仓库：
│   └── 在对话中展示错误：「当前报错的服务 "XXX" 不在项目维护的代码仓库列表中，请确认后重试」
│   └── 列出所有已配置的仓库名称供参考
│   └── 暂停流程，等待用户操作
└── 如果匹配成功：
    └── 展示匹配到的仓库信息（名称、URL、默认分支）
```

#### 步骤 4：获取版本信息并拉取代码
```
【系统自动执行】
├── 调用 getVersionInfo 接口获取代码版本
│   ├── URL: {apiBaseUrl}/portal-service/api/manage/system/getVersionInfo
│   ├── 认证：从 Redis 获取 Token（前缀 ONELINK:TOKEN:），使用 Bearer 方式
│   ├── 请求头附加 apiKey: HIS5
│   └── 返回各模块的版本号（如 release-1.168.28）
│
├── 从版本信息中匹配当前服务的版本号（tag）
│   └── 匹配方式：服务名 → 模块名映射（见 1.3 节）→ 查找对应版本
│
├── 从 tag 推断分支名（inferBranchFromTag）
│   ├── release-0* 开头 → master
│   ├── release-X.Y.Z 格式 → release-X.Y（如 release-1.168.28 → release-1.168）
│   └── 无法匹配 → master
│
├── 通过 GitLab API 拉取对应分支的代码文件列表
│   ├── API: GET /api/v4/projects/{projectPath}/repository/tree?ref={branch}
│   ├── 认证：Private-Token（仓库配置的 gitLabToken 或全局 GitLab Token）
│   └── 在对话中展示：
│       ├── 匹配到的版本 Tag
│       ├── 推断的分支名
│       └── 代码文件列表（前 20 个 .java/.ts/.vue 等源码文件）
```

#### 步骤 5：协调资源进行深度分析
```
【AI 分析 + 用户交互】
AI 在分析代码过程中，判断是否需要协调以下资源：

├── 其他服务的代码
│   └── 调用 get_code(serviceName="其他服务名") 获取关联服务代码
│
├── 更多日志（log-manage-service/log/search 接口）
│   ├── URL: {apiBaseUrl}/log-manage-service/log/search
│   ├── 可用于查询：指定服务的更多日志、指定时间范围的日志、不同日志级别的日志
│   └── 新增工具：query_more_logs(serviceName, logLevel, timeRange)
│
├── 当前表结构
│   └── 从 schema_cache（SQLite 本地缓存）读取相关表的结构信息
│   └── 新增工具：get_table_schema(tableNamePattern)
│
└── 表数据查询
    └── 调用 query_business_data(sql) 执行 SELECT 查询
    └── 严格限制：只允许 SELECT，自动添加 ROWNUM/TOP 100 限制
```

#### 步骤 6：输出分析结论
```
【AI 综合输出】
├── 问题根因
├── 影响范围
├── 涉及的文件和代码位置
├── 解决方案建议
├── 预防措施
└── 如需进一步排查，指出需要补充的信息
```

---

## 4. 技术实现要点

### 4.1 内部 API 接口说明

#### 4.1.1 获取版本信息接口
```
URL:    {baseUrl}/portal-service/api/manage/system/getVersionInfo
Method: GET
Headers:
  Authorization: Bearer {token}     ← token 从 Redis ONELINK:TOKEN:* 获取
  X-API-Key: HIS5                   ← 固定值
Response:
{
  "code": 200,
  "data": [
    { "cNName": "医嘱前端", "version": "release-1.168.28", "deployTime": 1718092800000 },
    { "cNName": "医嘱后端", "version": "release-1.168.28", ... },
    ...
  ]
}
```
注意：返回的 data 字段是数组，每条记录包含 cNName（中文模块名）和 version（版本 tag）。

#### 4.1.2 日志查询接口
```
URL:    {baseUrl}/log-manage-service/log/search
Method: POST
Headers:
  Authorization: Bearer {token}
  X-API-Key: HIS5
Body:
{
  "pageSize": "20",
  "pageNum": "1",
  "indexvalue": "log-http*",
  "logType": "http",
  "serviceName": "",
  "canary": "",
  "traceId": "{logId}",
  "logLevel": [],
  "timestamp": { "startDate": null, "endDate": null },
  "filterParam": {
    "searchType": "2",
    "termChecked": false,
    "matchChecked": true,
    "wildcardChecked": false,
    "operator": "",
    "value": "",
    "searchValue": "{logId}"
  }
}
Response:
{
  "data": {
    "mapList": [
      {
        "id": "...",
        "logLevel": "ERROR",
        "serviceName": "pres-service",
        "reqUrl": "/api/pres/...",
        "tags": { "http.method": "POST", "http.statusCode": "500", ... },
        "exClassName": "NullPointerException",
        "exMsg": "...",
        "stack": "...",
        "requestParam": "...",
        ...
      }
    ],
    "pageCount": 1
  }
}
```

#### 4.1.3 Redis Token 获取
```
连接方式: 使用项目配置的 Redis 连接信息（redisHost, redisPort, redisPassword, redisDb）
获取方式: SCAN 匹配 ONELINK:TOKEN:* 前缀的 Key，取第一个匹配的 Value 作为 Token
已有实现: main/redis.ts 中的 getFirstTokenFromRedis()
```

### 4.2 GitLab 对接说明

```
GitLab 地址: http://gitlab.zoesoft.com.cn
认证方式: Private-Token（通过 URL 参数传递）
API 示例:
  获取文件列表:
    GET /api/v4/projects/{projectPath}/repository/tree?ref={branch}&private_token={token}
  获取文件内容:
    GET /api/v4/projects/{projectPath}/repository/files/{filePath}?ref={branch}&private_token={token}
注意:
  - projectPath 中的 / 需要编码为 %2F
  - 如果指定分支不存在，尝试 main ↔ master 互切换
```

### 4.3 版本号到分支的映射规则

```
规则（已在 main/database/sqlite.ts 的 inferBranchFromTag 中实现）:

1. 如果 tag 以 "release-0" 开头 → 分支为 "master"
   原因：release-0.x.x 是初始版本，直接在主分支开发

2. 如果 tag 匹配 /^release-(\d+\.\d+)/ → 分支为 "release-X.Y"
   示例：release-1.168.28 → release-1.168
         release-2.5.10    → release-2.5

3. 其他情况 → 默认 "master"
```

### 4.4 模块名到服务名的匹配逻辑

当前在 `renderer/stores/analysisStore.ts` 中有 `normalizeModuleVersions` 函数实现了一套复杂的匹配逻辑。重构时建议简化：

```
核心映射（serviceName → moduleName）:
  pres-service / doctor / medical / order    → 医嘱后端
  charge-service / payment                   → 收费后端
  optimus-service / common-service           → 公共后端
  clinicpath / 临床路径                       → 临床路径前端
  charge-web / 收费前端                       → 收费前端
  drug-web / pharmacy                        → 药剂前端
  component-web / 公共前端                    → 公共前端
  outp-web / outpatient                      → 门诊前端
  pres-web / 医嘱前端                         → 医嘱前端
```

### 4.5 DeepSeek API 对接

```
API 地址: https://api.deepseek.com/v1/chat/completions
认证: Bearer {apiKey}
模型: deepseek-chat (当前配置为 deepseek-v4-pro)
已有封装: main/agent/deepseek.ts 中的 DeepSeekClient 类

关键参数:
  - temperature: 0.2 (低温度使 LLM 更严格遵循指令)
  - thinking: { type: 'disabled' } (禁用思考模式)
  - tools: 函数调用工具列表
  - stream: true (流式响应)
```

---

## 5. 前端 UI 设计需求

### 5.1 新建分析表单（简化后）

```
┌──────────────────────────────────────────┐
│  新建分析                                 │
├──────────────────────────────────────────┤
│                                          │
│  问题描述 *                              │
│  ┌────────────────────────────────────┐  │
│  │ 请描述遇到的问题...                 │  │
│  └────────────────────────────────────┘  │
│                                          │
│  日志 ID *                               │
│  ┌────────────────────────────────────┐  │
│  │ 例如：4028838a8e0d3f3f018e...      │  │
│  └────────────────────────────────────┘  │
│                                          │
│  项目（自动读取）                         │
│  ┌────────────────────────────────────┐  │
│  │ XX医院项目                          │  │
│  └────────────────────────────────────┘  │
│                                          │
│           [清空]  [开始分析]              │
└──────────────────────────────────────────┘
```

### 5.2 分析对话界面（分步骤展示）

每一步作为一个独立的对话卡片，逐步展示：

```
┌──────────────────────────────────────────┐
│  🔍 步骤 1：查询日志                      │  ← 步骤标题 + 图标
├──────────────────────────────────────────┤
│  正在查询日志 ID: xxx...                  │  ← 加载状态
│  ✅ 共找到 5 条日志，其中 2 条异常：       │  ← 完成状态
│                                          │
│  ┌─ ERROR ────────────────────────────┐  │
│  │ 服务: pres-service                 │  │
│  │ 请求: POST /api/pres/save          │  │
│  │ 状态码: 500                        │  │
│  │ 错误: NullPointerException         │  │
│  │ ...                                │  │
│  └────────────────────────────────────┘  │
│  ┌─ WARN ─────────────────────────────┐  │
│  │ ...                                │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  🤔 步骤 2：识别服务                      │
├──────────────────────────────────────────┤
│  识别到的服务: pres-service（后端）        │
│  建议优先排查: 后端服务                    │
│  理由: 错误类型为 NullPointerException，  │
│  通常由后端代码逻辑问题引起                │
│                                          │
│  [纠正分析方向]                           │  ← 用户可交互
└──────────────────────────────────────────┘

...（后续步骤类似）
```

### 5.3 对话输入区域（底部常驻）

```
┌──────────────────────────────────────────┐
│  ┌────────────────────────────────────┐  │
│  │ 输入补充信息继续分析...             │  │
│  └────────────────────────────────────┘  │
│                              [发送]      │
└──────────────────────────────────────────┘
```

---

## 6. 后端 Agent 重构要点

### 6.1 当前 Agent 流程（agent.ts）

当前 `runAgentLoop` 的逻辑：
1. **强制第一步**：直接调用 query_log（不经过 LLM）
2. **LLM 循环**：最多 5 轮，每轮 LLM 决定调用什么工具
3. **问题**：流程固定但不够灵活，且前端看不到中间步骤

### 6.2 重构后的 Agent 流程

需要改为**分阶段执行，每个阶段的结果回调前端**：

```
阶段 1: executeQueryLog()
  └── 直接调用 query_log 工具，返回筛选后的 WARN/ERROR 日志
  └── 回调前端展示

阶段 2: identifyService()
  └── 将日志内容发给 LLM，让 LLM 识别服务名和前后端类型
  └── LLM 输出分析建议（优先排查前端还是后端）
  └── 回调前端展示

阶段 3: matchRepository()
  └── 调用 matchCodeRepository 匹配代码仓库
  └── 如果未匹配，回调前端展示错误并暂停
  └── 回调前端展示

阶段 4: fetchVersionAndCode()
  └── 调用 getVersionInfo 获取版本
  └── 匹配当前服务的版本 tag
  └── 调用 inferBranchFromTag 推断分支
  └── 调用 GitLab API 获取代码文件列表
  └── 回调前端展示

阶段 5: deepAnalysis()
  └── LLM 分析代码，判断需要什么额外资源
  └── 根据 LLM 决策调用对应工具：
      - get_code(其他服务)
      - query_more_logs (新增)
      - get_table_schema (新增)
      - query_business_data
  └── 回调前端展示中间结果

阶段 6: conclusion()
  └── LLM 综合所有信息给出结论
  └── 回调前端展示最终报告
```

### 6.3 新增工具

#### query_more_logs 工具
```typescript
{
  name: 'query_more_logs',
  description: '查询更多日志，可按服务名、日志级别、时间范围筛选',
  parameters: {
    serviceName: string,   // 服务名
    logLevel: string[],    // 日志级别筛选，如 ['ERROR', 'WARN']
    timeRange: {           // 时间范围
      startDate: string,
      endDate: string
    }
  }
}
```
实现：调用 `{apiBaseUrl}/log-manage-service/log/search` 接口。

#### get_table_schema 工具
```typescript
{
  name: 'get_table_schema',
  description: '获取数据库表结构信息（从本地 SQLite 缓存读取）',
  parameters: {
    tableNamePattern: string  // 表名关键词，如 'PRESCRIPTION', 'CHARGE'
  }
}
```
实现：从 schema_cache 中按关键词模糊匹配表名，返回表结构（列名、类型、注释）。

---

## 7. 状态管理与数据流

### 7.1 新增前端状态

```typescript
interface AnalysisStep {
  id: string;                          // 步骤ID: 'query_log' | 'identify_service' | ...
  status: 'pending' | 'loading' | 'completed' | 'error';
  title: string;                       // 步骤标题
  content: string;                     // 步骤内容（Markdown）
  data?: any;                          // 步骤数据
  error?: string;                      // 错误信息
  timestamp: string;                   // 时间戳
}
```

### 7.2 IPC 通信

新增 IPC 通道（替代原有 `api:startAnalysis`）：
```typescript
// 分步骤分析
'analysis:startStepByStep'    → 启动分步骤分析
'analysis:stepUpdate'          → 主进程推送步骤更新给渲染进程
'analysis:stepComplete'        → 单个步骤完成
'analysis:allStepsComplete'    → 全部分析完成
'analysis:stepError'           → 步骤出错
```

---

## 8. 与现有代码的关系

### 8.1 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `renderer/pages/Schema.tsx` (AnalysisPage) | 简化表单，重写对话界面为分步骤展示 |
| `renderer/stores/analysisStore.ts` | 新增步骤状态、简化表单状态 |
| `main/agent/agent.ts` | 重构 runAgentLoop 为分阶段执行 |
| `main/agent/tools/index.ts` | 新增 query_more_logs、get_table_schema 工具 |
| `main/agent/tools/queryLog.ts` | 修改 buildLogQueryPrompt，支持只展示异常日志 |
| `main/agent/config.ts` | 更新 SYSTEM_PROMPT 适配新流程 |
| `main/ipc/handlers.ts` | 新增分步骤 IPC 通道 |

### 8.2 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `main/agent/deepseek.ts` | LLM 客户端逻辑不变 |
| `main/agent/tools/gitLab.ts` | GitLab 对接逻辑不变 |
| `main/agent/tools/queryBusinessData.ts` | 业务数据查询逻辑不变 |
| `main/database/sqlite.ts` | 数据库操作逻辑不变 |
| `main/api-client.ts` | API 客户端逻辑不变 |
| `main/redis.ts` | Redis 逻辑不变 |

---

## 9. 注意事项

1. **Token 管理**：分析过程中需要多次调用 API，Token 应在一开始从 Redis 获取并缓存，避免重复连接 Redis
2. **错误处理**：每个步骤都可能失败，需要有友好的错误提示和重试机制
3. **日志筛选**：步骤1只展示 WARN/ERROR 级别，但保留完整日志在内存中供后续分析使用
4. **流式输出**：AI 分析内容应支持流式渲染（已有 DeepSeekClient 的 stream 支持）
5. **用户中断**：支持用户在任意步骤暂停或取消分析
6. **状态持久化**：分析记录保存到 localStorage（已有 zustand persist）
7. **对话连续性**：用户可以在任意步骤插入对话，Agent 需要能理解上下文继续分析

---

## 10. Trae vs Cursor 协同开发建议

### 10.1 推荐分工

| 模块 | 推荐工具 | 原因 |
|------|---------|------|
| Agent 主循环重构 (agent.ts) | **Trae** | 涉及 DeepSeek 对话逻辑、工具调用编排、中文提示词工程，需要理解业务语义 |
| 系统提示词重写 (config.ts) | **Trae** | 中文提示词设计，需要理解 HIS 业务和工具调用约束 |
| 新增工具实现 (query_more_logs, get_table_schema) | **Trae** | 涉及内网 API 对接、Redis Token、GitLab API，Cursor 无法理解 |
| IPC 通道设计 (handlers.ts) | **Trae** | 涉及 Electron 主进程通信模式、步骤回调机制 |
| 前端简化表单 (AnalysisPage 表单区) | **Cursor** | 标准 React + Tailwind 组件，纯 UI 工作 |
| 前端分步骤对话界面 | **Cursor** | 卡片式布局、加载状态、Markdown 渲染，标准前端模式 |
| 状态管理扩展 (analysisStore.ts) | **Cursor** | Zustand store 扩展，标准 TypeScript |
| GitLab 工具逻辑 (gitLab.ts) | **Trae** | 内网 GitLab API 对接逻辑 |

### 10.2 协同策略

1. **先 Trae 后 Cursor**：Trae 先完成后端 Agent 重构和新工具实现，确保核心逻辑跑通
2. **Trae 输出接口契约**：Trae 完成后，输出明确的 IPC 接口文档和数据类型定义
3. **Cursor 做前端**：Cursor 根据接口契约实现前端 UI，不关心后端内部实现
4. **Trae 做联调**：两端完成后，Trae 负责联调，因为涉及 DeepSeek 流式响应和内网 API 调试

### 10.3 不推荐 Cursor 独立完成的部分

以下内容 Cursor **无法独立完成**，必须在 Trae 中做或由 Trae 提供详细的上下文代码：

- ❌ DeepSeek API 调用和工具调用解析（main/agent/deepseek.ts）
- ❌ GitLab 内网 API 对接（main/agent/tools/gitLab.ts）
- ❌ 内网 portal-service / log-manage-service 接口调用
- ❌ Redis Token 获取和认证流程
- ❌ 中文系统提示词（SYSTEM_PROMPT）的设计和调试
- ❌ 模块名 ↔ 服务名的中文映射逻辑

---

**文档版本**：v2.0  
**创建日期**：2026-05-13  
**适用项目**：data-tool (zoehis-helper)