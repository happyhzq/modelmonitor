import {
  agentUsageRecords as sampleAgentUsageRecords,
  modelUsageRecords as sampleModelUsageRecords,
  type AgentUsageRecord,
  type ModelUsageRecord,
} from "../src/data";
import type {
  ConnectorContext,
  ConnectorResult,
  NormalizedAgentUsageRecord,
  NormalizedModelUsageRecord,
  SourceStatus,
  TelemetryPayload,
} from "./connectors/types";
import { loadAnthropicUsage } from "./connectors/anthropicConnector";
import { loadAzureMonitorUsage } from "./connectors/azureMonitorConnector";
import { loadFileSources } from "./connectors/fileConnector";
import { loadHttpJsonSources } from "./connectors/httpJsonConnector";
import { loadOpenAIUsage } from "./connectors/openaiConnector";
import { loadOpenRouterUsage } from "./connectors/openRouterConnector";
import { loadPublicWebSources } from "./connectors/publicWebConnector";
import { dateDaysAgo, hashId, nonNegative, priorityFor, status, todayISO, toAgentRecord, toModelRecord } from "./connectors/utils";
import { readTelemetryFromMysql, upsertTelemetryToMysql } from "./db";
import { registryStatuses } from "./sourceRegistry";

export async function buildTelemetry(days: number): Promise<TelemetryPayload> {
  const context: ConnectorContext = {
    startDate: dateDaysAgo(days),
    endDate: todayISO(),
    days,
    dataDir: process.env.MODEL_MONITOR_DATA_DIR || "./data/sources",
  };
  const connectors = [
    loadFileSources,
    loadOpenAIUsage,
    loadAnthropicUsage,
    loadOpenRouterUsage,
    loadAzureMonitorUsage,
    loadHttpJsonSources,
    loadPublicWebSources,
  ];
  const results = await Promise.all(connectors.map((connector) => connector(context)));
  const allModelRecords = results.flatMap((result) => result.modelRecords);
  const allAgentRecords = results.flatMap((result) => result.agentRecords);
  const allStatuses = mergeStatuses([
    ...results.flatMap((result) => result.statuses),
    ...registryStatuses(),
  ]);

  if (!allModelRecords.length && !allAgentRecords.length) {
    const mysqlRead = await safeReadMysql(context.days);
    if (mysqlRead.payload && (mysqlRead.payload.modelUsageRecords.length || mysqlRead.payload.agentUsageRecords.length)) {
      return {
        generatedAt: new Date().toISOString(),
        sourceMode: "live",
        modelUsageRecords: mysqlRead.payload.modelUsageRecords,
        agentUsageRecords: mysqlRead.payload.agentUsageRecords,
        sourceReadiness: [mysqlRead.payload.status, ...mysqlRead.statuses, ...allStatuses],
      };
    }

    if (process.env.MODEL_MONITOR_SAMPLE_FALLBACK === "false") {
      return {
        generatedAt: new Date().toISOString(),
        sourceMode: "live",
        modelUsageRecords: [],
        agentUsageRecords: [],
        sourceReadiness: [...mysqlRead.statuses, ...allStatuses],
      };
    }

    const sampleModels = sampleModelUsageRecords
      .filter((record) => record.date >= context.startDate && record.date <= context.endDate)
      .map((record) =>
        toModelRecord("sample", "sample", `sample-model:${hashId(record)}`, {
          ...record,
          coverage: 68,
        }),
      );
    const sampleAgents = sampleAgentUsageRecords
      .filter((record) => record.date >= context.startDate && record.date <= context.endDate)
      .map((record) => toAgentRecord("sample", "sample", `sample-agent:${hashId(record)}`, record));

    return {
      generatedAt: new Date().toISOString(),
      sourceMode: "sample",
      modelUsageRecords: stripModelMetadata(dedupeModelRecords(sampleModels)),
      agentUsageRecords: stripAgentMetadata(dedupeAgentRecords(sampleAgents)),
      sourceReadiness: [
        status("sample", "示例遥测", "已启用", "ready", {
          records: sampleModels.length + sampleAgents.length,
          message: "没有可用真实数据源时自动兜底；生产请配置 .env",
        }),
        ...mysqlRead.statuses,
        ...allStatuses,
      ],
    };
  }

  const modelRecords = dedupeModelRecords(allModelRecords);
  const agentRecords = dedupeAgentRecords(allAgentRecords);
  const livePayload: TelemetryPayload = {
    generatedAt: new Date().toISOString(),
    sourceMode: "live",
    modelUsageRecords: stripModelMetadata(modelRecords),
    agentUsageRecords: stripAgentMetadata(agentRecords),
    sourceReadiness: [
      status("dedupe", "去重聚合", `${modelRecords.length + agentRecords.length} 条`, "ready", {
        message: "按 sourceRecordId 精确去重；同日同供应商/模型/国家选择最高优先级来源后聚合",
      }),
      ...allStatuses,
    ],
  };
  const mysqlPersistStatus = await upsertTelemetryToMysql(livePayload);
  const mysqlRead = await safeReadMysql(context.days);

  if (mysqlRead.payload && (mysqlRead.payload.modelUsageRecords.length || mysqlRead.payload.agentUsageRecords.length)) {
    return {
      ...livePayload,
      modelUsageRecords: mysqlRead.payload.modelUsageRecords,
      agentUsageRecords: mysqlRead.payload.agentUsageRecords,
      sourceReadiness: [
        ...livePayload.sourceReadiness,
        mysqlPersistStatus,
        mysqlRead.payload.status,
        ...mysqlRead.statuses,
      ],
    };
  }

  return {
    ...livePayload,
    sourceReadiness: [
      ...livePayload.sourceReadiness,
      mysqlPersistStatus,
      ...mysqlRead.statuses,
    ],
  };
}

