export type ModelUsageRecord = {
  date: string;
  provider: string;
  providerRegion: string;
  model: string;
  modelClass: string;
  country: string;
  countryCode: string;
  region: string;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  requests: number;
  activeUsers: number;
  avgLatencyMs: number;
  coverage: number;
  source?: string;
  sourceKind?: string;
  isEstimate?: boolean;
  metricNote?: string;
};

export type AgentUsageRecord = {
  date: string;
  category: string;
  framework: string;
  country: string;
  countryCode: string;
  region: string;
  invocations: number;
  completedTasks: number;
  toolCalls: number;
  tokens: number;
  successRate: number;
  avgSteps: number;
  handoffRate: number;
  source?: string;
  sourceKind?: string;
  isEstimate?: boolean;
  metricNote?: string;
};

export type ProviderProfile = {
  name: string;
  region: string;
  color: string;
};

export const providers: ProviderProfile[] = [
  { name: "OpenAI", region: "美国", color: "#2563eb" },
  { name: "Anthropic", region: "美国", color: "#c2410c" },
  { name: "Google", region: "美国", color: "#16a34a" },
  { name: "Meta", region: "美国", color: "#7c3aed" },
  { name: "xAI", region: "美国", color: "#0f766e" },
  { name: "Mistral", region: "法国", color: "#d97706" },
  { name: "Alibaba Cloud", region: "中国", color: "#dc2626" },
  { name: "DeepSeek", region: "中国", color: "#0891b2" },
];

type ModelProfile = {
  provider: string;
  model: string;
  modelClass: string;
  share: number;
  avgRequestTokens: number;
  latencyMs: number;
};

export const modelProfiles: ModelProfile[] = [
  {
    provider: "OpenAI",
    model: "GPT 系列",
    modelClass: "Frontier general",
    share: 0.18,
    avgRequestTokens: 1850,
    latencyMs: 930,
  },
  {
    provider: "Anthropic",
    model: "Claude 系列",
    modelClass: "Reasoning & coding",
    share: 0.13,
    avgRequestTokens: 2250,
    latencyMs: 990,
  },
  {
    provider: "Google",
    model: "Gemini 系列",
    modelClass: "Multimodal",
    share: 0.16,
    avgRequestTokens: 1710,
    latencyMs: 840,
  },
  {
    provider: "Meta",
    model: "Llama 系列",
    modelClass: "Open weights",
    share: 0.1,
    avgRequestTokens: 1350,
    latencyMs: 620,
  },
  {
    provider: "xAI",
    model: "Grok 系列",
    modelClass: "Consumer assistant",
    share: 0.08,
    avgRequestTokens: 1550,
    latencyMs: 760,
  },
  {
    provider: "Mistral",
    model: "Mistral 系列",
    modelClass: "Enterprise general",
    share: 0.08,
    avgRequestTokens: 1490,
    latencyMs: 690,
  },
  {
    provider: "Alibaba Cloud",
    model: "Qwen 系列",
    modelClass: "Asia enterprise",
    share: 0.16,
    avgRequestTokens: 1420,
    latencyMs: 710,
  },
  {
    provider: "DeepSeek",
    model: "DeepSeek 系列",
    modelClass: "Reasoning & code",
    share: 0.11,
    avgRequestTokens: 1960,
    latencyMs: 870,
  },
];

type CountryProfile = {
  name: string;
  code: string;
  region: string;
  weight: number;
};

export const countries: CountryProfile[] = [
  { name: "美国", code: "US", region: "北美", weight: 0.22 },
  { name: "中国", code: "CN", region: "亚洲", weight: 0.2 },
  { name: "印度", code: "IN", region: "亚洲", weight: 0.11 },
  { name: "日本", code: "JP", region: "亚洲", weight: 0.07 },
  { name: "英国", code: "GB", region: "欧洲", weight: 0.065 },
  { name: "德国", code: "DE", region: "欧洲", weight: 0.058 },
  { name: "法国", code: "FR", region: "欧洲", weight: 0.044 },
  { name: "韩国", code: "KR", region: "亚洲", weight: 0.04 },
  { name: "加拿大", code: "CA", region: "北美", weight: 0.04 },
  { name: "巴西", code: "BR", region: "拉美", weight: 0.035 },
  { name: "新加坡", code: "SG", region: "亚洲", weight: 0.028 },
  { name: "澳大利亚", code: "AU", region: "大洋洲", weight: 0.026 },
  { name: "阿联酋", code: "AE", region: "中东", weight: 0.022 },
  { name: "墨西哥", code: "MX", region: "拉美", weight: 0.021 },
  { name: "荷兰", code: "NL", region: "欧洲", weight: 0.02 },
];

