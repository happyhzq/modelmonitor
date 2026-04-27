import type { ConnectorContext, ConnectorResult, NormalizedAgentUsageRecord, NormalizedModelUsageRecord } from "./types";
import { clean, hashId, nonNegative, providerRegion, status, toAgentRecord, toModelRecord } from "./utils";

type CacheEntry = {
  expiresAt: number;
  result: ConnectorResult;
};

let cache: CacheEntry | undefined;

const openRouterRankingsUrl = "https://openrouter.ai/rankings";
const openRouterAppsUrl = "https://openrouter.ai/apps";
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

  const results = await Promise.allSettled([
    loadOpenRouterModelRankings(context),
    loadOpenRouterAppRankings(context),
    loadHuggingFaceSignals(),
  ]);
  const modelRecords: NormalizedModelUsageRecord[] = [];
  const agentRecords: NormalizedAgentUsageRecord[] = [];
  const statuses = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      modelRecords.push(...result.value.modelRecords);
      agentRecords.push(...result.value.agentRecords);
      statuses.push(...result.value.statuses);
    } else {
      statuses.push(
        status("public-web-error", "公开 Web 数据", "错误", "error", {
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }),
      );
    }
  }

  const connectorResult = { modelRecords, agentRecords, statuses };
  const ttl = Math.max(60, Number(process.env.MODEL_MONITOR_PUBLIC_WEB_TTL_SECONDS || 900));
  cache = {
    expiresAt: now + ttl * 1000,
    result: connectorResult,
  };

  return connectorResult;
}

async function loadOpenRouterModelRankings(context: ConnectorContext): Promise<ConnectorResult> {
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
      }),
    );
  }

  return {
    modelRecords: [],
    agentRecords: records,
    statuses: [
      status("openrouter-public-apps", "OpenRouter App/Agent 公开榜", records.length ? "已实时抓取" : "无记录", records.length ? "ready" : "pending", {
        records: records.length,
        message: "公开页面公布 token；调用次数按 8k tokens/调用估算，范围仅代表 OpenRouter App/Agent 流量",
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

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "AI-Model-Monitor/0.1 public data integration",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
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
