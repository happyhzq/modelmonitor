import type { ConnectorContext, ConnectorResult, NormalizedModelUsageRecord } from "./types";
import { clean, envList, fetchJson, hashId, nonNegative, normalizeDate, providerRegion, status, toModelRecord } from "./utils";

type LangfuseObservationsResponse = {
  data?: unknown[];
  meta?: {
    totalItems?: number;
    totalPages?: number;
    page?: number;
  };
};

type Row = Record<string, unknown>;

const docsUrl = "https://langfuse.com/docs/api-and-data-platform/features/observations-api";

export async function loadLangfuseUsage(context: ConnectorContext): Promise<ConnectorResult> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    return empty("pending", "等待 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY");
  }

  const baseUrl = (process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/\/+$/, "");
  const limit = Math.min(100, Math.max(1, Number(process.env.LANGFUSE_LIMIT || 100)));
  const maxPages = Math.max(1, Number(process.env.LANGFUSE_MAX_PAGES || 20));
  const modelRecords: NormalizedModelUsageRecord[] = [];
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const observationTypes = envList("LANGFUSE_OBSERVATION_TYPES");
  const types = observationTypes.length ? observationTypes : ["GENERATION"];

  try {
    for (const type of types) {
      for (let page = 1; page <= maxPages; page += 1) {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
          fromStartTime: `${context.startDate}T00:00:00.000Z`,
          toStartTime: `${context.endDate}T23:59:59.999Z`,
          type,
        });

        const payload = await fetchJson<LangfuseObservationsResponse>(`${baseUrl}/api/public/observations?${params.toString()}`, {
          headers: {
            Authorization: `Basic ${auth}`,
          },
        });
        const rows = (payload.data ?? []).filter(isRow);

        rows.forEach((row) => {
          const date = normalizeDate(read(row, ["startTime", "start_time", "createdAt", "timestamp"])) ?? context.endDate;
          if (date < context.startDate || date > context.endDate) {
            return;
          }

          const usage = isRow(row.usage) ? row.usage : {};
          const usageDetails = isRow(row.usageDetails) ? row.usageDetails : {};
          const promptTokens =
            number(row, ["inputUsage", "promptTokens", "prompt_tokens", "input_tokens"]) ||
            number(usage, ["input", "input_tokens", "prompt_tokens"]) ||
            number(usageDetails, ["input", "input_tokens", "prompt_tokens", "input_tokens_total"]);
          const completionTokens =
            number(row, ["outputUsage", "completionTokens", "completion_tokens", "output_tokens"]) ||
            number(usage, ["output", "output_tokens", "completion_tokens"]) ||
            number(usageDetails, ["output", "output_tokens", "completion_tokens", "output_tokens_total"]);
          const tokens =
            number(row, ["totalUsage", "tokens", "total_tokens"]) ||
            number(usage, ["total", "total_tokens"]) ||
            number(usageDetails, ["total", "total_tokens"]) ||
            promptTokens + completionTokens;
          if (!tokens && !promptTokens && !completionTokens) {
            return;
          }

          const model = clean(read(row, ["model", "modelName", "model_name", "metadata.model"])) || "Langfuse generation";
          const provider = inferProvider(read(row, ["provider", "metadata.provider", "name"]) || model);
          const endTime = dateTime(read(row, ["endTime", "end_time"]));
          const startTime = dateTime(read(row, ["startTime", "start_time"]));
          const latencyMs = startTime && endTime ? Math.max(0, endTime - startTime) : number(row, ["latencyMs", "duration_ms"]);
          const id = clean(read(row, ["id", "observationId"])) || hashId(row);

          modelRecords.push(
            toModelRecord("langfuse-observations", "trace", `langfuse:${id}`, {
              date,
              provider,
              providerRegion: providerRegion(provider),
              model,
              modelClass: "Langfuse observation",
              country: clean(read(row, ["metadata.country", "metadata.region", "environment"])),
              countryCode: clean(read(row, ["metadata.countryCode", "metadata.country_code"])),
              tokens,
              promptTokens,
              completionTokens,
              requests: 1,
              avgLatencyMs: latencyMs,
              coverage: 100,
              metricNote: "Langfuse observation usage for generation traces",
            }),
          );
        });

        if (rows.length < limit || (payload.meta?.totalPages && page >= payload.meta.totalPages)) {
          break;
        }
      }
    }

    return {
      modelRecords,
      agentRecords: [],
      statuses: [
        status("langfuse", "Langfuse Observations API", modelRecords.length ? "已接入" : "无记录", modelRecords.length ? "ready" : "pending", {
          records: modelRecords.length,
          message: "从 Langfuse GENERATION observations 读取 trace token usage",
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
      status("langfuse", "Langfuse Observations API", statusValue === "pending" ? "未配置" : "错误", statusValue, {
        message,
        docs: docsUrl,
      }),
    ],
  };
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

function dateTime(value: unknown) {
  const text = clean(value);
  if (!text) {
    return undefined;
  }
  const parsed = new Date(text).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferProvider(value: unknown) {
  const text = clean(value);
  if (/openai|gpt-|o\d/i.test(text)) return "OpenAI";
  if (/anthropic|claude/i.test(text)) return "Anthropic";
  if (/google|gemini/i.test(text)) return "Google";
  if (/mistral/i.test(text)) return "Mistral";
  if (/deepseek/i.test(text)) return "DeepSeek";
  if (/qwen|alibaba|dashscope/i.test(text)) return "Alibaba Cloud";
  if (/xai|grok/i.test(text)) return "xAI";
  if (/meta|llama/i.test(text)) return "Meta";
  return text || "Langfuse";
}
