import type { ConnectorContext, ConnectorResult, NormalizedModelUsageRecord } from "./types";
import { clean, endUnix, fetchJson, nonNegative, startUnix, status, toModelRecord } from "./utils";

type OpenAIUsageResponse = {
  data?: Array<{
    start_time?: number;
    end_time?: number;
    results?: Array<Record<string, unknown>>;
    result?: Array<Record<string, unknown>>;
  }>;
};

export async function loadOpenAIUsage(context: ConnectorContext): Promise<ConnectorResult> {
  const key = process.env.OPENAI_ADMIN_KEY;
  if (!key) {
    return empty("pending", "等待 OPENAI_ADMIN_KEY");
  }

  try {
    const params = new URLSearchParams({
      start_time: String(startUnix(context.startDate)),
      end_time: String(endUnix(context.endDate)),
      bucket_width: "1d",
    });
    params.append("group_by[]", "model");

    const payload = await fetchJson<OpenAIUsageResponse>(
      `https://api.openai.com/v1/organization/usage/completions?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      },
    );
    const modelRecords: NormalizedModelUsageRecord[] = [];

    for (const bucket of payload.data ?? []) {
      const date = bucket.start_time ? new Date(bucket.start_time * 1000).toISOString().slice(0, 10) : context.endDate;
      const results = bucket.results ?? bucket.result ?? [];

      for (const result of results) {
        const model = clean(result.model) || "OpenAI API";
        const inputTokens =
          nonNegative(result.input_tokens) +
          nonNegative(result.input_cached_tokens) +
          nonNegative(result.input_audio_tokens);
        const outputTokens = nonNegative(result.output_tokens) + nonNegative(result.output_audio_tokens);
        const requests = nonNegative(result.num_model_requests);

        modelRecords.push(
          toModelRecord("openai-usage-api", "provider_api", `openai:${date}:${model}:${clean(result.project_id)}`, {
            date,
            provider: "OpenAI",
            providerRegion: "美国",
            model,
            modelClass: "OpenAI API",
            country: "未知",
            countryCode: "ZZ",
            tokens: inputTokens + outputTokens,
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            requests,
            coverage: 100,
          }),
        );
      }
    }

    return {
      modelRecords,
      agentRecords: [],
      statuses: [
        status("openai", "OpenAI Usage API", modelRecords.length ? "已接入" : "无记录", modelRecords.length ? "ready" : "pending", {
          records: modelRecords.length,
          docs: "https://platform.openai.com/docs/api-reference/usage",
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
      status("openai", "OpenAI Usage API", statusValue === "pending" ? "未配置" : "错误", statusValue, {
        message,
        docs: "https://platform.openai.com/docs/api-reference/usage",
      }),
    ],
  };
}
