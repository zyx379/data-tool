# zoeDevOps Admin 系统设计书

> 本文档是面向编程 AI 的项目构建指引。后续新增需求模块时，在「模块清单」部分追加即可，无需改动整体架构描述。

---

## 一、项目概述

### 1.1 项目名称

zoeDevOps Admin

### 1.2 项目定位

为现有桌面端工具 zoehis-helper（Electron + React + SQLite 本地存储）提供集中化的管理后台，解决以下核心问题：

1. **数据互通**：当前所有配置（项目、数据源、代码仓库等）存储在本地 SQLite，多用户、多终端无法共享；管理端将数据统一存储到 MySQL，实现跨终端互通。
2. **用户与权限**：引入用户体系与 RBAC 权限模型，为后续审批流程提供角色基础。
3. **数据库变更审批**：提供数据库表结构变更（DDL）的提交→审批→执行流程，规范生产环境变更操作。

### 1.3 现有系统上下文

现有 zoehis-helper 是一个 Electron 桌面应用，核心功能包括：

| 功能 | 说明 |
|------|------|
| 数据查询 | 连接 Oracle/达梦数据库，浏览表结构、执行 SQL 查询 |
| 智能分析 | 基于 DeepSeek AI 的日志分析，自动定位问题（日志→代码→SQL→数据） |
| 项目管理 | 管理项目、数据源、API/Redis 配置、GitLab 代码仓库 |

现有本地数据模型（SQLite）：

| 表 | 核心字段 | 说明 |
|----|----------|------|
| projects | id, name, description, isActive | 项目 |
| data_sources | id, projectId, name, type(oracle/dameng), host, port, sid, serviceName, schema, username, password | 数据源 |
| project_configs | id, projectId, apiBaseUrl, apiTokenPath, apiVersionPath, apiLogPath, redisHost, redisPort, redisPassword, redisDb | API & Redis 配置 |
| code_repositories | id, projectId, name, repositoryUrl, servicePatterns, gitLabToken, defaultBranch | 代码仓库 |
| global_config | id, deepseekApiKey, deepseekBaseUrl, deepseekModel | AI 配置 |
| query_history | id, sql, executedAt, executionTime, rowCount, dataSourceId, dataSourceName | 查询历史 |
| schema_cache | id, dataSourceId, schemaData(JSON), filterPattern, cachedAt | 表结构缓存 |

管理端需要将 projects、data_sources、project_configs、code_repositories、global_config 迁移为服务端管理，query_history 和 schema_cache 可保留在客户端本地。

---

## 二、技术选型

| 层 | 技术 | 版本要求 |
|----|------|----------|
| 后端框架 | Spring Boot | 3.x（JDK 17+） |
| ORM | MyBatis-Plus | 3.5.x |
| 数据库 | MySQL | 8.0+ |
| 缓存 | Redis | 7.x（可选，用于会话/字典缓存） |
| 认证 | Spring Security + JWT | — |
| 接口文档 | Knife4j（Swagger 增强） | 4.x |
| 前端框架 | Vue 3 | 3.4+ |
| UI 组件库 | Element Plus | 2.x |
| 构建工具 | Vite | 5.x |
| 状态管理 | Pinia | 2.x |
| 路由 | Vue Router | 4.x |
| HTTP 客户端 | Axios | 1.x |

---

## 三、系统架构

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   zoeDevOps Admin                    │
│                                                      │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │  Vue 3 前端   │────▶│  Spring Boot 后端 API     │  │
│  │  Element Plus │     │  Spring Security + JWT    │  │
│  │  Pinia/Vite   │     │  MyBatis-Plus             │  │
│  └──────────────┘     └──────────┬───────────────┘  │
│                                  │                   │
│                       ┌──────────▼───────────────┐  │
│                       │        MySQL 8.0          │  │
│                       └──────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 3.2 后端工程结构

