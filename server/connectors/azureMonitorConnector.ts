import type { ConnectorContext, ConnectorResult, NormalizedModelUsageRecord } from "./types";
import { countryFromCloudRegion, envList, fetchJson, hashId, nonNegative, normalizeDate, status, toModelRecord } from "./utils";

type AzureMetricResponse = {
  value?: Array<{
    name?: { value?: string; localizedValue?: string };
    timeseries?: Array<{
      metadatavalues?: Array<{ name?: { value?: string }; value?: string }>;
      data?: Array<{ timeStamp?: string; total?: number }>;
    }>;
  }>;
};

const metricNames = [
  "AzureOpenAIRequests",
  "ProcessedPromptTokens",
  "GeneratedCompletionTokens",
  "ProcessedInferenceTokens",
  "TokenTransaction",
];

export async function loadAzureMonitorUsage(context: ConnectorContext): Promise<ConnectorResult> {
  const token = process.env.AZURE_MONITOR_BEARER_TOKEN;
  const resourceIds = envList("AZURE_OPENAI_RESOURCE_IDS");
  if (!token || !resourceIds.length) {
    return {
      modelRecords: [],
      agentRecords: [],
      statuses: [
        status("azure-monitor", "Azure OpenAI Monitor", "未配置", "pending", {
          message: "需要 AZURE_MONITOR_BEARER_TOKEN 和 AZURE_OPENAI_RESOURCE_IDS",
          docs: "https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-cognitiveservices-accounts-metrics",
        }),
      ],
    };
  }

  const modelRecords: NormalizedModelUsageRecord[] = [];

  try {
    for (const resourceId of resourceIds) {
      const params = new URLSearchParams({
        "api-version": "2018-01-01",
        metricnames: metricNames.join(","),
        timespan: `${context.startDate}T00:00:00Z/${context.endDate}T23:59:59Z`,
        interval: "P1D",
        aggregation: "Total",
      });
      const url = `https://management.azure.com${resourceId}/providers/microsoft.insights/metrics?${params.toString()}`;
      const payload = await fetchJson<AzureMetricResponse>(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const grouped = new Map<string, Partial<NormalizedModelUsageRecord>>();

      for (const metric of payload.value ?? []) {
        const metricName = metric.name?.value ?? metric.name?.localizedValue ?? "metric";
        for (const series of metric.timeseries ?? []) {
          const dimensions = Object.fromEntries(
            (series.metadatavalues ?? []).map((item) => [item.name?.value ?? "dimension", item.value ?? ""]),
          );
          const deployment = String(dimensions.DeploymentName ?? dimensions.ModelDeploymentName ?? dimensions.ModelName ?? "Azure OpenAI");
          const region = String(dimensions.Region ?? dimensions.Location ?? "");
          const country = countryFromCloudRegion(region);

          for (const point of series.data ?? []) {
            const date = normalizeDate(point.timeStamp) ?? context.endDate;
            const key = `${resourceId}:${date}:${deployment}:${region}`;
            const current = grouped.get(key) ?? {
              date,
              provider: "Azure OpenAI",
              providerRegion: "美国",
              model: deployment,
              modelClass: "Azure OpenAI deployment",
              country: country?.name ?? region,
              countryCode: country?.code ?? "ZZ",
              tokens: 0,
              promptTokens: 0,
              completionTokens: 0,
              requests: 0,
              coverage: 100,
            };
            const total = nonNegative(point.total);

            if (/prompt/i.test(metricName)) {
              current.promptTokens = nonNegative(current.promptTokens) + total;
            } else if (/completion|generated/i.test(metricName)) {
              current.completionTokens = nonNegative(current.completionTokens) + total;
            } else if (/request/i.test(metricName)) {
              current.requests = nonNegative(current.requests) + total;
            } else if (/token|inference/i.test(metricName)) {
              current.tokens = nonNegative(current.tokens) + total;
            }

            current.tokens = Math.max(nonNegative(current.tokens), nonNegative(current.promptTokens) + nonNegative(current.completionTokens));
            grouped.set(key, current);
          }
        }
      }

      for (const [key, item] of grouped) {
        modelRecords.push(toModelRecord("azure-monitor", "cloud_metric", `azure:${hashId(key)}`, item));
      }
    }

    return {
      modelRecords,
      agentRecords: [],
      statuses: [
        status("azure-monitor", "Azure OpenAI Monitor", modelRecords.length ? "已接入" : "无记录", modelRecords.length ? "ready" : "pending", {
          records: modelRecords.length,
          docs: "https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-cognitiveservices-accounts-metrics",
        }),
      ],
    };
  } catch (error) {
    return {
      modelRecords,
      agentRecords: [],
      statuses: [
        status("azure-monitor", "Azure OpenAI Monitor", "错误", "error", {
          message: error instanceof Error ? error.message : String(error),
          docs: "https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-cognitiveservices-accounts-metrics",
        }),
      ],
    };
  }
}
