import type { ConnectorContext, ConnectorResult, NormalizedAgentUsageRecord, NormalizedModelUsageRecord } from "./types";
import { clean, hashId, nonNegative, providerRegion, status, toAgentRecord, toModelRecord } from "./utils";

type CacheEntry = {
  expiresAt: number;
  result: ConnectorResult;
};

let cache: CacheEntry | undefined;

const openRouterRankingsUrl = "https://openrouter.ai/rankings";
const openRouterAppsUrl = "https://openrouter.ai/apps";
const openRouterRankingsDatasetUrl = "https://openrouter.ai/api/v1/datasets/rankings-daily";
const openRouterAppsDatasetUrl = "https://openrouter.ai/api/v1/datasets/app-rankings";
const huggingFaceModelsUrl = "https://huggingface.co/api/models?sort=downloads&direction=-1&limit=25";

export async function loadPublicWebSources(context: ConnectorContext): Promise<ConnectorResult> {
  if (process.env.MODEL_MONITOR_PUBLIC_WEB === "false") {
    return {
      modelRecords: [],
      agentRecords: [],
      statuses: [
        status("public-web", "公开 Web 数据", "已关闭", "pending", {
          message: "MODEL_MONITOR_PUBLIC_WEB=false",
        }),
      ],
    };
  }

  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.result;
  }

  const loaders = [
    {
      id: "openrouter-public-rankings",
      label: "OpenRouter 模型公开榜",
      load: () => loadOpenRouterModelRankings(context),
    },
    {
      id: "openrouter-public-apps",
      label: "OpenRouter App/Agent 公开榜",
      load: () => loadOpenRouterAppRankings(context),
    },
    {
      id: "huggingface-model-downloads",
      label: "Hugging Face 模型下载热度",
      load: () => loadHuggingFaceSignals(),
    },
  ];
  const results = await Promise.allSettled(loaders.map((loader) => loader.load()));
  const modelRecords: NormalizedModelUsageRecord[] = [];
  const agentRecords: NormalizedAgentUsageRecord[] = [];
  const statuses = [];

  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      modelRecords.push(...result.value.modelRecords);
      agentRecords.push(...result.value.agentRecords);
      statuses.push(...result.value.statuses);
    } else {
      const loader = loaders[index];
      statuses.push(
        status(loader.id, loader.label, "错误", "error", {
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }),
      );
    }
  }

  const connectorResult = { modelRecords, agentRecords, statuses };
  const ttl = Math.max(60, Number(process.env.MODEL_MONITOR_PUBLIC_WEB_TTL_SECONDS || 18_000));
  cache = {
    expiresAt: now + ttl * 1000,
    result: connectorResult,
  };

  return connectorResult;
}

async function loadOpenRouterModelRankings(context: ConnectorContext): Promise<ConnectorResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (key) {
    return loadOpenRouterModelRankingsDataset(context, key);
  }

  const result = await loadOpenRouterModelRankingsHtml(context);
  if (result.modelRecords.length) {
    return result;
  }

  return {
    ...result,
    statuses: [
      status("openrouter-public-rankings", "OpenRouter 模型公开榜", "未配置", "pending", {
        records: 0,
        message: "OPENROUTER_API_KEY 未配置；官方 Dataset API 需要 Bearer token，公开页面当前没有可解析的日级 token 字段",
        docs: "https://openrouter.ai/docs/api/api-reference/datasets/daily-token-totals-for-top-50-models",
      }),
    ],
  };
}