```
zoe-devops-admin/
├── pom.xml
├── src/main/java/com/zoe/devops/
│   ├── DevOpsApplication.java
│   ├── common/
│   │   ├── config/          # 全局配置（Security、CORS、MyBatis 等）
│   │   ├── constant/        # 常量定义
│   │   ├── enums/           # 枚举类
│   │   ├── exception/       # 全局异常处理
│   │   ├── result/          # 统一返回体 R<T>、分页体 PageResult<T>
│   │   └── util/            # 工具类
│   ├── security/
│   │   ├── JwtTokenProvider.java
│   │   ├── JwtAuthenticationFilter.java
│   │   ├── SecurityConfig.java
│   │   └── UserDetailsServiceImpl.java
│   ├── module/
│   │   ├── user/            # 用户管理模块
│   │   │   ├── controller/
│   │   │   ├── service/
│   │   │   ├── mapper/
│   │   │   ├── entity/
│   │   │   └── dto/
│   │   ├── project/         # 项目管理模块
│   │   ├── datasource/      # 数据源管理模块
│   │   ├── approval/        # 审批流程模块
│   │   └── ...              # 后续扩展模块
│   └── system/              # 系统管理（字典、日志、配置）
└── src/main/resources/
    ├── application.yml
    ├── application-dev.yml
    ├── application-prod.yml
    └── mapper/              # MyBatis XML（如需要）
```

### 3.3 前端工程结构

```
zoe-devops-admin-web/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── api/                 # 按模块组织的 API 请求
│   ├── assets/              # 静态资源
│   ├── components/          # 公共组件
│   ├── composables/         # 组合式函数
│   ├── layout/              # 布局组件（侧边栏、顶栏、标签页）
│   ├── router/              # 路由配置 + 权限守卫
│   ├── stores/              # Pinia 状态管理
│   ├── styles/              # 全局样式
│   ├── utils/               # 工具函数（request.ts、auth.ts）
│   ├── views/               # 按模块组织的页面
│   │   ├── login/
│   │   ├── dashboard/
│   │   ├── system/          # 用户、角色、菜单、字典
│   │   ├── project/         # 项目、数据源、代码仓库
│   │   ├── approval/        # 审批流程
│   │   └── ...
│   ├── App.vue
│   └── main.ts
├── .env.development
└── .env.production
```

---

## 四、数据库设计

### 4.1 命名规范

- 表名：小写蛇形 `sys_user`、`biz_project`
- 字段名：小写蛇形 `created_at`、`project_id`
- 主键：统一使用 `id` BIGINT 自增
- 通用字段：`created_at`、`updated_at`、`created_by`、`updated_by`、`deleted`（逻辑删除）
- 索引：`idx_表名_字段名`

### 4.2 系统表

#### sys_user（用户表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| username | VARCHAR(50) UK | 用户名 |
| password | VARCHAR(255) | 密码（BCrypt 加密） |
| nickname | VARCHAR(50) | 昵称 |
| email | VARCHAR(100) | 邮箱 |
| phone | VARCHAR(20) | 手机号 |
| avatar | VARCHAR(255) | 头像 URL |
| status | TINYINT | 状态：0-禁用 1-启用 |
| last_login_at | DATETIME | 最后登录时间 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |
| created_by | BIGINT | 创建人 |
| updated_by | BIGINT | 更新人 |
| deleted | TINYINT | 逻辑删除：0-未删除 1-已删除 |

#### sys_role（角色表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| role_code | VARCHAR(50) UK | 角色编码（如 ADMIN、DBA、DEV） |
| role_name | VARCHAR(50) | 角色名称 |
| description | VARCHAR(200) | 描述 |
| sort_order | INT | 排序 |
| status | TINYINT | 状态：0-禁用 1-启用 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### sys_menu（菜单/权限表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| parent_id | BIGINT | 父菜单 ID（0 为顶级） |
| menu_name | VARCHAR(50) | 菜单名称 |
| menu_type | TINYINT | 类型：1-目录 2-菜单 3-按钮 |
| path | VARCHAR(200) | 路由路径 |
| component | VARCHAR(200) | 前端组件路径 |
| permission | VARCHAR(100) | 权限标识（如 system:user:list） |
| icon | VARCHAR(50) | 图标 |
| sort_order | INT | 排序 |
| visible | TINYINT | 是否可见：0-隐藏 1-显示 |
| status | TINYINT | 状态 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### sys_user_role（用户-角色关联）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| user_id | BIGINT | 用户 ID |
| role_id | BIGINT | 角色 ID |

