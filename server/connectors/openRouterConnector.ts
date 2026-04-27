import type { ConnectorContext, ConnectorResult, NormalizedModelUsageRecord } from "./types";
import { clean, envList, fetchJson, hashId, nonNegative, normalizeDate, status, toModelRecord } from "./utils";

type GenerationResponse = {
  data?: Record<string, unknown>;
};

export async function loadOpenRouterUsage(_context: ConnectorContext): Promise<ConnectorResult> {
  const key = process.env.OPENROUTER_API_KEY;
  const ids = envList("OPENROUTER_GENERATION_IDS");
  if (!key || !ids.length) {
    return {
      modelRecords: [],
      agentRecords: [],
      statuses: [
        status("openrouter", "OpenRouter Generation API", "未配置", "pending", {
          message: "需要 OPENROUTER_API_KEY 和 OPENROUTER_GENERATION_IDS；批量历史数据建议用网关日志或文件接入",
          docs: "https://openrouter.ai/docs/api-reference/overview",
        }),
      ],
    };
  }

  const modelRecords: NormalizedModelUsageRecord[] = [];

  try {
    for (const id of ids) {
      const payload = await fetchJson<GenerationResponse>(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
          },
        },
      );
      const data = payload.data ?? {};
      const promptTokens = nonNegative(data.prompt_tokens);
      const completionTokens = nonNegative(data.completion_tokens);
      const model = clean(data.model) || "OpenRouter routed model";

      modelRecords.push(
        toModelRecord("openrouter-generation-api", "provider_api", `openrouter:${id}:${hashId(data)}`, {
          date: normalizeDate(data.created_at) ?? normalizeDate(data.created) ?? undefined,
          provider: "OpenRouter",
          providerRegion: "美国",
          model,
          modelClass: "Model router",
          country: "未知",
          countryCode: "ZZ",
          tokens: promptTokens + completionTokens,
          promptTokens,
          completionTokens,
          requests: 1,
          coverage: 100,
        }),
      );
    }

    return {
      modelRecords,
      agentRecords: [],
      statuses: [
        status("openrouter", "OpenRouter Generation API", modelRecords.length ? "已接入" : "无记录", modelRecords.length ? "ready" : "pending", {
          records: modelRecords.length,
          docs: "https://openrouter.ai/docs/api-reference/overview",
        }),
      ],
    };
  } catch (error) {
    return {
      modelRecords,
      agentRecords: [],
      statuses: [
        status("openrouter", "OpenRouter Generation API", "错误", "error", {
          message: error instanceof Error ? error.message : String(error),
          docs: "https://openrouter.ai/docs/api-reference/overview",
        }),
      ],
    };
  }
}
