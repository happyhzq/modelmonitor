import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ConnectorContext, ConnectorResult, NormalizedAgentUsageRecord, NormalizedModelUsageRecord } from "./types";
import { clean, hashId, nonNegative, normalizeDate, status, toAgentRecord, toModelRecord } from "./utils";

type Row = Record<string, unknown>;

export async function loadFileSources(context: ConnectorContext): Promise<ConnectorResult> {
  const modelRecords: NormalizedModelUsageRecord[] = [];
  const agentRecords: NormalizedAgentUsageRecord[] = [];

  try {
    const exists = await stat(context.dataDir).then((item) => item.isDirectory()).catch(() => false);
    if (!exists) {
      return {
        modelRecords,
        agentRecords,
        statuses: [
          status("files", "本地标准化数据", "未找到目录", "pending", {
            message: `创建 ${context.dataDir} 后放入 JSON/JSONL/CSV 文件即可接入`,
          }),
        ],
      };
    }

    const files = (await readdir(context.dataDir))
      .filter((file) => /\.(json|jsonl|ndjson|csv)$/i.test(file))
      .sort();

    for (const file of files) {
      const filePath = path.join(context.dataDir, file);
      const text = await readFile(filePath, "utf8");
      const rows = parseRows(file, text);

      rows.forEach((row, index) => {
        const sourceId = clean(row.sourceRecordId) || clean(row.request_id) || clean(row.id) || `${file}:${index}:${hashId(row)}`;
        const kind = inferKind(file, row);

        if (looksLikeAgent(row, file)) {
          const agentRecord = normalizeAgentRow(file, sourceId, row, kind);
          if (agentRecord) {
            agentRecords.push(agentRecord);
          }
          return;
        }

        const modelRecord = normalizeModelRow(file, sourceId, row, kind);
        if (modelRecord) {
          modelRecords.push(modelRecord);
        }
      });
    }

    return {
      modelRecords,
      agentRecords,
      statuses: [
        status("files", "本地标准化数据", files.length ? `${files.length} 个文件` : "等待数据", files.length ? "ready" : "pending", {
          records: modelRecords.length + agentRecords.length,
          message: files.length
            ? "已读取 JSON/JSONL/CSV、网关日志、OpenTelemetry trace、云账单导出"
            : "把供应商账单、网关日志或 trace 导出放入 data/sources",
        }),
      ],
    };
  } catch (error) {
    return {
      modelRecords,
      agentRecords,
      statuses: [
        status("files", "本地标准化数据", "读取失败", "error", {
          message: error instanceof Error ? error.message : String(error),
        }),
      ],
    };
  }
}

function normalizeModelRow(file: string, sourceId: string, row: Row, kind: NormalizedModelUsageRecord["sourceKind"]) {
  const attributes = row.attributes && typeof row.attributes === "object" ? (row.attributes as Row) : row;
  const date =
    value(row, ["date", "day", "bucket_start", "start_time", "timestamp", "created_at", "created"]) ??
    value(attributes, ["time", "event.time"]);
  const promptTokens = tokenValue(row, attributes, [
    "promptTokens",
    "prompt_tokens",
    "input_tokens",
    "inputTokens",
    "inputTokenCount",
    "promptTokenCount",
    "gen_ai.usage.input_tokens",
    "llm.usage.prompt_tokens",
  ]);
  const completionTokens = tokenValue(row, attributes, [
    "completionTokens",
    "completion_tokens",
    "output_tokens",
    "outputTokens",
    "candidatesTokenCount",
    "outputTokenCount",
    "gen_ai.usage.output_tokens",
    "llm.usage.completion_tokens",
  ]);
  const tokens =
    tokenValue(row, attributes, ["tokens", "total_tokens", "totalTokens", "totalTokenCount", "gen_ai.usage.total_tokens"]) ||
    promptTokens + completionTokens;
  const requests = nonNegative(value(row, ["requests", "num_model_requests", "request_count", "count", "invocations"])) || 1;

  if (!tokens && !promptTokens && !completionTokens && !requests) {
    return undefined;
  }

  const provider = inferProvider(file, row, attributes);

  return toModelRecord(file, kind, sourceId, {
    date: normalizeDate(date),
    provider,
    providerRegion: clean(value(row, ["providerRegion", "provider_region", "home_country"])),
    model: clean(value(row, ["model", "model_name", "deployment", "deployment_name", "gen_ai.request.model"])) || provider,
    modelClass: clean(value(row, ["modelClass", "model_class", "class", "task"])) || "Production API",
    country: clean(value(row, ["country", "country_name", "region", "cloud_region", "location"])),
    countryCode: clean(value(row, ["countryCode", "country_code", "client_country_code"])),
    tokens,
    promptTokens,
    completionTokens,
    requests,
    activeUsers: nonNegative(value(row, ["activeUsers", "active_users", "users", "unique_users"])),
    avgLatencyMs: nonNegative(value(row, ["avgLatencyMs", "avg_latency_ms", "latency_ms", "duration_ms"])),
    coverage: nonNegative(value(row, ["coverage", "coverage_pct"])) || 100,
  });
}