#### sys_role_menu（角色-菜单关联）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| role_id | BIGINT | 角色 ID |
| menu_id | BIGINT | 菜单 ID |

#### sys_dict_type（字典类型）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| dict_code | VARCHAR(50) UK | 字典编码 |
| dict_name | VARCHAR(100) | 字典名称 |
| status | TINYINT | 状态 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### sys_dict_data（字典数据）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| dict_code | VARCHAR(50) | 字典编码 |
| label | VARCHAR(100) | 显示文本 |
| value | VARCHAR(100) | 存储值 |
| sort_order | INT | 排序 |
| status | TINYINT | 状态 |

#### sys_operation_log（操作日志）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| user_id | BIGINT | 操作人 |
| module | VARCHAR(50) | 模块名 |
| action | VARCHAR(50) | 操作类型 |
| method | VARCHAR(200) | 请求方法 |
| request_url | VARCHAR(500) | 请求 URL |
| request_params | TEXT | 请求参数 |
| response_result | TEXT | 响应结果 |
| ip | VARCHAR(50) | IP 地址 |
| duration | BIGINT | 耗时(ms) |
| status | TINYINT | 0-失败 1-成功 |
| error_msg | TEXT | 错误信息 |
| created_at | DATETIME | |

### 4.3 业务表

#### biz_project（项目表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| project_name | VARCHAR(100) | 项目名称 |
| description | VARCHAR(500) | 描述 |
| status | TINYINT | 状态：0-禁用 1-启用 |
| created_at | DATETIME | |
| updated_at | DATETIME | |
| created_by | BIGINT | |
| updated_by | BIGINT | |
| deleted | TINYINT | |

#### biz_datasource（数据源表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 所属项目 ID |
| name | VARCHAR(100) | 数据源名称 |
| type | VARCHAR(20) | 类型：oracle / dameng / mysql |
| host | VARCHAR(200) | 主机地址 |
| port | INT | 端口 |
| sid | VARCHAR(100) | Oracle SID |
| service_name | VARCHAR(100) | Oracle Service Name |
| schema_name | VARCHAR(100) | 数据库名/Schema |
| username | VARCHAR(100) | 用户名 |
| password | VARCHAR(500) | 密码（AES 加密存储） |
| status | TINYINT | 状态 |
| created_at | DATETIME | |
| updated_at | DATETIME | |
| created_by | BIGINT | |
| updated_by | BIGINT | |
| deleted | TINYINT | |

#### biz_project_config（项目配置表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| project_id | BIGINT UK | 所属项目 ID |
| api_base_url | VARCHAR(500) | API 基础地址 |
| api_token_path | VARCHAR(200) | Token 路径 |
| api_version_path | VARCHAR(200) | 版本查询路径 |
| api_log_path | VARCHAR(200) | 日志查询路径 |
| redis_host | VARCHAR(200) | Redis 地址 |
| redis_port | INT | Redis 端口 |
| redis_password | VARCHAR(500) | Redis 密码（AES 加密） |
| redis_db | INT | Redis 库号 |
| created_at | DATETIME | |
| updated_at | DATETIME | |
| created_by | BIGINT | |
| updated_by | BIGINT | |

#### biz_code_repository（代码仓库表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| project_id | BIGINT | 所属项目 ID |
| name | VARCHAR(100) | 仓库名称 |
| repository_url | VARCHAR(500) | 仓库地址 |
| service_patterns | VARCHAR(500) | 服务匹配模式（逗号分隔） |
| gitlab_token | VARCHAR(500) | GitLab Token（AES 加密） |
| default_branch | VARCHAR(50) | 默认分支 |
| created_at | DATETIME | |
| updated_at | DATETIME | |
| created_by | BIGINT | |
| updated_by | BIGINT | |
| deleted | TINYINT | |

#### biz_global_config（全局配置表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| config_key | VARCHAR(100) UK | 配置键 |
| config_value | TEXT | 配置值（敏感值 AES 加密） |
| config_desc | VARCHAR(200) | 配置说明 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### 4.4 审批流程表

