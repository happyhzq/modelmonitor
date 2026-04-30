import type { ConnectorContext, ConnectorResult, NormalizedModelUsageRecord } from "./types";
import { clean, envList, fetchJson, nonNegative, normalizeDate, providerRegion, status, toModelRecord } from "./utils";

type CloudflareLogsResponse = {
  result?: unknown;
  success?: boolean;
  errors?: Array<{ message?: string }>;
};

type Row = Record<string, unknown>;

const docsUrl = "https://developers.cloudflare.com/api/resources/ai_gateway/subresources/logs/methods/list";

export async function loadCloudflareAiGatewayUsage(context: ConnectorContext): Promise<ConnectorResult> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayIds = envList("CLOUDFLARE_AI_GATEWAY_IDS");

  if (!token || !accountId || !gatewayIds.length) {
    return empty("pending", "等待 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_GATEWAY_IDS");
  }

  const modelRecords: NormalizedModelUsageRecord[] = [];
  const maxPages = Math.max(1, Number(process.env.CLOUDFLARE_AI_GATEWAY_MAX_PAGES || 10));
  const perPage = Math.min(100, Math.max(1, Number(process.env.CLOUDFLARE_AI_GATEWAY_PER_PAGE || 100)));

  try {
    for (const gatewayId of gatewayIds) {
      for (let page = 1; page <= maxPages; page += 1) {
        const params = new URLSearchParams({
          page: String(page),
          per_page: String(perPage),
          order_by: "created_at",
          direction: "desc",
        });
        params.set("created_at_start", `${context.startDate}T00:00:00.000Z`);
        params.set("created_at_end", `${context.endDate}T23:59:59.999Z`);

        const payload = await fetchJson<CloudflareLogsResponse>(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai-gateway/gateways/${encodeURIComponent(
            gatewayId,
          )}/logs?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        const rows = extractRows(payload.result);
        rows.forEach((row, index) => {
          const createdAt = read(row, ["created_at", "createdAt", "timestamp", "start_time"]);
          const date = normalizeDate(createdAt) ?? context.endDate;
          if (date < context.startDate || date > context.endDate) {
            return;
          }

          const promptTokens = number(row, ["tokens_in", "tokensIn", "prompt_tokens", "input_tokens", "inputTokens"]);
          const completionTokens = number(row, ["tokens_out", "tokensOut", "completion_tokens", "output_tokens", "outputTokens"]);
          const tokens = number(row, ["tokens", "total_tokens", "totalTokens"]) || promptTokens + completionTokens;
          if (!tokens && !promptTokens && !completionTokens) {
            return;
          }

          const provider = inferProvider(read(row, ["provider", "vendor"]) || read(row, ["model"]) || "Cloudflare AI Gateway");
          const model = clean(read(row, ["model", "model_name", "modelName"])) || provider;
          const countryCode = clean(read(row, ["countryCode", "country_code", "client_country_code", "cf_client_country"]));
          const region = clean(read(row, ["region", "colo", "datacenter", "location"]));
          const latencyMs = number(row, ["duration", "duration_ms", "latency_ms"]);
          const requestId = clean(read(row, ["id", "request_id", "requestId"])) || `${gatewayId}:${page}:${index}:${date}:${model}`;

          modelRecords.push(
            toModelRecord("cloudflare-ai-gateway", "gateway", `cloudflare-ai-gateway:${gatewayId}:${requestId}`, {
              date,
              provider,
              providerRegion: providerRegion(provider),
              model,
              modelClass: "Cloudflare AI Gateway",
              country: region,
              countryCode,
              tokens,
              promptTokens,
              completionTokens,
              requests: number(row, ["requests", "count"]) || 1,
              avgLatencyMs: latencyMs,
              coverage: 100,
              metricNote: "Cloudflare AI Gateway request log token usage",
            }),
          );
        });

        if (rows.length < perPage) {
          break;
        }
      }
    }

    return {
      modelRecords,
      agentRecords: [],
      statuses: [
        status("cloudflare-ai-gateway", "Cloudflare AI Gateway Logs", modelRecords.length ? "已接入" : "无记录", modelRecords.length ? "ready" : "pending", {
          records: modelRecords.length,
          message: "从 AI Gateway 请求日志读取 provider/model/tokens_in/tokens_out",
          docs: docsUrl,
        }),
      ],
    };
  } catch (error) {
    return empty("error", error instanceof Error ? error.message : String(error));
  }
}

function empty(statusValue: "pending" | "error", message: string): ConnectorResult {
  return {
    modelRecords: [],
    agentRecords: [],
    statuses: [
      status("cloudflare-ai-gateway", "Cloudflare AI Gateway Logs", statusValue === "pending" ? "未配置" : "错误", statusValue, {
        message,
        docs: docsUrl,
      }),
    ],
  };
}

function extractRows(result: unknown): Row[] {
  if (Array.isArray(result)) {
    return result.filter(isRow);
  }
  if (isRow(result)) {
    for (const key of ["logs", "data", "items", "requests", "result"]) {
      const value = result[key];
      if (Array.isArray(value)) {
        return value.filter(isRow);
      }
    }
  }
  return [];
}

function isRow(value: unknown): value is Row {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function read(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = readPath(row, key);
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function readPath(row: Row, key: string): unknown {
  if (key in row) {
    return row[key];
  }
  return key.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Row)[part];
    }
    return undefined;
  }, row);
}

function number(row: Row, keys: string[]) {
  return nonNegative(read(row, keys));
}

function inferProvider(value: unknown) {
  const text = clean(value);
  if (!text) {
    return "Cloudflare AI Gateway";
  }
  if (/openai|gpt-|o\d/i.test(text)) return "OpenAI";
  if (/anthropic|claude/i.test(text)) return "Anthropic";
  if (/google|gemini/i.test(text)) return "Google";
  if (/mistral/i.test(text)) return "Mistral";
  if (/deepseek/i.test(text)) return "DeepSeek";
  if (/qwen|alibaba|dashscope/i.test(text)) return "Alibaba Cloud";
  if (/xai|grok/i.test(text)) return "xAI";
  if (/meta|llama/i.test(text)) return "Meta";
  return text;
}