async function loadOpenRouterModelRankingsDataset(context: ConnectorContext, key: string): Promise<ConnectorResult> {
  const window = openRouterDatasetWindow(context);
  const url = withQuery(openRouterRankingsDatasetUrl, {
    start_date: window.startDate,
    end_date: window.endDate,
  });
  const payload = await fetchJson<{
    data?: Array<{
      date?: string;
      model_permaslug?: string;
      total_tokens?: string | number;
    }>;
    meta?: {
      as_of?: string;
      start_date?: string;
      end_date?: string;
      version?: string;
    };
  }>(url, {
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
    },
  });
  const records: NormalizedModelUsageRecord[] = [];

  for (const row of payload.data ?? []) {
    const date = clean(row.date);
    const slug = clean(row.model_permaslug);
    const tokens = nonNegative(row.total_tokens);
    if (!date || !slug || !tokens) {
      continue;
    }

    const provider = slug === "other" ? "OpenRouter Other" : providerFromSlug(slug);
    records.push(
      toModelRecord("openrouter-public-rankings", "public_stats", `openrouter-ranking-dataset:${date}:${slug}`, {
        date,
        provider,
        providerRegion: providerRegion(provider),
        model: slug === "other" ? "Other OpenRouter models" : modelNameFromSlug(slug),
        modelClass: "OpenRouter public ranking",
        country: "未知",
        countryCode: "ZZ",
        tokens,
        requests: 0,
        coverage: 100,
        isEstimate: true,
        metricNote: `OpenRouter Dataset API total_tokens; prompt/completion split and request count are not disclosed${
          payload.meta?.as_of ? `; as of ${payload.meta.as_of}` : ""
        }`,
      }),
    );
  }

  return {
    modelRecords: records,
    agentRecords: [],
    statuses: [
      status("openrouter-public-rankings", "OpenRouter 模型公开榜", records.length ? "已实时抓取" : "无记录", records.length ? "ready" : "pending", {
        records: records.length,
        message: `OpenRouter Dataset API daily total_tokens；范围 ${payload.meta?.start_date ?? window.startDate} 到 ${
          payload.meta?.end_date ?? window.endDate
        }，仅代表 OpenRouter 流量`,
        docs: "https://openrouter.ai/docs/api/api-reference/datasets/daily-token-totals-for-top-50-models",
      }),
    ],
  };
}

async function loadOpenRouterModelRankingsHtml(context: ConnectorContext): Promise<ConnectorResult> {
  const html = await fetchText(openRouterRankingsUrl);
  const records: NormalizedModelUsageRecord[] = [];
  const decoded = decodeNextFlight(html);
  const itemRe =
    /\{"date":"([^"]+)","model_permaslug":"([^"]+)","variant":"([^"]*)","total_completion_tokens":([0-9.e+-]+),"total_prompt_tokens":([0-9.e+-]+),"total_native_tokens_reasoning":([0-9.e+-]+),"count":([0-9.e+-]+)/g;

  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(decoded))) {
    const date = match[1].slice(0, 10);
    if (date < context.startDate || date > context.endDate) {
      continue;
    }

    const slug = match[2];
    const provider = providerFromSlug(slug);
    const completionTokens = nonNegative(match[4]);
    const promptTokens = nonNegative(match[5]);
    const reasoningTokens = nonNegative(match[6]);
    const requests = nonNegative(match[7]);

    records.push(
      toModelRecord("openrouter-public-rankings", "public_stats", `openrouter-ranking:${date}:${slug}:${hashId(match[0])}`, {
        date,
        provider,
        providerRegion: providerRegion(provider),
        model: modelNameFromSlug(slug),
        modelClass: "OpenRouter public ranking",
        country: "未知",
        countryCode: "ZZ",
        tokens: promptTokens + completionTokens + reasoningTokens,
        promptTokens,
        completionTokens: completionTokens + reasoningTokens,
        requests,
        coverage: 100,
        metricNote: "OpenRouter public rankings; scope is OpenRouter traffic only",
      }),
    );
  }

  return {
    modelRecords: records,
    agentRecords: [],
    statuses: [
      status("openrouter-public-rankings", "OpenRouter 模型公开榜", records.length ? "已实时抓取" : "无记录", records.length ? "ready" : "pending", {
        records: records.length,
        message: "公开页面包含按日 prompt/completion/reasoning token 与请求数；范围仅代表 OpenRouter 流量",
        docs: openRouterRankingsUrl,
      }),
    ],
  };
}

async function loadOpenRouterAppRankings(context: ConnectorContext): Promise<ConnectorResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (key) {
    return loadOpenRouterAppRankingsDataset(context, key);
  }

  const result = await loadOpenRouterAppRankingsHtml(context);
  if (result.agentRecords.length) {
    return result;
  }

  return {
    ...result,
    statuses: [
      status("openrouter-public-apps", "OpenRouter App/Agent 公开榜", "未配置", "pending", {
        records: 0,
        message: "OPENROUTER_API_KEY 未配置；官方 Dataset API 需要 Bearer token，公开页面当前没有可解析的 App/Agent token 字段",
        docs: "https://openrouter.ai/docs/api/api-reference/datasets/get-app-rankings",
      }),
    ],
  };
}