#### biz_approval_workflow（审批流程定义）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| workflow_code | VARCHAR(50) UK | 流程编码（如 DDL_CHANGE） |
| workflow_name | VARCHAR(100) | 流程名称 |
| description | VARCHAR(500) | 描述 |
| status | TINYINT | 状态：0-禁用 1-启用 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### biz_approval_node（审批节点定义）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| workflow_id | BIGINT | 所属流程 ID |
| node_name | VARCHAR(100) | 节点名称（如 提交、DBA审核、执行） |
| node_type | TINYINT | 类型：1-发起 2-审批 3-执行 |
| node_order | INT | 节点顺序 |
| role_id | BIGINT | 审批角色 ID（node_type=2 时） |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### biz_approval_instance（审批实例）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| workflow_id | BIGINT | 流程定义 ID |
| title | VARCHAR(200) | 申请标题 |
| applicant_id | BIGINT | 申请人 ID |
| current_node_id | BIGINT | 当前节点 ID |
| status | TINYINT | 状态：0-草稿 1-审批中 2-已通过 3-已拒绝 4-已撤回 5-执行中 6-已完成 7-执行失败 |
| project_id | BIGINT | 关联项目 |
| datasource_id | BIGINT | 关联数据源 |
| created_at | DATETIME | |
| updated_at | DATETIME | |
| deleted | TINYINT | |

#### biz_approval_record（审批记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| instance_id | BIGINT | 审批实例 ID |
| node_id | BIGINT | 审批节点 ID |
| operator_id | BIGINT | 操作人 ID |
| action | TINYINT | 操作：1-提交 2-同意 3-拒绝 4-撤回 5-执行 |
| comment | TEXT | 审批意见 |
| created_at | DATETIME | |

#### biz_ddl_change（DDL 变更详情）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| instance_id | BIGINT UK | 审批实例 ID |
| change_type | VARCHAR(20) | 变更类型：ADD_TABLE / ADD_COLUMN / MODIFY_COLUMN / DROP_COLUMN / ADD_INDEX / DROP_INDEX / RENAME |
| target_table | VARCHAR(100) | 目标表名 |
| ddl_sql | TEXT | DDL SQL 语句 |
| rollback_sql | TEXT | 回滚 SQL 语句 |
| change_desc | TEXT | 变更说明 |
| exec_result | TEXT | 执行结果 |
| created_at | DATETIME | |

---

## 五、模块清单

> 📌 **后续新增模块在此追加**，每个模块包含：模块名、功能描述、涉及的表、核心 API、前端页面。

### 模块 1：用户与权限（system）

**功能**：
- 用户 CRUD、启用/禁用、重置密码
- 角色 CRUD、分配菜单权限
- 菜单树管理（目录/菜单/按钮三级）
- 登录/登出、JWT Token 刷新
- 字典管理
- 操作日志查询

**核心 API**：

```
POST   /api/auth/login              # 登录
POST   /api/auth/logout             # 登出
POST   /api/auth/refresh            # 刷新 Token
GET    /api/auth/userinfo           # 获取当前用户信息+权限

GET    /api/system/users            # 用户列表（分页）
POST   /api/system/users            # 创建用户
PUT    /api/system/users/{id}       # 更新用户
DELETE /api/system/users/{id}       # 删除用户
PUT    /api/system/users/{id}/reset-password  # 重置密码
PUT    /api/system/users/{id}/status           # 启用/禁用

GET    /api/system/roles            # 角色列表
POST   /api/system/roles            # 创建角色
PUT    /api/system/roles/{id}       # 更新角色
DELETE /api/system/roles/{id}       # 删除角色
PUT    /api/system/roles/{id}/menus # 分配菜单权限

GET    /api/system/menus/tree       # 菜单树
POST   /api/system/menus            # 创建菜单
PUT    /api/system/menus/{id}       # 更新菜单
DELETE /api/system/menus/{id}       # 删除菜单

GET    /api/system/dicts            # 字典列表
POST   /api/system/dicts            # 创建字典
GET    /api/system/dicts/{code}/data # 获取字典数据

GET    /api/system/logs             # 操作日志列表
```

**前端页面**：
- 登录页
- 系统管理 → 用户管理
- 系统管理 → 角色管理
- 系统管理 → 菜单管理
- 系统管理 → 字典管理
- 系统管理 → 操作日志

