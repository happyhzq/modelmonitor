import { countries } from "../../src/data";
import type { AgentUsageRecord, ModelUsageRecord } from "../../src/data";
import type {
  NormalizedAgentUsageRecord,
  NormalizedModelUsageRecord,
  SourceKind,
  SourceStatus,
  SourceStatusType,
} from "./types";

const sourcePriority: Record<SourceKind, number> = {
  gateway: 100,
  trace: 95,
  provider_api: 80,
  cloud_metric: 70,
  billing_export: 55,
  public_stats: 25,
  sample: 0,
};

export function priorityFor(kind: SourceKind) {
  return sourcePriority[kind];
}

export function status(
  id: string,
  label: string,
  value: string,
  statusValue: SourceStatusType,
  extra: Partial<SourceStatus> = {},
): SourceStatus {
  return {
    id,
    label,
    value,
    status: statusValue,
    ...extra,
  };
}

export function toModelRecord(
  source: string,
  sourceKind: SourceKind,
  sourceRecordId: string,
  record: Partial<ModelUsageRecord>,
): NormalizedModelUsageRecord {
  const promptTokens = nonNegative(record.promptTokens);
  const completionTokens = nonNegative(record.completionTokens);
  const tokens = nonNegative(record.tokens ?? promptTokens + completionTokens);
  const country = normalizeCountry(record.country, record.countryCode);

  return {
    date: normalizeDate(record.date) ?? todayISO(),
    provider: clean(record.provider) || "Unknown",
    providerRegion: clean(record.providerRegion) || providerRegion(clean(record.provider)),
    model: clean(record.model) || "Unknown model",
    modelClass: clean(record.modelClass) || "Unknown",
    country: country.name,
    countryCode: country.code,
    region: country.region,
    tokens,
    promptTokens: promptTokens || Math.round(tokens * 0.62),
    completionTokens: completionTokens || Math.max(0, tokens - Math.round(tokens * 0.62)),
    requests: Math.max(0, Math.round(nonNegative(record.requests))),
    activeUsers: Math.max(0, Math.round(nonNegative(record.activeUsers))),
    avgLatencyMs: Math.max(0, Math.round(nonNegative(record.avgLatencyMs))),
    coverage: clamp(nonNegative(record.coverage || 100), 0, 100),
    isEstimate: Boolean(record.isEstimate),
    metricNote: clean(record.metricNote) || undefined,
    source,
    sourceKind,
    sourceRecordId,
    sourcePriority: priorityFor(sourceKind),
    observedAt: new Date().toISOString(),
  };
}

export function toAgentRecord(
  source: string,
  sourceKind: SourceKind,
  sourceRecordId: string,
  record: Partial<AgentUsageRecord>,
): NormalizedAgentUsageRecord {
  const country = normalizeCountry(record.country, record.countryCode);
  const invocations = Math.max(0, Math.round(nonNegative(record.invocations || record.completedTasks)));

  return {
    date: normalizeDate(record.date) ?? todayISO(),
    category: clean(record.category) || "Agent",
    framework: clean(record.framework) || "Unknown framework",
    country: country.name,
    countryCode: country.code,
    region: country.region,
    invocations,
    completedTasks: Math.max(0, Math.round(nonNegative(record.completedTasks || invocations))),
    toolCalls: Math.max(0, Math.round(nonNegative(record.toolCalls))),
    tokens: nonNegative(record.tokens),
    successRate: clamp(nonNegative(record.successRate || 100), 0, 100),
    avgSteps: nonNegative(record.avgSteps || 1),
    handoffRate: clamp(nonNegative(record.handoffRate), 0, 100),
    isEstimate: Boolean(record.isEstimate),
    metricNote: clean(record.metricNote) || undefined,
    source,
    sourceKind,
    sourceRecordId,
    sourcePriority: priorityFor(sourceKind),
    observedAt: new Date().toISOString(),
  };
}

export async function fetchJson<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 240)}` : ""}`);
  }

  return (await response.json()) as T;
}

export function envList(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function startUnix(date: string) {
  return Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 1000);
}

export function endUnix(date: string) {
  return Math.floor(new Date(`${date}T23:59:59.999Z`).getTime() / 1000);
}

export function normalizeDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString().slice(0, 10);
  }

  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

export function dateDaysAgo(days: number) {
  return shiftISODate(todayISO(), -Math.max(0, days - 1));
}

export function todayISO() {
  return formatDateInTimezone(new Date(), process.env.MODEL_MONITOR_TIMEZONE || "Asia/Shanghai");
}

function formatDateInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function shiftISODate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function nonNegative(value: unknown) {
  const number = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return number;
}

export function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function hashId(value: unknown) {
  const input = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function providerRegion(provider?: string) {
  if (!provider) {
    return "未知";
  }

  if (/alibaba|dashscope|qwen|deepseek|moonshot|tencent|xiaomi|z\.ai|z-ai|inclusion/i.test(provider)) {
    return "中国";
  }
  if (/mistral/i.test(provider)) {
    return "法国";
  }

  return "美国";
}

export function normalizeCountry(country?: unknown, countryCode?: unknown) {
  const code = typeof countryCode === "string" ? countryCode.toUpperCase().trim() : "";
  const byCode = countries.find((item) => item.code === code);
  if (byCode) {
    return byCode;
  }

  const name = typeof country === "string" ? country.trim() : "";
  const byName = countries.find((item) => item.name === name || item.code === name.toUpperCase());
  if (byName) {
    return byName;
  }

  const regionCountry = countryFromCloudRegion(name || code);
  if (regionCountry) {
    return regionCountry;
  }

  return { name: name || "未知", code: code || "ZZ", region: "未知", weight: 0 };
}

export function countryFromCloudRegion(region: string) {
  const normalized = region.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (/china|cn-|hangzhou|shanghai|beijing|qingdao|shenzhen|zhangjiakou|hkg|hongkong|hong-kong/.test(normalized)) {
    return countries.find((item) => item.code === "CN");
  }
  if (/us-|eastus|westus|centralus|virginia|ohio|oregon|california|iowa|carolina/.test(normalized)) {
    return countries.find((item) => item.code === "US");
  }
  if (/europe|france|paris/.test(normalized)) {
    return countries.find((item) => item.code === "FR");
  }
  if (/germany|frankfurt/.test(normalized)) {
    return countries.find((item) => item.code === "DE");
  }
  if (/uk|london/.test(normalized)) {
    return countries.find((item) => item.code === "GB");
  }
  if (/japan|tokyo|osaka/.test(normalized)) {
    return countries.find((item) => item.code === "JP");
  }
  if (/korea|seoul/.test(normalized)) {
    return countries.find((item) => item.code === "KR");
  }
  if (/singapore|southeastasia/.test(normalized)) {
    return countries.find((item) => item.code === "SG");
  }
  if (/australia|sydney|melbourne/.test(normalized)) {
    return countries.find((item) => item.code === "AU");
  }
  if (/india|mumbai|delhi/.test(normalized)) {
    return countries.find((item) => item.code === "IN");
  }
  if (/canada/.test(normalized)) {
    return countries.find((item) => item.code === "CA");
  }
  if (/brazil|sao/.test(normalized)) {
    return countries.find((item) => item.code === "BR");
  }

  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
