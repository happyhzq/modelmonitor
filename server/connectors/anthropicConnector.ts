import type { ConnectorContext, ConnectorResult, NormalizedModelUsageRecord } from "./types";
import { clean, fetchJson, nonNegative, status, toModelRecord } from "./utils";

type AnthropicUsageResponse = {
  data?: Array<Record<string, unknown>>;
  has_more?: boolean;
  next_page?: string | null;
};

export async function loadAnthropicUsage(context: ConnectorContext): Promise<ConnectorResult> {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) {
    return empty("pending", "等待 ANTHROPIC_ADMIN_KEY");
  }

  try {
    const modelRecords: NormalizedModelUsageRecord[] = [];
    let page: string | undefined;

    for (let index = 0; index < 20; index += 1) {
      const params = new URLSearchParams({
        starting_at: context.startDate,
        ending_at: context.endDate,
        bucket_width: "1d",
        limit: "1000",
      });
      params.append("group_by[]", "model");
      if (page) {
        params.set("page", page);
      }

      const payload = await fetchJson<AnthropicUsageResponse>(
        `https://api.anthropic.com/v1/organizations/usage_report/messages?${params.toString()}`,
        {
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "usage-cost-2025-08-18",
          },
        },
      );

      for (const item of payload.data ?? []) {
        const date = clean(item.starting_at) || clean(item.date) || context.endDate;
        const model = clean(item.model) || "Claude API";
        const inputTokens =
          nonNegative(item.input_tokens) +
          nonNegative(item.uncached_input_tokens) +
          nonNegative(item.cache_creation_input_tokens) +
          nonNegative(item.cache_read_input_tokens);
        const outputTokens = nonNegative(item.output_tokens);

        modelRecords.push(
          toModelRecord("anthropic-usage-cost-api", "provider_api", `anthropic:${date}:${model}:${clean(item.workspace_id)}`, {
            date,
            provider: "Anthropic",
            providerRegion: "美国",
            model,
            modelClass: "Claude API",
            country: "未知",
            countryCode: "ZZ",
            tokens: inputTokens + outputTokens,
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            requests: nonNegative(item.requests) || nonNegative(item.message_count),
            coverage: 100,
          }),
        );
      }

      if (!payload.has_more || !payload.next_page) {
        break;
      }
      page = payload.next_page;
    }

    return {
      modelRecords,
      agentRecords: [],
      statuses: [
        status("anthropic", "Anthropic Usage & Cost API", modelRecords.length ? "已接入" : "无记录", modelRecords.length ? "ready" : "pending", {
          records: modelRecords.length,
          docs: "https://docs.anthropic.com/en/api/usage-cost-api",
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
      status("anthropic", "Anthropic Usage & Cost API", statusValue === "pending" ? "未配置" : "错误", statusValue, {
        message,
        docs: "https://docs.anthropic.com/en/api/usage-cost-api",
      }),
    ],
  };
}