### 模块 2：项目管理（project）

**功能**：
- 项目 CRUD
- 数据源管理（每个项目可配置多个数据源，支持 Oracle/达梦/MySQL）
- API & Redis 配置
- 代码仓库管理
- 全局配置管理（DeepSeek API Key 等）

**核心 API**：

```
GET    /api/projects                # 项目列表
POST   /api/projects                # 创建项目
PUT    /api/projects/{id}           # 更新项目
DELETE /api/projects/{id}           # 删除项目

GET    /api/projects/{id}/datasources          # 项目数据源列表
POST   /api/projects/{id}/datasources          # 创建数据源
PUT    /api/datasources/{id}                   # 更新数据源
DELETE /api/datasources/{id}                   # 删除数据源
POST   /api/datasources/{id}/test-connection   # 测试连接

GET    /api/projects/{id}/config     # 获取项目配置
PUT    /api/projects/{id}/config     # 更新项目配置

GET    /api/projects/{id}/repositories          # 代码仓库列表
POST   /api/projects/{id}/repositories          # 创建仓库
PUT    /api/repositories/{id}                   # 更新仓库
DELETE /api/repositories/{id}                   # 删除仓库

GET    /api/global-configs           # 全局配置列表
PUT    /api/global-configs           # 更新全局配置
```

**前端页面**：
- 项目管理 → 项目列表
- 项目管理 → 数据源管理
- 项目管理 → API & Redis 配置
- 项目管理 → 代码仓库
- 项目管理 → 全局配置

### 模块 3：数据库变更审批（approval）

**功能**：
- 审批流程定义（可视化配置审批节点）
- DDL 变更申请（选择项目+数据源，填写变更 SQL 和回滚 SQL）
- 审批操作（同意/拒绝/撤回）
- 变更执行（审批通过后在线执行 DDL）
- 审批历史查询

**核心 API**：

```
GET    /api/approval/workflows       # 流程定义列表
POST   /api/approval/workflows       # 创建流程定义
PUT    /api/approval/workflows/{id}  # 更新流程定义
GET    /api/approval/workflows/{id}/nodes  # 获取流程节点

POST   /api/approval/instances       # 提交审批申请
GET    /api/approval/instances       # 审批实例列表（支持按状态/申请人筛选）
GET    /api/approval/instances/{id}  # 审批详情
PUT    /api/approval/instances/{id}/revoke   # 撤回申请

POST   /api/approval/instances/{id}/approve  # 审批通过
POST   /api/approval/instances/{id}/reject   # 审批拒绝
POST   /api/approval/instances/{id}/execute  # 执行变更

GET    /api/approval/instances/{id}/records   # 审批记录
GET    /api/approval/instances/{id}/ddl       # DDL 变更详情

GET    /api/approval/my-pending     # 我的待审批
GET    /api/approval/my-applied     # 我的申请
```

**前端页面**：
- 审批管理 → 流程定义
- 审批管理 → 提交变更
- 审批管理 → 我的待审批
- 审批管理 → 我的申请
- 审批管理 → 审批历史

---

## 六、接口规范

### 6.1 统一返回体

```json
{
  "code": 200,
  "message": "操作成功",
  "data": {}
}
```

