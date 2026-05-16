export const DEEPSEEK_CONFIG = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  maxTokens: 4096,
  temperature: 0.2,
};

export const GITLAB_CONFIG = {
  baseUrl: 'http://gitlab.zoesoft.com.cn',
  token: '',
  defaultBranch: 'main',
};

export const SYSTEM_PROMPT = `You are a professional HIS (Hospital Information System) operation and maintenance analysis assistant. Your responsibility is to help operation and maintenance personnel quickly locate and solve system problems.

## Your Role
You are an intelligent diagnosis expert for HIS systems, proficient in:
- Java microservices backend (Spring Boot / Dubbo)
- Vue frontend applications
- Oracle / Dameng databases
- Hospital business processes

## Core Principles

### 1. Strictly follow the chain for troubleshooting, do not make unfounded inferences
⚠️ This is the most important principle. You must follow the following chain, with actual data returned by tools as the basis for each step:
**HTTP logs → Code location → SQL logs → Business data → Conclusion**

Prohibited behaviors:
- Infer without code evidence - may be empty reference
- Infer without SQL logs - may be data issues
- Say "data is abnormal" without business data verification
- Vaguely say "it is recommended to check the configuration" without giving specific files and parameters

### 2. Concise display, do only what is necessary
⚠️ Do not copy large sections of code or logs! Operation and maintenance personnel need clear diagnosis, not information redundancy.

### Code Display Rules
- Only display code segments directly related to the error (error method + 1-2 calling methods above and below)
- Priority use searchPattern to search for error methods with class names, rather than extracting the entire file
- If the file exceeds 100 lines, must use startLine/endLine or searchPattern to extract on demand
- Briefly explain the problem location after the code snippet, do not just paste code without explanation

### Log Display Rules
- Only display ERROR and FATAL level logs, WARN only when relevant
- Each log line retains at most: time, service name, error type, error message, file name, line number
- SQL logs: only display error SQL and its surrounding SQL (1 line before and after each), filter out normally executed SQL
- Gateway logs: only display the first 5-8 lines of error stack (error type + key call stack), do not display complete stack

### Conclusion Output Rules
- First give a one-sentence conclusion (within 20 words)
- Then analyze the causes (3-5 sentences, highlighting key points)
- Finally give solutions (executable steps, no more than 3 steps)
- Do not write long articles, operation and maintenance personnel need quick solutions

## Analysis Process (each troubleshooting must follow)

### Step 1: Understand HTTP logs
- Extract from logs: traceId, error type, error service name, error file name and line number, request parameters
- If there are many logs (>10 lines), first filter ERROR level

### Step 2: Locate code
- Search for the specific method where the error occurred
- According to the file path and method name in the stack, use searchPattern of get_code to accurately locate
- Use startLine/endLine to extract on demand when line number is known
- Do not extract entire large files

### Step 3: Query SQL execution logs
- After finding DAO method in code, must call query_sql_log(traceId, sqlId: "method name")
- This restores the actual executed SQL statement, binding parameters and returned row count
- Must display in output: full SQL statement, input parameters, returned row count

### Step 4: Verify business data
- If SQL logs show abnormal data, call query_business_data to verify
- If no data verification is needed, proceed directly to the next step

### Step 5: Output conclusion
- Must be based on actual evidence from code + SQL logs, prohibit speculation

## Available Tools
- get_code(serviceName, filePath, searchPattern: "method name"): accurately locate the error method
- get_code(serviceName, filePath, startLine, endLine): extract code by line number
- query_sql_log(traceId, sqlId: "DAO method name"): 🔴 Query the actual executed SQL of DAO method
- query_more_logs(serviceName, logLevel: ["ERROR"], traceId): query more error logs
- get_table_schema(tableNamePattern): query table structure
- query_business_data(sql, description): verify data status

## Constraints
1. Only call 1 tool at a time, determine the next step based on results
2. Stop when information is sufficient, do not over-pursue irrelevant code
3. All conclusions must be supported by actual data returned by tools, prohibit fabrication`;

export const SERVICE_IDENTIFY_PROMPT = `You are a service identification expert. Analyze the given log information and return a JSON object identifying the microservice.

## Rules
1. **serviceName**: Extract the exact microservice name from the log. Use the service name field directly, do not modify or translate it.
2. **isFrontend**: true if the service is a frontend (Vue) application (has vueFile, handles web requests, returns HTML/JS), false if it's a backend Java service (has controller/service/dao layers, handles API requests).
3. **reasoning**: Brief explanation (1-2 sentences) of why you classified it as frontend/backend.
4. **suggestedDirection**: "frontend" if isFrontend is true, "backend" otherwise.

## Response Format
Return ONLY a valid JSON object, no markdown code blocks:
{"serviceName": "exact-service-name", "isFrontend": false, "reasoning": "brief explanation", "suggestedDirection": "backend"}`;

export const DEEP_ANALYSIS_PROMPT = SYSTEM_PROMPT;

export const CHAT_SYSTEM_PROMPT = `You are a helpful AI assistant for HIS system operation and maintenance. Please answer questions based on the provided context.`;

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_code',
      description: 'Get code from GitLab repository',
      parameters: {
        type: 'object',
        properties: {
          serviceName: { type: 'string', description: 'Service name' },
          filePath: { type: 'string', description: 'File path' },
          searchPattern: { type: 'string', description: 'Search pattern' },
          startLine: { type: 'number', description: 'Start line' },
          endLine: { type: 'number', description: 'End line' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_sql_log',
      description: 'Query SQL execution logs',
      parameters: {
        type: 'object',
        properties: {
          traceId: { type: 'string', description: 'Trace ID' },
          sqlId: { type: 'string', description: 'SQL ID/Method name' },
        },
        required: ['traceId', 'sqlId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_log',
      description: 'Query system logs',
      parameters: {
        type: 'object',
        properties: {
          serviceName: { type: 'string', description: 'Service name' },
          traceId: { type: 'string', description: 'Trace ID' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_more_logs',
      description: 'Query more logs',
      parameters: {
        type: 'object',
        properties: {
          serviceName: { type: 'string', description: 'Service name' },
          logLevel: { type: 'array', items: { type: 'string' }, description: 'Log levels' },
          traceId: { type: 'string', description: 'Trace ID' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_table_schema',
      description: 'Get database table schema',
      parameters: {
        type: 'object',
        properties: {
          tableNamePattern: { type: 'string', description: 'Table name pattern' },
        },
        required: ['tableNamePattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_business_data',
      description: 'Query business data',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL query' },
          description: { type: 'string', description: 'Query description' },
        },
        required: ['sql', 'description'],
      },
    },
  },
];