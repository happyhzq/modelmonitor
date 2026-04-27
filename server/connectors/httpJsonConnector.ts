import type { ConnectorContext, ConnectorResult, NormalizedAgentUsageRecord, NormalizedModelUsageRecord } from "./types";
import { clean, envList, fetchJson, hashId, status, toAgentRecord, toModelRecord } from "./utils";

type SourcePayload =
  | Array<Record<string, unknown>>
  | {
      modelRecords?: Array<Record<string, unknown>>;
      agentRecords?: Array<Record<string, unknown>>;
      data?: Array<Record<string, unknown>>;
    };

export async function loadHttpJsonSources(_context: ConnectorContext): Promise<ConnectorResult> {
  const urls = envList("MODEL_MONITOR_HTTP_JSON_SOURCES");
  if (!urls.length) {
    return {
      modelRecords: [],
      agentRecords: [],
      statuses: [
        status("http-json", "自定义 HTTP JSON", "未配置", "pending", {
          message: "MODEL_MONITOR_HTTP_JSON_SOURCES 可接任意内部遥测 API",
        }),
      ],
    };
  }

  const modelRecords: NormalizedModelUsageRecord[] = [];
  const agentRecords: NormalizedAgentUsageRecord[] = [];
  const statuses = [];

  for (const url of urls) {
    try {
      const payload = await fetchJson<SourcePayload>(url);
      const sourceRows = Array.isArray(payload) ? payload : payload.data ?? [];
      const modelRows = Array.isArray(payload) ? sourceRows : payload.modelRecords ?? sourceRows;
      const agentRows = Array.isArray(payload) ? [] : payload.agentRecords ?? [];

      modelRows.forEach((row, index) => {
        modelRecords.push(
          toModelRecord(`http-json:${url}`, "gateway", clean(row.sourceRecordId) || `http:${hashId(url)}:${index}:${hashId(row)}`, row),
        );
      });
      agentRows.forEach((row, index) => {
        agentRecords.push(
          toAgentRecord(`http-json:${url}`, "trace", clean(row.sourceRecordId) || `http-agent:${hashId(url)}:${index}:${hashId(row)}`, row),
        );
      });

      statuses.push(
        status(`http-json-${hashId(url)}`, "自定义 HTTP JSON", "已接入", "ready", {
          records: modelRows.length + agentRows.length,
          message: url,
        }),
      );
    } catch (error) {
      statuses.push(
        status(`http-json-${hashId(url)}`, "自定义 HTTP JSON", "错误", "error", {
          message: `${url}: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    }
  }

  return {
    modelRecords,
    agentRecords,
    statuses,
  };
}