async function safeReadMysql(days: number) {
  try {
    const payload = await readTelemetryFromMysql(days);
    return {
      payload,
      statuses: [] as SourceStatus[],
    };
  } catch (error) {
    return {
      payload: undefined,
      statuses: [
        status("mysql-read", "MySQL 数据读取", "错误", "error", {
          message: error instanceof Error ? error.message : String(error),
        }),
      ],
    };
  }
}

function dedupeModelRecords(records: NormalizedModelUsageRecord[]) {
  const exact = new Map<string, NormalizedModelUsageRecord>();
  records.forEach((record) => {
    const key = `${record.source}:${record.sourceRecordId}`;
    const existing = exact.get(key);
    if (!existing || record.sourcePriority > existing.sourcePriority || record.observedAt > existing.observedAt) {
      exact.set(key, record);
    }
  });

  const grouped = groupBy(Array.from(exact.values()), (record) =>
    [record.date, record.provider, record.model, record.countryCode].join("|"),
  );

  return Array.from(grouped.values()).map((group) => {
    const maxPriority = Math.max(...group.map((record) => record.sourcePriority));
    const winners = group.filter((record) => record.sourcePriority === maxPriority);
    return aggregateModelGroup(winners);
  });
}

function dedupeAgentRecords(records: NormalizedAgentUsageRecord[]) {
  const exact = new Map<string, NormalizedAgentUsageRecord>();
  records.forEach((record) => {
    const key = `${record.source}:${record.sourceRecordId}`;
    const existing = exact.get(key);
    if (!existing || record.sourcePriority > existing.sourcePriority || record.observedAt > existing.observedAt) {
      exact.set(key, record);
    }
  });

  const grouped = groupBy(Array.from(exact.values()), (record) =>
    [record.date, record.framework, record.category, record.countryCode].join("|"),
  );

  return Array.from(grouped.values()).map((group) => {
    const maxPriority = Math.max(...group.map((record) => record.sourcePriority));
    const winners = group.filter((record) => record.sourcePriority === maxPriority);
    return aggregateAgentGroup(winners);
  });
}

