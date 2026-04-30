# Data Sources

This project supports direct API connectors and normalized exports. Direct API connectors run in `server/connectors`; export and trace ingestion is handled by `data/sources`.

## Direct connectors

| Source | Connector | Env |
| --- | --- | --- |
| OpenRouter public model rankings | `publicWebConnector.ts` | `MODEL_MONITOR_PUBLIC_WEB` |
| OpenRouter public Apps/Agents rankings | `publicWebConnector.ts` | `MODEL_MONITOR_PUBLIC_WEB` |
| Hugging Face model downloads | `publicWebConnector.ts` | `MODEL_MONITOR_PUBLIC_WEB` |
| OpenAI Usage API | `openaiConnector.ts` | `OPENAI_ADMIN_KEY` |
| Anthropic Usage & Cost API | `anthropicConnector.ts` | `ANTHROPIC_ADMIN_KEY` |
| OpenRouter Generation API | `openRouterConnector.ts` | `OPENROUTER_API_KEY`, `OPENROUTER_GENERATION_IDS` |
| Azure OpenAI Monitor | `azureMonitorConnector.ts` | `AZURE_MONITOR_BEARER_TOKEN`, `AZURE_OPENAI_RESOURCE_IDS` |
| Cloudflare AI Gateway Logs | `cloudflareAiGatewayConnector.ts` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_IDS` |
| Langfuse Observations API | `langfuseConnector.ts` | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` |
| Internal telemetry API | `httpJsonConnector.ts` | `MODEL_MONITOR_HTTP_JSON_SOURCES` |

## Export/log connectors

Put `.json`, `.jsonl`, `.ndjson`, or `.csv` files in `data/sources`.

Supported source families:

- AWS Bedrock CloudWatch metrics: `Invocations`, `InputTokenCount`, `OutputTokenCount`
- Google Vertex / Gemini usage metadata and Cloud Billing exports
- Cloudflare AI Gateway request logs: `provider`, `model`, `tokens_in`, `tokens_out`
- Langfuse generation observations: `usage`, `usageDetails`, `inputUsage`, `outputUsage`, `totalUsage`
- OpenTelemetry GenAI semantic convention fields
- Alibaba DashScope response usage and BSS billing exports
- Mistral / DeepSeek API usage responses
- Gateway logs and Agent trace logs

## Field aliases

Model token aliases:

- Input: `promptTokens`, `prompt_tokens`, `input_tokens`, `inputTokenCount`, `promptTokenCount`, `gen_ai.usage.input_tokens`
- Output: `completionTokens`, `completion_tokens`, `output_tokens`, `outputTokenCount`, `candidatesTokenCount`, `gen_ai.usage.output_tokens`
- Total: `tokens`, `total_tokens`, `totalTokens`, `totalTokenCount`, `gen_ai.usage.total_tokens`
- Requests: `requests`, `num_model_requests`, `request_count`, `count`, `invocations`

Agent aliases:

- Calls: `invocations`, `agent_invocations`, `runs`, `count`
- Tools: `toolCalls`, `tool_calls`, `gen_ai.tool.call.count`
- Success: `successRate`, `success_rate`, `success_pct`
- Handoff: `handoffRate`, `handoff_rate`, `human_handoff_rate`

## Direct connector configuration

Cloudflare AI Gateway:

```bash
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_AI_GATEWAY_IDS=gateway-a,gateway-b
CLOUDFLARE_AI_GATEWAY_MAX_PAGES=10
CLOUDFLARE_AI_GATEWAY_PER_PAGE=100
```

Langfuse:

```bash
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_OBSERVATION_TYPES=GENERATION
LANGFUSE_MAX_PAGES=20
LANGFUSE_LIMIT=100
```

## Production deployment

Build and run:

```bash
npm run build
PORT=8787 npm start
```

For container deployment, mount a persistent read-only export directory to `data/sources` or point `MODEL_MONITOR_DATA_DIR` to your ETL output.

## MySQL persistence

The API can persist cleaned, deduplicated records into MySQL and then read the dashboard data from MySQL.

Tables:

- `globalaitokenusage`
- `globalagentusage`
- `siteusers`

Commands:

```bash
npm run db:init
npm run db:sync
```

Runtime behavior:

- Build telemetry from live/public/file sources.
- Deduplicate in `server/aggregate.ts`.
- Upsert records into MySQL.
- Read the requested date range back from MySQL when `MODEL_MONITOR_MYSQL_READ=true`.
- Preserve source scope fields (`source_id`, `source_kind`, `is_estimate`, `metric_note`) so the frontend can distinguish direct usage from public statistics and estimates.
- Prune stale rows for dates represented in the current successful sync, unless a blocking source error is present or `MODEL_MONITOR_MYSQL_PRUNE=false`.

## Data truthfulness notes

- Public OpenRouter model rankings are real OpenRouter usage statistics, not global all-provider traffic.
- Public OpenRouter Apps/Agents rankings expose token volume only; invocation counts are estimated by this project.
- Hugging Face downloads are discovery/heat signals and are intentionally excluded from token totals.
- Country charts only use rows with a known country or region-derived country. Unknown `ZZ` rows are excluded from country share charts.