async function loadOpenRouterAppRankingsDataset(context: ConnectorContext, key: string): Promise<ConnectorResult> {
  const window = openRouterDatasetWindow(context);
  const requestedDays = clampInteger(Number(process.env.MODEL_MONITOR_OPENROUTER_APP_DAILY_DAYS || 7), 1, context.days);
  const startDate = maxISODate(window.startDate, shiftISODate(window.endDate, -(requestedDays - 1)));
  const dates = isoDatesBetween(startDate, window.endDate);
  const limit = clampInteger(Number(process.env.MODEL_MONITOR_OPENROUTER_APP_LIMIT || 50), 1, 100);
  const delayMs = Math.max(0, Number(process.env.MODEL_MONITOR_OPENROUTER_APP_REQUEST_DELAY_MS || 0));
  const records: NormalizedAgentUsageRecord[] = [];
  let latestAsOf = "";
  let loadedDates = 0;

  for (const [index, date] of dates.entries()) {
    if (index > 0 && delayMs) {
      await delay(delayMs);
    }

    const url = withQuery(openRouterAppsDatasetUrl, {
      start_date: date,
      end_date: date,
      limit: String(limit),
      sort: "popular",
    });
    const payload = await fetchJson<{
      data?: Array<{
        app_id?: string | number;
        app_name?: string;
        total_requests?: string | number;
        total_tokens?: string | number;
      }>;
      meta?: {
        as_of?: string;
        start_date?: string;
        end_date?: string;
        version?: string;
      };
    }>(url, {
      headers: {
        authorization: `Bearer ${key}`,
        accept: "application/json",
      },
    });

    if (payload.meta?.as_of) {
      latestAsOf = payload.meta.as_of;
    }
    if (payload.data?.length) {
      loadedDates += 1;
    }

    for (const row of payload.data ?? []) {
      const name = clean(row.app_name) || `OpenRouter App ${row.app_id ?? "unknown"}`;
      const tokens = nonNegative(row.total_tokens);
      const requests = Math.round(nonNegative(row.total_requests));
      const invocations = requests || Math.max(1, Math.round(tokens / 8000));
      if (!tokens) {
        continue;
      }

      records.push(
        toAgentRecord("openrouter-public-apps", "public_stats", `openrouter-app-dataset:${date}:${row.app_id ?? hashId(name)}`, {
          date,
          category: classifyApp(name, String(row.app_id ?? "")),
          framework: name,
          country: "未知",
          countryCode: "ZZ",
          invocations,
          completedTasks: invocations,
          toolCalls: 0,
          tokens,
          successRate: 100,
          avgSteps: 1,
          handoffRate: 0,
          isEstimate: !requests,
          metricNote: `OpenRouter app dataset; success, tool calls, and handoff are not disclosed${
            latestAsOf ? `; as of ${latestAsOf}` : ""
          }`,
        }),
      );
    }
  }

  return {
    modelRecords: [],
    agentRecords: records,
    statuses: [
      status("openrouter-public-apps", "OpenRouter App/Agent 公开榜", records.length ? "已实时抓取" : "无记录", records.length ? "ready" : "pending", {
        records: records.length,
        message: `OpenRouter Dataset API app-rankings；采集 ${dates.length} 天，${loadedDates} 天有记录；仅代表 OpenRouter App/Agent 流量`,
        docs: "https://openrouter.ai/docs/api/api-reference/datasets/get-app-rankings",
      }),
    ],
  };
}