function normalizeAgentRow(file: string, sourceId: string, row: Row, kind: NormalizedAgentUsageRecord["sourceKind"]) {
  const invocations = nonNegative(value(row, ["invocations", "agent_invocations", "runs", "count", "requests"])) || 1;
  const tokens = nonNegative(value(row, ["tokens", "total_tokens", "gen_ai.usage.total_tokens"]));

  return toAgentRecord(file, kind === "sample" ? "trace" : kind, sourceId, {
    date: normalizeDate(value(row, ["date", "day", "bucket_start", "start_time", "timestamp", "created_at"])),
    category: clean(value(row, ["category", "agent_category", "agent_type", "name", "agent.name"])) || "Agent",
    framework: clean(value(row, ["framework", "agent_framework", "library", "service.name"])) || inferProvider(file, row, row),
    country: clean(value(row, ["country", "country_name", "region", "cloud_region", "location"])),
    countryCode: clean(value(row, ["countryCode", "country_code", "client_country_code"])),
    invocations,
    completedTasks: nonNegative(value(row, ["completedTasks", "completed_tasks", "successes", "success_count"])) || invocations,
    toolCalls: nonNegative(value(row, ["toolCalls", "tool_calls", "gen_ai.tool.call.count"])),
    tokens,
    successRate: nonNegative(value(row, ["successRate", "success_rate", "success_pct"])) || 100,
    avgSteps: nonNegative(value(row, ["avgSteps", "avg_steps", "steps"])) || 1,
    handoffRate: nonNegative(value(row, ["handoffRate", "handoff_rate", "human_handoff_rate"])),
  });
}

function parseRows(file: string, text: string): Row[] {
  if (/\.csv$/i.test(file)) {
    return parseCsv(text);
  }

  if (/\.(jsonl|ndjson)$/i.test(file)) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row);
  }

  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) {
    return parsed as Row[];
  }
  if (parsed && typeof parsed === "object") {
    const object = parsed as Row;
    if (Array.isArray(object.modelRecords) || Array.isArray(object.agentRecords)) {
      return [...((object.modelRecords as Row[]) ?? []), ...((object.agentRecords as Row[]) ?? [])];
    }
    if (Array.isArray(object.data)) {
      return object.data as Row[];
    }
    return [object];
  }

  return [];
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function looksLikeAgent(row: Row, file: string) {
  const name = file.toLowerCase();
  const hasAgentFields = Boolean(value(row, ["agent_category", "agent_type", "framework", "toolCalls", "tool_calls", "handoffRate"]));
  const hasTokenFields = Boolean(
    value(row, [
      "prompt_tokens",
      "input_tokens",
      "completion_tokens",
      "output_tokens",
      "gen_ai.usage.input_tokens",
      "gen_ai.usage.output_tokens",
      "total_tokens",
      "tokens",
    ]),
  );

  return (
    /agent/.test(name) ||
    hasAgentFields ||
    ((/trace|span|otel/.test(name) || clean(row.kind).toLowerCase().includes("span")) && !hasTokenFields)
  );
}

function inferKind(file: string, row: Row): NormalizedModelUsageRecord["sourceKind"] {
  const name = file.toLowerCase();
  const rawKind = clean(value(row, ["sourceKind", "source_kind", "kind"])).toLowerCase();

  if (["gateway", "provider_api", "cloud_metric", "billing_export", "trace", "public_stats"].includes(rawKind)) {
    return rawKind as NormalizedModelUsageRecord["sourceKind"];
  }
  if (/otel|trace|span|agent/.test(name)) {
    return "trace";
  }
  if (/gateway|request|log/.test(name)) {
    return "gateway";
  }
  if (/billing|cost|invoice|bss/.test(name)) {
    return "billing_export";
  }
  if (/cloudwatch|azure|monitor|gcp|vertex|bedrock/.test(name)) {
    return "cloud_metric";
  }

  return "provider_api";
}

function inferProvider(file: string, row: Row, attributes: Row) {
  const explicit = clean(value(row, ["provider", "vendor", "system", "gen_ai.system"])) || clean(value(attributes, ["gen_ai.system"]));
  if (explicit) {
    return normalizeProvider(explicit);
  }

  const name = file.toLowerCase();
  if (/openai/.test(name)) return "OpenAI";
  if (/anthropic|claude/.test(name)) return "Anthropic";
  if (/google|gcp|vertex|gemini/.test(name)) return "Google";
  if (/azure/.test(name)) return "Azure OpenAI";
  if (/bedrock|aws/.test(name)) return "AWS Bedrock";
  if (/alibaba|dashscope|qwen/.test(name)) return "Alibaba Cloud";
  if (/deepseek/.test(name)) return "DeepSeek";
  if (/mistral/.test(name)) return "Mistral";
  if (/openrouter/.test(name)) return "OpenRouter";
  return "Unknown";
}

function normalizeProvider(provider: string) {
  const value = provider.toLowerCase();
  if (value.includes("openai")) return "OpenAI";
  if (value.includes("anthropic") || value.includes("claude")) return "Anthropic";
  if (value.includes("google") || value.includes("gemini") || value.includes("vertex")) return "Google";
  if (value.includes("azure")) return "Azure OpenAI";
  if (value.includes("bedrock") || value.includes("aws")) return "AWS Bedrock";
  if (value.includes("alibaba") || value.includes("dashscope") || value.includes("qwen")) return "Alibaba Cloud";
  if (value.includes("deepseek")) return "DeepSeek";
  if (value.includes("mistral")) return "Mistral";
  if (value.includes("openrouter")) return "OpenRouter";
  return provider;
}

function tokenValue(row: Row, attributes: Row, keys: string[]) {
  return nonNegative(value(row, keys) ?? value(attributes, keys));
}

function value(row: Row, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }

  return undefined;
}