type AgentCategoryProfile = {
  category: string;
  share: number;
  avgTokens: number;
  avgTools: number;
  avgSteps: number;
  successBase: number;
};

export const agentCategories: AgentCategoryProfile[] = [
  {
    category: "代码开发",
    share: 0.2,
    avgTokens: 8200,
    avgTools: 5.8,
    avgSteps: 7.2,
    successBase: 0.83,
  },
  {
    category: "深度研究",
    share: 0.18,
    avgTokens: 9600,
    avgTools: 6.4,
    avgSteps: 8.1,
    successBase: 0.79,
  },
  {
    category: "客服运营",
    share: 0.19,
    avgTokens: 2700,
    avgTools: 2.3,
    avgSteps: 3.4,
    successBase: 0.91,
  },
  {
    category: "数据分析",
    share: 0.14,
    avgTokens: 6200,
    avgTools: 4.1,
    avgSteps: 5.6,
    successBase: 0.86,
  },
  {
    category: "流程自动化",
    share: 0.13,
    avgTokens: 4100,
    avgTools: 5.1,
    avgSteps: 6.5,
    successBase: 0.88,
  },
  {
    category: "安全运维",
    share: 0.09,
    avgTokens: 5400,
    avgTools: 4.8,
    avgSteps: 6.9,
    successBase: 0.84,
  },
  {
    category: "销售助理",
    share: 0.07,
    avgTokens: 3100,
    avgTools: 2.9,
    avgSteps: 4.2,
    successBase: 0.89,
  },
];

type AgentFrameworkProfile = {
  framework: string;
  share: number;
  color: string;
};

export const agentFrameworks: AgentFrameworkProfile[] = [
  { framework: "OpenAI Agents", share: 0.25, color: "#2563eb" },
  { framework: "LangGraph", share: 0.2, color: "#0f766e" },
  { framework: "Claude Computer Use", share: 0.16, color: "#c2410c" },
  { framework: "AutoGen", share: 0.13, color: "#7c3aed" },
  { framework: "CrewAI", share: 0.11, color: "#d97706" },
  { framework: "自研编排", share: 0.15, color: "#0891b2" },
];

export const sourceReadiness = [
  {
    label: "供应商账单 token",
    value: "待接入",
    status: "pending",
  },
  {
    label: "网关请求日志",
    value: "可接入",
    status: "ready",
  },
  {
    label: "国家归因",
    value: "IP / 账户区域",
    status: "ready",
  },
  {
    label: "Agent 轨迹",
    value: "Trace API",
    status: "ready",
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export const dateRange = buildDateRange(30);
export const latestDate = dateRange[dateRange.length - 1];
export const previousDate = dateRange[dateRange.length - 2];

export const modelUsageRecords = buildModelUsage();
export const agentUsageRecords = buildAgentUsage();

export function getProviderColor(providerName: string) {
  return providers.find((provider) => provider.name === providerName)?.color ?? "#475569";
}

export function getAgentFrameworkColor(framework: string) {
  return agentFrameworks.find((item) => item.framework === framework)?.color ?? "#475569";
}

function buildDateRange(days: number) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getTime() - (days - index - 1) * DAY_MS);
    return toISODate(date);
  });
}

