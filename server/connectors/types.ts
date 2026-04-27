import type { AgentUsageRecord, ModelUsageRecord } from "../../src/data";

export type SourceKind =
  | "gateway"
  | "provider_api"
  | "cloud_metric"
  | "billing_export"
  | "trace"
  | "public_stats"
  | "sample";

export type SourceStatusType = "ready" | "pending" | "error";

export type SourceStatus = {
  id: string;
  label: string;
  value: string;
  status: SourceStatusType;
  records?: number;
  message?: string;
  docs?: string;
};

export type ConnectorContext = {
  startDate: string;
  endDate: string;
  days: number;
  dataDir: string;
};

export type NormalizedModelUsageRecord = ModelUsageRecord & {
  source: string;
  sourceKind: SourceKind;
  sourceRecordId: string;
  sourcePriority: number;
  observedAt: string;
  isEstimate?: boolean;
};

export type NormalizedAgentUsageRecord = AgentUsageRecord & {
  source: string;
  sourceKind: SourceKind;
  sourceRecordId: string;
  sourcePriority: number;
  observedAt: string;
  isEstimate?: boolean;
};

export type ConnectorResult = {
  modelRecords: NormalizedModelUsageRecord[];
  agentRecords: NormalizedAgentUsageRecord[];
  statuses: SourceStatus[];
};

export type TelemetryPayload = {
  generatedAt: string;
  sourceMode: "live" | "sample";
  modelUsageRecords: ModelUsageRecord[];
  agentUsageRecords: AgentUsageRecord[];
  sourceReadiness: SourceStatus[];
};