function aggregateModelGroup(group: NormalizedModelUsageRecord[]): NormalizedModelUsageRecord {
  const first = group[0];
  const requests = sum(group, "requests");
  const tokens = sum(group, "tokens");
  const promptTokens = sum(group, "promptTokens");
  const completionTokens = sum(group, "completionTokens");

  return {
    ...first,
    tokens,
    promptTokens,
    completionTokens,
    requests,
    activeUsers: sum(group, "activeUsers"),
    avgLatencyMs: requests ? weighted(group, "avgLatencyMs", "requests") : first.avgLatencyMs,
    coverage: tokens ? weighted(group, "coverage", "tokens") : first.coverage,
    sourceRecordId: `deduped:${hashId(group.map((record) => record.sourceRecordId).join(","))}`,
    sourcePriority: Math.max(...group.map((record) => record.sourcePriority)),
    sourceKind: first.sourceKind,
    source: group.map((record) => record.source).sort().join("+"),
  };
}

function aggregateAgentGroup(group: NormalizedAgentUsageRecord[]): NormalizedAgentUsageRecord {
  const first = group[0];
  const invocations = sum(group, "invocations");

  return {
    ...first,
    invocations,
    completedTasks: sum(group, "completedTasks"),
    toolCalls: sum(group, "toolCalls"),
    tokens: sum(group, "tokens"),
    successRate: invocations ? weighted(group, "successRate", "invocations") : first.successRate,
    avgSteps: invocations ? weighted(group, "avgSteps", "invocations") : first.avgSteps,
    handoffRate: invocations ? weighted(group, "handoffRate", "invocations") : first.handoffRate,
    sourceRecordId: `deduped-agent:${hashId(group.map((record) => record.sourceRecordId).join(","))}`,
    sourcePriority: Math.max(...group.map((record) => record.sourcePriority)),
    sourceKind: first.sourceKind,
    source: group.map((record) => record.source).sort().join("+"),
  };
}

function stripModelMetadata(records: NormalizedModelUsageRecord[]): ModelUsageRecord[] {
  return records.map(
    ({
      date,
      provider,
      providerRegion,
      model,
      modelClass,
      country,
      countryCode,
      region,
      tokens,
      promptTokens,
      completionTokens,
      requests,
      activeUsers,
      avgLatencyMs,
      coverage,
    }) => ({
      date,
      provider,
      providerRegion,
      model,
      modelClass,
      country,
      countryCode,
      region,
      tokens,
      promptTokens,
      completionTokens,
      requests,
      activeUsers,
      avgLatencyMs,
      coverage,
    }),
  );
}

function stripAgentMetadata(records: NormalizedAgentUsageRecord[]): AgentUsageRecord[] {
  return records.map(
    ({
      date,
      category,
      framework,
      country,
      countryCode,
      region,
      invocations,
      completedTasks,
      toolCalls,
      tokens,
      successRate,
      avgSteps,
      handoffRate,
    }) => ({
      date,
      category,
      framework,
      country,
      countryCode,
      region,
      invocations,
      completedTasks,
      toolCalls,
      tokens,
      successRate,
      avgSteps,
      handoffRate,
    }),
  );
}

function mergeStatuses(statuses: SourceStatus[]) {
  const map = new Map<string, SourceStatus>();
  statuses.forEach((item) => {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      return;
    }

    const preferred = statusRank(item.status) > statusRank(existing.status) ? item : existing;
    map.set(item.id, {
      ...preferred,
      records: nonNegative(existing.records) + nonNegative(item.records),
    });
  });

  return Array.from(map.values());
}

function statusRank(value: SourceStatus["status"]) {
  return value === "ready" ? 3 : value === "error" ? 2 : 1;
}

function groupBy<T>(items: T[], keyFactory: (item: T) => string) {
  const map = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyFactory(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  });

  return map;
}

function sum<T extends Record<string, unknown>>(records: T[], key: keyof T) {
  return records.reduce((accumulator, record) => accumulator + nonNegative(record[key]), 0);
}

function weighted<T extends Record<string, unknown>>(records: T[], valueKey: keyof T, weightKey: keyof T) {
  const weight = sum(records, weightKey);
  if (!weight) {
    return 0;
  }

  return records.reduce((accumulator, record) => accumulator + nonNegative(record[valueKey]) * nonNegative(record[weightKey]), 0) / weight;
}