- `code`：200 成功，401 未认证，403 无权限，500 服务端错误，其他业务错误码自定义
- 分页返回：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "records": [],
    "total": 100,
    "current": 1,
    "size": 10
  }
}
```

### 6.2 认证方式

- 登录成功返回 `accessToken` + `refreshToken`
- 请求头：`Authorization: Bearer {accessToken}`
- accessToken 过期后用 refreshToken 刷新
- accessToken 有效期 2 小时，refreshToken 有效期 7 天

### 6.3 密码策略

- 存储：BCrypt 加密
- 传输：HTTPS + 前端不明文传输（登录接口传输 Base64 编码即可，服务端解码后 BCrypt 验证）
- 敏感配置（数据源密码、Redis 密码、GitLab Token、API Key）：AES 加密存储，密钥配置在 application.yml 中

---

## 七、前端设计规范

### 7.1 布局

- 经典后台布局：左侧菜单 + 顶部导航栏 + 内容区 + 标签页
- 左侧菜单根据用户权限动态渲染
- 支持菜单折叠/展开

### 7.2 主题

- 主色调：蓝色系（与现有 zoehis-helper 风格一致）
- Element Plus 默认主题，适度定制
- 支持亮色/暗色模式切换（预留）

### 7.3 交互规范

- 列表页：搜索条件 + 表格 + 分页
- 表单页：弹窗或抽屉
- 删除操作：二次确认
- 批量操作：表格多选 + 批量按钮
- 消息提示：操作成功/失败统一使用 ElMessage

### 7.4 权限控制

- 路由守卫：未登录跳转登录页，无权限跳转 403 页面
- 菜单权限：根据后端返回的菜单树动态生成路由
- 按钮权限：`v-permission` 指令控制按钮显隐

---

## 八、初始化数据

### 8.1 默认角色

| role_code | role_name | 说明 |
|-----------|-----------|------|
| SUPER_ADMIN | 超级管理员 | 拥有所有权限 |
| ADMIN | 管理员 | 系统管理权限 |
| DBA | 数据库管理员 | 数据源管理、DDL 审批权限 |
| DEV | 开发人员 | 项目查看、提交变更申请 |

### 8.2 默认管理员

- 用户名：admin
- 密码：admin123（首次登录强制修改）

### 8.3 默认审批流程

- 流程编码：DDL_CHANGE
- 流程名称：数据库表结构变更
- 节点：提交 → DBA 审核 → 执行

### 8.4 默认字典

- 数据源类型：oracle、dameng、mysql
- 审批状态：草稿、审批中、已通过、已拒绝、已撤回、执行中、已完成、执行失败
- DDL 变更类型：ADD_TABLE、ADD_COLUMN、MODIFY_COLUMN、DROP_COLUMN、ADD_INDEX、DROP_INDEX、RENAME

---

## 九、非功能性要求

### 9.1 安全

- 所有接口需认证（登录接口除外）
- 密码 BCrypt 加密存储
- 敏感配置 AES 加密存储
- SQL 注入防护（MyBatis-Plus 参数化查询）
- XSS 防护（前端输入过滤 + 后端输出转义）
- CORS 限制为前端域名

### 9.2 日志

- 操作日志：记录关键业务操作（增删改）
- 登录日志：记录登录/登出
- 审批日志：记录审批全流程

### 9.3 性能

- 分页查询必须使用数据库分页，禁止内存分页
- 列表接口响应时间 < 500ms
- 大表查询考虑索引优化

### 9.4 部署

- 后端打包为可执行 JAR
- 前端打包为静态文件，Nginx 代理
- 提供 docker-compose.yml 一键部署（MySQL + Redis + 后端 + 前端）

---

## 十、开发约束

1. 后端代码使用 Java 17+ 特性（record、sealed class 等按需使用）
2. 统一使用 MyBatis-Plus 的 IService/BaseMapper 体系，减少样板代码
3. Controller 层只做参数校验和调用 Service，不写业务逻辑
4. Service 层事务注解 @Transactional 加在写操作方法上
5. 前端使用 TypeScript，组件使用 `<script setup lang="ts">` 语法
6. API 请求统一通过 `src/utils/request.ts` 封装的 Axios 实例
7. 所有接口路径以 `/api/` 开头
8. 数据库变更使用 Flyway 管理，脚本放在 `resources/db/migration/` 下
9. 敏感信息（数据库密码、JWT 密钥、AES 密钥）不硬编码，通过环境变量或配置文件注入

---

## 十一、与现有客户端的对接方案

管理端上线后，zoehis-helper 客户端需要改造为从管理端 API 获取配置数据：

1. 客户端增加「登录」功能，使用管理端账号认证
2. 登录后通过 API 拉取项目列表、数据源、配置等
3. 本地 SQLite 中的 projects、data_sources、project_configs、code_repositories、global_config 表不再使用，改为 API 调用
4. 本地 query_history、schema_cache 保留在客户端
5. 客户端新增 DDL 变更提交入口，调用管理端审批 API

---

## 附录：变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-05-14 | v1.0 | 初始版本：用户权限、项目管理、DDL 审批三大模块 |