async function loadOpenRouterAppRankingsHtml(context: ConnectorContext): Promise<ConnectorResult> {
  const html = await fetchText(openRouterAppsUrl);
  const decoded = decodeNextFlight(html);
  const records: NormalizedAgentUsageRecord[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href="\/apps\/((?!category\/)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const date = context.endDate;
  let match: RegExpExecArray | null;

  while ((match = anchorRe.exec(decoded))) {
    const slug = match[1];
    if (seen.has(slug)) {
      continue;
    }

    const body = match[2];
    const name =
      body.match(/<span class="[^"]*font-medium[^"]*truncate[^"]*">([^<]+)<\/span>/)?.[1] ??
      body.match(/>([^<>]+)<!-- -->/)?.[1] ??
      slug;
    const tokenText = body.match(/<span[^>]*>([0-9.]+[KMBT]?)<\/span><span[^>]*>tokens<\/span>/)?.[1];
    const tokens = parseCompactNumber(tokenText ?? "");

    if (!tokens) {
      continue;
    }

    seen.add(slug);
    records.push(
      toAgentRecord("openrouter-public-apps", "public_stats", `openrouter-app:${date}:${slug}`, {
        date,
        category: classifyApp(name, slug),
        framework: clean(name) || slug,
        country: "未知",
        countryCode: "ZZ",
        invocations: Math.max(1, Math.round(tokens / 8000)),
        completedTasks: Math.max(1, Math.round(tokens / 8000)),
        toolCalls: 0,
        tokens,
        successRate: 100,
        avgSteps: 1,
        handoffRate: 0,
        isEstimate: true,
        metricNote: "OpenRouter Apps exposes tokens only; invocations are estimated at 8000 tokens per call",
      }),
    );
  }

  return {
    modelRecords: [],
    agentRecords: records,
    statuses: [
      status("openrouter-public-apps", "OpenRouter App/Agent 公开榜", records.length ? "已实时抓取" : "无记录", records.length ? "ready" : "pending", {
        records: records.length,
        message: "公开页面公布 token 但不披露时间粒度和调用次数；按抓取日落库，调用次数按 8k tokens/调用估算，范围仅代表 OpenRouter App/Agent 流量",
        docs: openRouterAppsUrl,
      }),
    ],
  };
}

async function loadHuggingFaceSignals(): Promise<ConnectorResult> {
  const payload = await fetchJson<Array<Record<string, unknown>>>(huggingFaceModelsUrl);
  const count = Array.isArray(payload) ? payload.length : 0;

  return {
    modelRecords: [],
    agentRecords: [],
    statuses: [
      status("huggingface-model-downloads", "Hugging Face 模型下载热度", count ? "已实时抓取" : "无记录", count ? "ready" : "pending", {
        records: count,
        message: "这是公开下载热度，不是 token 调用量；仅作为源发现和热度参考，不计入总 token",
        docs: "https://huggingface.co/docs/hub/api",
      }),
    ],
  };
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "AI-Model-Monitor/0.1 public data integration",
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchJson<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "user-agent": "AI-Model-Monitor/0.1 public data integration",
      accept: "application/json",
      ...headersToObject(init.headers),
    },
  });

  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function headersToObject(headers: HeadersInit | undefined) {
  const output: Record<string, string> = {};
  if (!headers) {
    return output;
  }

  new Headers(headers).forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function openRouterDatasetWindow(context: ConnectorContext) {
  const latestCompletedUtcDay = shiftISODate(new Date().toISOString().slice(0, 10), -1);
  const endDate = minISODate(context.endDate, latestCompletedUtcDay);
  const startDate = context.startDate > endDate ? endDate : context.startDate;
  return {
    startDate,
    endDate,
  };
}

function withQuery(url: string, params: Record<string, string>) {
  const nextUrl = new URL(url);
  Object.entries(params).forEach(([key, value]) => nextUrl.searchParams.set(key, value));
  return nextUrl.toString();
}

function isoDatesBetween(startDate: string, endDate: string) {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = shiftISODate(current, 1);
  }
  return dates;
}

function shiftISODate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function minISODate(left: string, right: string) {
  return left <= right ? left : right;
}

function maxISODate(left: string, right: string) {
  return left >= right ? left : right;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function decodeNextFlight(html: string) {
  return html
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<!-- -->/g, "");
}

function providerFromSlug(slug: string) {
  const provider = slug.split("/")[0] || "OpenRouter";
  const normalized: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    meta: "Meta",
    mistralai: "Mistral",
    mistral: "Mistral",
    deepseek: "DeepSeek",
    qwen: "Alibaba Cloud",
    "x-ai": "xAI",
    moonshotai: "Moonshot AI",
    z: "Z.ai",
    "z-ai": "Z.ai",
    tencent: "Tencent",
    xiaomi: "Xiaomi",
    inclusionai: "Alibaba Cloud",
  };

  return normalized[provider] ?? titleCase(provider.replace(/-/g, " "));
}

function modelNameFromSlug(slug: string) {
  const [, model = slug] = slug.split("/");
  return model.replace(/[-_]/g, " ");
}

function parseCompactNumber(value: string) {
  const match = value.trim().match(/^([0-9.]+)\s*([KMBT])?$/i);
  if (!match) {
    return 0;
  }

  const number = Number(match[1]);
  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "T" ? 1_000_000_000_000 : suffix === "B" ? 1_000_000_000 : suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  return Math.round(number * multiplier);
}

function classifyApp(name: string, slug: string) {
  const text = `${name} ${slug}`.toLowerCase();
  if (/code|cline|roo|kilo|developer|langchain|webui/.test(text)) return "代码开发";
  if (/agent|openclaw|gobii|automation/.test(text)) return "流程自动化";
  if (/video|audio|creative|descript|muse|image/.test(text)) return "创意生成";
  if (/chat|character|janitor|silly|roleplay|isekai|hammer/.test(text)) return "娱乐聊天";
  return "OpenRouter Apps";
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}
