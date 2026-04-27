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
| Internal telemetry API | `httpJsonConnector.ts` | `MODEL_MONITOR_HTTP_JSON_SOURCES` |

## Export/log connectors

Put `.json`, `.jsonl`, `.ndjson`, or `.csv` files in `data/sources`.

Supported source families:

- AWS Bedrock CloudWatch metrics: `Invocations`, `InputTokenCount`, `OutputTokenCount`
- Google Vertex / Gemini usage metadata and Cloud Billing exports
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