function buildModelUsage(): ModelUsageRecord[] {
  const providerMap = new Map(providers.map((provider) => [provider.name, provider]));
  const baseDailyTokens = 64_000_000_000_000;

  return dateRange.flatMap((date, dateIndex) => {
    const calendarDate = new Date(`${date}T00:00:00`);
    const dayOfWeek = calendarDate.getDay();
    const workdayMultiplier = dayOfWeek === 0 || dayOfWeek === 6 ? 0.9 : 1.06;
    const growth = 0.94 + dateIndex * 0.0065;
    const dailyPulse = multiplier(`model-day-${date}`, 0.055);

    return modelProfiles.flatMap((model) => {
      const provider = providerMap.get(model.provider)!;

      return countries.map((country) => {
        const locality = multiplier(`${date}-${model.model}-${country.code}`, 0.18);
        const regionalAffinity =
          (country.name === provider.region ? 1.18 : 1) *
          (country.region === "亚洲" && provider.region === "中国" ? 1.12 : 1);
        const tokens = Math.round(
          baseDailyTokens *
            model.share *
            country.weight *
            workdayMultiplier *
            growth *
            dailyPulse *
            locality *
            regionalAffinity,
        );
        const requestSize = model.avgRequestTokens * multiplier(`${model.model}-${country.code}-request`, 0.12);
        const requests = Math.max(10_000, Math.round(tokens / requestSize));
        const promptRatio = 0.56 + hashUnit(`${date}-${model.model}-${country.code}-prompt`) * 0.15;
        const promptTokens = Math.round(tokens * promptRatio);
        const completionTokens = tokens - promptTokens;
        const activeUsers = Math.max(
          1000,
          Math.round(requests / (5 + hashUnit(`${country.code}-${model.model}-users`) * 11)),
        );
        const avgLatencyMs = Math.round(
          model.latencyMs * multiplier(`${date}-${model.model}-${country.code}-latency`, 0.16),
        );
        const coverage = roundToOne(68 + hashUnit(`${country.code}-${provider.name}-coverage`) * 27);

        return {
          date,
          provider: model.provider,
          providerRegion: provider.region,
          model: model.model,
          modelClass: model.modelClass,
          country: country.name,
          countryCode: country.code,
          region: country.region,
          tokens,
          promptTokens,
          completionTokens,
          requests,
          activeUsers,
          avgLatencyMs,
          coverage,
        };
      });
    });
  });
}

function buildAgentUsage(): AgentUsageRecord[] {
  const baseDailyInvocations = 1_850_000_000;

  return dateRange.flatMap((date, dateIndex) => {
    const calendarDate = new Date(`${date}T00:00:00`);
    const dayOfWeek = calendarDate.getDay();
    const workdayMultiplier = dayOfWeek === 0 || dayOfWeek === 6 ? 0.86 : 1.08;
    const growth = 0.92 + dateIndex * 0.008;

    return agentCategories.flatMap((category) =>
      agentFrameworks.flatMap((framework) =>
        countries.map((country) => {
          const locality = multiplier(`${date}-${category.category}-${framework.framework}-${country.code}`, 0.2);
          const invocations = Math.round(
            baseDailyInvocations *
              category.share *
              framework.share *
              country.weight *
              workdayMultiplier *
              growth *
              locality,
          );
          const successRate = clamp(
            category.successBase + (hashUnit(`${date}-${category.category}-${framework.framework}`) - 0.5) * 0.08,
            0.62,
            0.98,
          );
          const toolCalls = Math.round(
            invocations *
              category.avgTools *
              multiplier(`${date}-${category.category}-${country.code}-tools`, 0.18),
          );
          const avgSteps = roundToOne(
            category.avgSteps * multiplier(`${date}-${framework.framework}-${country.code}-steps`, 0.14),
          );
          const tokens = Math.round(
            invocations *
              category.avgTokens *
              multiplier(`${date}-${category.category}-${framework.framework}-tokens`, 0.2),
          );
          const handoffRate = clamp(
            0.055 + hashUnit(`${country.code}-${category.category}-handoff`) * 0.17,
            0.02,
            0.26,
          );

          return {
            date,
            category: category.category,
            framework: framework.framework,
            country: country.name,
            countryCode: country.code,
            region: country.region,
            invocations,
            completedTasks: Math.round(invocations * successRate),
            toolCalls,
            tokens,
            successRate: roundToOne(successRate * 100),
            avgSteps,
            handoffRate: roundToOne(handoffRate * 100),
          };
        }),
      ),
    );
  });
}

function hashUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function multiplier(key: string, spread: number) {
  return 1 - spread + hashUnit(key) * spread * 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToOne(value: number) {
  return Math.round(value * 10) / 10;
}

function toISODate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
