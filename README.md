# AI Model Monitor

用于监控已接入数据源里的 AI 模型 token 用量与 Agent/App token、调用量的生产式 dashboard。项目包含 React 前端、Node 聚合 API、数据源连接器、去重聚合、MySQL 持久化和示例数据兜底。

重要边界：各供应商不会公开“全球所有客户的总 token 调用量”。生产里的“全球总量”只能由你有权限的数据源汇总，例如组织级 usage API、云监控、账单导出、网关日志和 Agent trace。

## 运行

```bash
npm install
cp .env.example .env
npm run build
npm start
```

访问：

```text
http://localhost:8787
http://localhost:8787/api/telemetry?days=30
```

MySQL 初始化和同步：

```bash
npm run db:init
npm run db:sync
```

开发模式：

```bash
npm run dev:api
npm run dev
```

## 已接入的数据源

直接 API：

- OpenRouter public rankings：默认开启，实时抓取公开模型 token 榜与 Apps/Agents token 榜
- OpenAI Usage API：`OPENAI_ADMIN_KEY`
- Anthropic Usage & Cost API：`ANTHROPIC_ADMIN_KEY`
- OpenRouter Generation API：`OPENROUTER_API_KEY` + `OPENROUTER_GENERATION_IDS`
- Azure OpenAI Monitor：`AZURE_MONITOR_BEARER_TOKEN` + `AZURE_OPENAI_RESOURCE_IDS`
- 自定义内部 JSON API：`MODEL_MONITOR_HTTP_JSON_SOURCES`
- Hugging Face model downloads：默认开启，只作为下载热度，不计入 token 总量

文件/导出接入：

- AWS Bedrock CloudWatch：Invocations、InputTokenCount、OutputTokenCount
- Google Vertex / Gemini：response `usageMetadata`、Cloud Billing BigQuery 导出、监控指标
- OpenTelemetry GenAI / Agent：`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、trace/span
- Alibaba DashScope / BSS：response `usage`、账单导出、网关日志
- Mistral / DeepSeek：API response usage 或网关日志
- 任意自有推理网关、代理层、Agent trace

把 JSON、JSONL、NDJSON 或 CSV 放入 `data/sources` 即可读取。字段可以是标准化字段，也可以是常见供应商字段名。

公开抓取配置：

```bash
MODEL_MONITOR_PUBLIC_WEB=true
MODEL_MONITOR_PUBLIC_WEB_TTL_SECONDS=900
```

OpenRouter 模型榜里的数据包含按日 prompt/completion/reasoning token 和请求数，计入模型 token，口径仅代表 OpenRouter 流量。OpenRouter Apps/Agents 页面公开的是 token，不公开调用次数，也未披露明确日级时间粒度；项目会按抓取日落库，把 token 计入 Agent token，并用 `8000 tokens / 调用` 估算调用量，数据源状态和前端会明确标注。

MySQL 配置写入本地 `.env`，不要提交到 git：

```bash
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=modelmonitor
MODEL_MONITOR_MYSQL_ENABLED=true
MODEL_MONITOR_MYSQL_READ=true
```

数据库表：

- `globalaitokenusage`：清洗去重后的日级模型 token 用量。
- `globalagentusage`：清洗去重后的日级 Agent/App token 与调用量。
- `siteusers`：预留给网站用户、角色和扩展 metadata。

MySQL 持久化行为：

- `DATE` 字段按字符串读回，避免服务器时区把日期偏移到前一天。
- 写入会保留 `source_id`、`source_kind`、`is_estimate`、`metric_note`，用于前端展示数据口径。
- 当本次同步没有阻塞型数据源错误时，会清理同日期范围内已不在当前聚合结果里的旧行，避免公开榜单变化后残留过期记录。

## 标准化字段

模型用量：

```json
{
  "date": "2026-04-25",
  "provider": "OpenAI",
  "model": "gpt-5.2",
  "countryCode": "US",
  "prompt_tokens": 1000,
  "completion_tokens": 500,
  "requests": 1,
  "sourceRecordId": "request-id-1",
  "sourceKind": "gateway"
}
```

Agent 调用：

```json
{
  "date": "2026-04-25",
  "category": "代码开发",
  "framework": "OpenAI Agents",
  "countryCode": "US",
  "invocations": 1,
  "tool_calls": 4,
  "tokens": 7800,
  "success_rate": 92,
  "sourceRecordId": "trace-id-1",
  "sourceKind": "trace"
}
```

## 去重规则

后端在 `server/aggregate.ts` 做两层去重：

- 精确去重：`source + sourceRecordId`
- 聚合去重：同一天、同供应商/框架、同模型/类型、同国家，只保留最高优先级来源后再聚合

来源优先级：

```text
gateway > trace > provider_api > cloud_metric > billing_export > public_stats > sample
```

这样可以避免同一批调用同时出现在网关日志、供应商 usage API 和账单导出时被重复计算。

## 生产建议

- 用推理网关或 SDK middleware 记录 request id、model、provider、prompt/completion token、tenant、country/account region。
- Provider usage API 用来校验和补齐，不要和网关日志直接相加。
- 国家归因优先账户区域，其次服务端 GeoIP；不要把个人 IP 直接暴露给前端。
- Agent trace 使用 OpenTelemetry 或自研 trace id，与模型调用 request id 做关联。
