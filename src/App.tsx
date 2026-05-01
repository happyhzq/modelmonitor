import {
  Activity,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Cpu,
  DatabaseZap,
  Filter,
  Gauge,
  Globe2,
  LineChart,
  Network,
  Server,
  TrendingDown,
  TrendingUp,
  Users,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  agentCategories,
  agentFrameworks,
  agentUsageRecords as fallbackAgentUsageRecords,
  countries,
  dateRange as fallbackDateRange,
  getProviderColor,
  modelUsageRecords as fallbackModelUsageRecords,
  providers,
  sourceReadiness as fallbackSourceReadiness,
  type AgentUsageRecord,
  type ModelUsageRecord,
} from "./data";

type ViewMode = "models" | "agents";
type TrendTone = "up" | "down" | "flat";

type MetricCardProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "green" | "orange" | "purple";
  delta?: number;
};

type AggregateRow = {
  key: string;
  value: number;
  color: string;
  share: number;
};

type SourceReadiness = {
  id?: string;
  label: string;
  value: string;
  status: "ready" | "pending" | "error";
  records?: number;
  message?: string;
};

type TelemetryPayload = {
  generatedAt: string;
  sourceMode: "live" | "sample";
  modelUsageRecords: ModelUsageRecord[];
  agentUsageRecords: AgentUsageRecord[];
  sourceReadiness: SourceReadiness[];
};

type CachedTelemetry = {
  payload: TelemetryPayload;
  signature: string;
  cachedAt: string;
};

const daysOptions = [7, 14, 30];
const otherProviderKey = "其他供应商";
const maxTrendProviders = 8;
const maxProviderShareRows = 10;
const telemetryCacheKey = "modelmonitor.telemetry.v1";
const telemetryCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const fallbackTelemetry: TelemetryPayload = {
  generatedAt: new Date().toISOString(),
  sourceMode: "sample",
  modelUsageRecords: fallbackModelUsageRecords,
  agentUsageRecords: fallbackAgentUsageRecords,
  sourceReadiness: fallbackSourceReadiness.map((item) => ({
    ...item,
    status: item.status as SourceReadiness["status"],
  })),
};
const emptyTelemetry: TelemetryPayload = {
  generatedAt: new Date().toISOString(),
  sourceMode: "live",
  modelUsageRecords: [],
  agentUsageRecords: [],
  sourceReadiness: [],
};

function App() {
  const [initialCache] = useState<CachedTelemetry | undefined>(() => readTelemetryCache());
  const [view, setView] = useState<ViewMode>("models");
  const [days, setDays] = useState(14);
  const [country, setCountry] = useState("all");
  const [modelProvider, setModelProvider] = useState("all");
  const [agentFramework, setAgentFramework] = useState("all");
  const [telemetry, setTelemetry] = useState<TelemetryPayload>(() => initialCache?.payload ?? emptyTelemetry);
  const [isLoading, setIsLoading] = useState(() => !initialCache);
  const [isRefreshing, setIsRefreshing] = useState(() => Boolean(initialCache));
  const [isCacheBacked, setIsCacheBacked] = useState(() => Boolean(initialCache));
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/telemetry?days=90")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return response.json() as Promise<TelemetryPayload>;
      })
      .then((payload) => {
        if (!cancelled) {
          const signature = telemetrySignature(payload);
          if (!initialCache || initialCache.signature !== signature) {
            setTelemetry(payload);
          }
          writeTelemetryCache(payload, signature);
          setApiError(null);
          setIsLoading(false);
          setIsRefreshing(false);
          setIsCacheBacked(false);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          if (!initialCache) {
            setTelemetry(fallbackTelemetry);
          }
          setApiError(error.message);
          setIsLoading(false);
          setIsRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const modelDates = useMemo(
    () => collectDates(telemetry.modelUsageRecords, []),
    [telemetry.modelUsageRecords],
  );
  const agentDates = useMemo(
    () => collectDates([], telemetry.agentUsageRecords),
    [telemetry.agentUsageRecords],
  );
  const viewDates = view === "models" ? modelDates : agentDates;
  const activeDates = useMemo(() => buildContinuousDateWindow(viewDates, days), [viewDates, days]);
  const latestDate = viewDates.at(-1) ?? fallbackDateRange.at(-1) ?? "";
  const previousDate = viewDates.at(-2) ?? latestDate;
  const providerOptions = useMemo(() => {
    const names = new Set([...providers.map((provider) => provider.name), ...telemetry.modelUsageRecords.map((record) => record.provider)]);
    return Array.from(names).filter(Boolean);
  }, [telemetry.modelUsageRecords]);
  const countryOptions = useMemo(() => {
    const names = new Set([
      ...countries.map((item) => item.name),
      ...telemetry.modelUsageRecords.map((record) => record.country),
      ...telemetry.agentUsageRecords.map((record) => record.country),
    ]);
    return Array.from(names).filter((item) => item && item !== "未知");
  }, [telemetry.modelUsageRecords, telemetry.agentUsageRecords]);
  const frameworkOptions = useMemo(() => {
    const names = new Set([
      ...agentFrameworks.map((framework) => framework.framework),
      ...telemetry.agentUsageRecords.map((record) => record.framework),
    ]);
    return Array.from(names).filter(Boolean);
  }, [telemetry.agentUsageRecords]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <Activity size={22} aria-hidden="true" />
          </div>
          <div>
            <h1>AI Model Monitor</h1>
            <p>接入数据源的模型与 Agent 用量监测</p>
          </div>
        </div>

        <nav className="view-switch" aria-label="监控视图">
          <button
            className={view === "models" ? "active" : ""}
            type="button"
            onClick={() => setView("models")}
            title="模型 token 监控"
          >
            <Server size={17} aria-hidden="true" />
            模型
          </button>
          <button
            className={view === "agents" ? "active" : ""}
            type="button"
            onClick={() => setView("agents")}
            title="Agent token 与调用监控"
          >
            <Bot size={17} aria-hidden="true" />
            Agent
          </button>
        </nav>

        <div className="topbar-meta">
          <span className={`status-badge ${isLoading || isRefreshing || apiError ? "warning" : telemetry.sourceMode}`}>
            <DatabaseZap size={15} aria-hidden="true" />
            {statusLabel({ isLoading, isRefreshing, isCacheBacked, apiError, sourceMode: telemetry.sourceMode })}
          </span>
          <span className="last-update">
            <CalendarDays size={15} aria-hidden="true" />
            {latestDate}
          </span>
        </div>
      </header>

      <section className="dashboard">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">{view === "models" ? "Model Tokens" : "Agent Tokens"}</span>
            <h2>{view === "models" ? "AI 模型 token 用量" : "Agent token 与估算调用"}</h2>
          </div>
          <div className="scope-copy">
            <Globe2 size={17} aria-hidden="true" />
            {activeDates[0]} 至 {activeDates[activeDates.length - 1]}
          </div>
        </div>

        <DataScopeBanner telemetry={telemetry} />

        <FilterBar
          view={view}
          days={days}
          country={country}
          modelProvider={modelProvider}
          agentFramework={agentFramework}
          providerOptions={providerOptions}
          countryOptions={countryOptions}
          frameworkOptions={frameworkOptions}
          onDaysChange={setDays}
          onCountryChange={setCountry}
          onModelProviderChange={setModelProvider}
          onAgentFrameworkChange={setAgentFramework}
        />

        {isLoading ? (
          <LoadingDashboard />
        ) : (
          <>
            {view === "models" ? (
              <ModelDashboard
                records={telemetry.modelUsageRecords}
                activeDates={activeDates}
                latestDate={latestDate}
                previousDate={previousDate}
                country={country}
                providerFilter={modelProvider}
              />
            ) : (
              <AgentDashboard
                records={telemetry.agentUsageRecords}
                activeDates={activeDates}
                latestDate={latestDate}
                previousDate={previousDate}
                country={country}
                frameworkFilter={agentFramework}
              />
            )}
          </>
        )}

        <SourceStrip sourceReadiness={telemetry.sourceReadiness} apiError={apiError} />
      </section>
    </main>
  );
}

function LoadingDashboard() {
  return (
    <section className="loading-state" aria-label="数据加载中">
      <DatabaseZap size={22} aria-hidden="true" />
      <strong>正在读取 MySQL 与接入源数据</strong>
      <span>加载完成前不会展示示例遥测，避免刷新时出现数据跳变。</span>
    </section>
  );
}

function statusLabel({
  isLoading,
  isRefreshing,
  isCacheBacked,
  apiError,
  sourceMode,
}: {
  isLoading: boolean;
  isRefreshing: boolean;
  isCacheBacked: boolean;
  apiError: string | null;
  sourceMode: TelemetryPayload["sourceMode"];
}) {
  if (isLoading) {
    return "数据加载中";
  }
  if (isCacheBacked || isRefreshing) {
    return apiError ? "缓存数据" : "缓存数据 · 更新中";
  }
  if (apiError) {
    return "API 未连接";
  }
  return sourceMode === "live" ? "接入源数据" : "示例遥测";
}

function FilterBar({
  view,
  days,
  country,
  modelProvider,
  agentFramework,
  providerOptions,
  countryOptions,
  frameworkOptions,
  onDaysChange,
  onCountryChange,
  onModelProviderChange,
  onAgentFrameworkChange,
}: {
  view: ViewMode;
  days: number;
  country: string;
  modelProvider: string;
  agentFramework: string;
  providerOptions: string[];
  countryOptions: string[];
  frameworkOptions: string[];
  onDaysChange: (value: number) => void;
  onCountryChange: (value: string) => void;
  onModelProviderChange: (value: string) => void;
  onAgentFrameworkChange: (value: string) => void;
}) {
  return (
    <section className="filterbar" aria-label="筛选条件">
      <div className="filter-title">
        <Filter size={16} aria-hidden="true" />
        筛选
      </div>
      <label className="control">
        <span>
          <CalendarDays size={14} aria-hidden="true" />
          天数
        </span>
        <select value={days} onChange={(event) => onDaysChange(Number(event.target.value))}>
          {daysOptions.map((option) => (
            <option key={option} value={option}>
              最近 {option} 天
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span>
          {view === "models" ? <Server size={14} aria-hidden="true" /> : <Workflow size={14} aria-hidden="true" />}
          {view === "models" ? "供应商" : "框架"}
        </span>
        {view === "models" ? (
          <select value={modelProvider} onChange={(event) => onModelProviderChange(event.target.value)}>
            <option value="all">全部供应商</option>
            {providerOptions.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        ) : (
          <select value={agentFramework} onChange={(event) => onAgentFrameworkChange(event.target.value)}>
            <option value="all">全部框架</option>
            {frameworkOptions.map((framework) => (
              <option key={framework} value={framework}>
                {framework}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="control">
        <span>
          <Globe2 size={14} aria-hidden="true" />
          国家
        </span>
        <select value={country} onChange={(event) => onCountryChange(event.target.value)}>
          <option value="all">全部国家</option>
          {countryOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function DataScopeBanner({ telemetry }: { telemetry: TelemetryPayload }) {
  const ignored = new Set(["dedupe", "mysql", "mysql-read", "sample"]);
  const readySources = telemetry.sourceReadiness
    .filter((item) => item.status === "ready" && !ignored.has(item.id ?? "") && (item.records ?? 0) > 0)
    .map((item) => item.label);
  const unknownCountryRows = [...telemetry.modelUsageRecords, ...telemetry.agentUsageRecords].filter(
    (record) => !isKnownCountry(record),
  ).length;
  const estimatedAgentRows = telemetry.agentUsageRecords.filter((record) => record.isEstimate).length;
  const sourceText = readySources.length ? readySources.slice(0, 3).join("、") : "MySQL / 已配置源";

  return (
    <section className="scope-banner" aria-label="数据口径">
      <div>
        <DatabaseZap size={16} aria-hidden="true" />
        <span>接入源口径</span>
        <strong>{telemetry.sourceMode === "sample" ? "示例数据" : sourceText}</strong>
      </div>
      <div>
        <Globe2 size={16} aria-hidden="true" />
        <span>国家拆分</span>
        <strong>{unknownCountryRows ? "未知国家不进入国家榜" : "可按国家拆分"}</strong>
      </div>
      <div>
        <CircleAlert size={16} aria-hidden="true" />
        <span>口径边界</span>
        <strong>{estimatedAgentRows ? "Agent 调用含估算" : "不等同于全球全量"}</strong>
      </div>
    </section>
  );
}

function ModelDashboard({
  records,
  activeDates,
  latestDate,
  previousDate,
  country,
  providerFilter,
}: {
  records: ModelUsageRecord[];
  activeDates: string[];
  latestDate: string;
  previousDate: string;
  country: string;
  providerFilter: string;
}) {
  const filteredRecords = useMemo(
    () =>
      records.filter(
        (record) =>
          activeDates.includes(record.date) &&
          (country === "all" || record.country === country) &&
          (providerFilter === "all" || record.provider === providerFilter),
      ),
    [records, activeDates, country, providerFilter],
  );

  const recordDates = collectRecordDates(filteredRecords);
  const latestRecordDate = recordDates.at(-1) ?? latestDate;
  const previousRecordDate = recordDates.at(-2) ?? previousDate;
  const latestRecords = filteredRecords.filter((record) => record.date === latestRecordDate);
  const previousRecords = filteredRecords.filter((record) => record.date === previousRecordDate);
  const totalTokens = sum(filteredRecords, "tokens");
  const totalRequests = sum(filteredRecords, "requests");
  const totalActiveUsers = sum(filteredRecords, "activeUsers");
  const latestTokens = sum(latestRecords, "tokens");
  const previousTokens = sum(previousRecords, "tokens");
  const dailyDelta = delta(latestTokens, previousTokens);
  const avgCoverage = weightedAverage(filteredRecords, "coverage", "tokens");
  const avgLatency = weightedAverage(filteredRecords, "avgLatencyMs", "requests");
  const modelCount = new Set(filteredRecords.map((record) => record.model)).size;

  const timeSeries = useMemo(
    () => buildModelTimeSeries(filteredRecords, activeDates, providerFilter),
    [filteredRecords, activeDates, providerFilter],
  );
  const providerRows = useMemo(() => aggregateModelProviders(filteredRecords, totalTokens), [filteredRecords, totalTokens]);
  const countryRows = useMemo(() => aggregateCountries(filteredRecords, "tokens", totalTokens), [filteredRecords, totalTokens]);
  const modelRows = useMemo(
    () => aggregateModelRows(filteredRecords, totalTokens, latestRecordDate, previousRecordDate),
    [filteredRecords, totalTokens, latestRecordDate, previousRecordDate],
  );
  const tokenMix = [
    { name: "Prompt", value: sum(filteredRecords, "promptTokens"), color: "#2563eb" },
    { name: "Completion", value: sum(filteredRecords, "completionTokens"), color: "#f59e0b" },
  ];

  return (
    <>
      <section className="metric-grid">
        <MetricCard
          icon={DatabaseZap}
          label="总 token"
          value={formatTokens(totalTokens)}
          detail={`${latestRecordDate} ${formatTokens(latestTokens)}`}
          tone="blue"
          delta={dailyDelta}
        />
        <MetricCard
          icon={Network}
          label="请求量"
          value={formatCompact(totalRequests)}
          detail={`${modelCount} 个模型系列`}
          tone="green"
        />
        <MetricCard
          icon={Users}
          label="活跃用户"
          value={formatCompact(totalActiveUsers)}
          detail={`覆盖率 ${formatPercent(avgCoverage / 100)}`}
          tone="orange"
        />
        <MetricCard
          icon={Gauge}
          label="平均延迟"
          value={`${Math.round(avgLatency)} ms`}
          detail="按请求量加权"
          tone="purple"
        />
      </section>

      <section className="content-grid primary-grid">
        <Panel
          title="每日 token 趋势"
          icon={LineChart}
          action={<span className="panel-note">按供应商堆叠</span>}
        >
          <div className="chart-frame tall">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 10, right: 22, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
                <YAxis tickFormatter={(value) => formatAxisTokens(Number(value))} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value, name) => [formatTokens(Number(value)), name]}
                  labelFormatter={(label) => `日期 ${label}`}
                  contentStyle={tooltipStyle}
                />
                <Legend />
                {timeSeries.keys.map((key) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="tokens"
                    stroke={getProviderColor(key)}
                    fill={getProviderColor(key)}
                    fillOpacity={0.24}
                    strokeWidth={2}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Prompt / Completion" icon={Cpu} action={<span className="panel-note">token 构成</span>}>
          <div className="chart-frame compact">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip formatter={(value) => formatTokens(Number(value))} contentStyle={tooltipStyle} />
                <Pie
                  data={tokenMix}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={92}
                  paddingAngle={3}
                >
                  {tokenMix.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="split-stats">
            {tokenMix.map((item) => (
              <div key={item.name} className="split-stat">
                <span className="swatch" style={{ background: item.color }} />
                <strong>{formatTokens(item.value)}</strong>
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="content-grid secondary-grid">
        <Panel title="供应商份额" icon={BarChart3} action={<span className="panel-note">总 token</span>}>
          <HorizontalBarChart rows={providerRows} valueFormatter={formatTokens} />
        </Panel>
        <Panel title="已知国家拆分" icon={Globe2} action={<span className="panel-note">前 12</span>}>
          <CountryGrid rows={countryRows.slice(0, 12)} valueFormatter={formatTokens} />
        </Panel>
      </section>

      <Panel title="模型明细" icon={Server} action={<span className="panel-note">按总 token 排序</span>}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>供应商</th>
                <th>总 token</th>
                <th>请求量</th>
                <th>国家数</th>
                <th>份额</th>
                <th>日变化</th>
              </tr>
            </thead>
            <tbody>
              {modelRows.map((row) => (
                <tr key={row.model}>
                  <td>
                    <div className="entity-cell">
                      <span className="swatch" style={{ background: getProviderColor(row.provider) }} />
                      <div>
                        <strong>{row.model}</strong>
                        <span>{row.modelClass}</span>
                      </div>
                    </div>
                  </td>
                  <td>{row.provider}</td>
                  <td>{formatTokens(row.tokens)}</td>
                  <td>{formatCompact(row.requests)}</td>
                  <td>{row.countries}</td>
                  <td>{formatPercent(row.share)}</td>
                  <td>
                    <TrendChip value={row.trend} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function AgentDashboard({
  records,
  activeDates,
  latestDate,
  previousDate,
  country,
  frameworkFilter,
}: {
  records: AgentUsageRecord[];
  activeDates: string[];
  latestDate: string;
  previousDate: string;
  country: string;
  frameworkFilter: string;
}) {
  const filteredRecords = useMemo(
    () =>
      records.filter(
        (record) =>
          activeDates.includes(record.date) &&
          (country === "all" || record.country === country) &&
          (frameworkFilter === "all" || record.framework === frameworkFilter),
      ),
    [records, activeDates, country, frameworkFilter],
  );

  const recordDates = collectRecordDates(filteredRecords);
  const latestRecordDate = recordDates.at(-1) ?? latestDate;
  const previousRecordDate = recordDates.at(-2) ?? previousDate;
  const latestRecords = filteredRecords.filter((record) => record.date === latestRecordDate);
  const previousRecords = filteredRecords.filter((record) => record.date === previousRecordDate);
  const totalInvocations = sum(filteredRecords, "invocations");
  const latestInvocations = sum(latestRecords, "invocations");
  const previousInvocations = sum(previousRecords, "invocations");
  const totalToolCalls = sum(filteredRecords, "toolCalls");
  const totalTokens = sum(filteredRecords, "tokens");
  const avgSuccess = weightedAverage(filteredRecords, "successRate", "invocations");
  const avgSteps = weightedAverage(filteredRecords, "avgSteps", "invocations");
  const dailyDelta = delta(latestInvocations, previousInvocations);
  const hasEstimatedRecords = filteredRecords.some((record) => record.isEstimate);

  const timeSeries = useMemo(
    () => buildAgentTimeSeries(filteredRecords, activeDates),
    [filteredRecords, activeDates],
  );
  const frameworkRows = useMemo(
    () => aggregateAgentFrameworks(filteredRecords, totalInvocations),
    [filteredRecords, totalInvocations],
  );
  const countryRows = useMemo(
    () => aggregateCountries(filteredRecords, "invocations", totalInvocations),
    [filteredRecords, totalInvocations],
  );
  const categoryRows = useMemo(
    () => aggregateAgentCategories(filteredRecords, totalInvocations),
    [filteredRecords, totalInvocations],
  );

  return (
    <>
      <section className="metric-grid">
        <MetricCard
          icon={Bot}
          label="估算调用"
          value={formatCompact(totalInvocations)}
          detail={hasEstimatedRecords ? "公开 token 按 8k/次折算" : `${latestRecordDate} ${formatCompact(latestInvocations)}`}
          tone="blue"
          delta={dailyDelta}
        />
        <MetricCard
          icon={Workflow}
          label="工具调用"
          value={formatCompact(totalToolCalls)}
          detail={totalToolCalls ? `${formatRatio(totalToolCalls, totalInvocations)} 次 / 调用` : "公开源未披露"}
          tone="green"
        />
        <MetricCard
          icon={CheckCircle2}
          label="成功率"
          value={formatPercent(avgSuccess / 100)}
          detail={hasEstimatedRecords ? "公开源未披露真实成功率" : `平均 ${avgSteps.toFixed(1)} 步`}
          tone="orange"
        />
        <MetricCard
          icon={DatabaseZap}
          label="Agent token"
          value={formatTokens(totalTokens)}
          detail="Agent/App 上下文 token"
          tone="purple"
        />
      </section>

      <section className="content-grid primary-grid">
        <Panel title="每日估算调用趋势" icon={LineChart} action={<span className="panel-note">按类型堆叠</span>}>
          <div className="chart-frame tall">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 10, right: 22, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
                <YAxis tickFormatter={(value) => formatAxisCompact(Number(value))} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value, name) => [formatCompact(Number(value)), name]}
                  labelFormatter={(label) => `日期 ${label}`}
                  contentStyle={tooltipStyle}
                />
                <Legend />
                {timeSeries.keys.map((key) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="calls"
                    stroke={categoryColor(key)}
                    fill={categoryColor(key)}
                    fillOpacity={0.24}
                    strokeWidth={2}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="框架份额" icon={Workflow} action={<span className="panel-note">估算调用</span>}>
          <HorizontalBarChart rows={frameworkRows} valueFormatter={formatCompact} />
        </Panel>
      </section>

      <section className="content-grid secondary-grid">
        <Panel title="Agent 已知国家拆分" icon={Globe2} action={<span className="panel-note">前 12</span>}>
          <CountryGrid rows={countryRows.slice(0, 12)} valueFormatter={formatCompact} />
        </Panel>
        <Panel title="类型效率" icon={Gauge} action={<span className="panel-note">成功率 / 步数</span>}>
          <div className="agent-matrix">
            {categoryRows.slice(0, 7).map((row) => (
              <div key={row.category} className="agent-matrix-row">
                <div>
                  <strong>{row.category}</strong>
                  <span>{formatCompact(row.invocations)} 估算调用</span>
                </div>
                <div className="matrix-values">
                  <span>{formatPercent(row.successRate)}</span>
                  <span>{row.avgSteps.toFixed(1)} 步</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel title="Agent 明细" icon={Bot} action={<span className="panel-note">按估算调用排序</span>}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>类型</th>
                <th>主框架</th>
                <th>估算调用</th>
                <th>完成任务</th>
                <th>工具调用</th>
                <th>成功率</th>
                <th>Handoff</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.map((row) => (
                <tr key={row.category}>
                  <td>
                    <div className="entity-cell">
                      <span className="swatch" style={{ background: categoryColor(row.category) }} />
                      <div>
                        <strong>{row.category}</strong>
                        <span>{formatTokens(row.tokens)}</span>
                      </div>
                    </div>
                  </td>
                  <td>{row.topFramework}</td>
                  <td>{formatCompact(row.invocations)}</td>
                  <td>{formatCompact(row.completedTasks)}</td>
                  <td>{formatCompact(row.toolCalls)}</td>
                  <td>{formatPercent(row.successRate)}</td>
                  <td>{formatPercent(row.handoffRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone, delta: deltaValue }: MetricCardProps) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">
        <Icon size={19} aria-hidden="true" />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
      {typeof deltaValue === "number" && <TrendChip value={deltaValue} compact />}
    </article>
  );
}

function Panel({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>
          <Icon size={17} aria-hidden="true" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function HorizontalBarChart({
  rows,
  valueFormatter,
}: {
  rows: AggregateRow[];
  valueFormatter: (value: number) => string;
}) {
  return (
    <div className="chart-frame medium">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 6, right: 18, left: 6, bottom: 6 }}>
          <CartesianGrid stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" hide />
          <YAxis dataKey="key" type="category" width={112} tickLine={false} axisLine={false} />
          <Tooltip formatter={(value) => valueFormatter(Number(value))} contentStyle={tooltipStyle} />
          <Bar dataKey="value" radius={[0, 5, 5, 0]}>
            {rows.map((row) => (
              <Cell key={row.key} fill={row.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CountryGrid({
  rows,
  valueFormatter,
}: {
  rows: AggregateRow[];
  valueFormatter: (value: number) => string;
}) {
  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  if (!rows.length) {
    return <EmptyState message="当前接入源没有可用国家字段，国家榜已隐藏未知国家。" />;
  }

  return (
    <div className="country-grid">
      {rows.map((row) => (
        <div key={row.key} className="country-cell">
          <div className="country-topline">
            <strong>{row.key}</strong>
            <span>{formatPercent(row.share)}</span>
          </div>
          <p>{valueFormatter(row.value)}</p>
          <div className="meter" aria-hidden="true">
            <span
              style={{
                width: `${Math.max(5, (row.value / maxValue) * 100)}%`,
                background: row.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}

function TrendChip({ value, compact = false }: { value: number; compact?: boolean }) {
  const tone = trendTone(value);
  const Icon = tone === "up" ? TrendingUp : tone === "down" ? TrendingDown : CircleAlert;

  return (
    <span className={`trend-chip ${tone} ${compact ? "compact" : ""}`}>
      <Icon size={14} aria-hidden="true" />
      {value >= 0 ? "+" : ""}
      {formatPercent(value)}
    </span>
  );
}

function SourceStrip({
  sourceReadiness,
  apiError,
}: {
  sourceReadiness: SourceReadiness[];
  apiError: string | null;
}) {
  return (
    <section className="source-strip" aria-label="数据源状态">
      {apiError && (
        <div className="source-item error">
          <span>前端 API</span>
          <strong>未连接</strong>
          <em>{apiError}</em>
        </div>
      )}
      {sourceReadiness.map((item) => (
        <div key={item.id ?? item.label} className={`source-item ${item.status}`}>
          <span>{item.label}</span>
          <strong>{item.records ? `${item.value} · ${formatCompact(item.records)} 条` : item.value}</strong>
          {item.message && <em>{item.message}</em>}
        </div>
      ))}
    </section>
  );
}

function buildModelTimeSeries(records: ModelUsageRecord[], dates: string[], providerFilter: string) {
  const keys = topProviderKeys(records, providerFilter, maxTrendProviders);

  const rows = dates.map((date) => {
    const row: Record<string, string | number> = {
      date,
      label: formatDateLabel(date),
    };

    keys.forEach((key) => {
      const rowRecords =
        key === otherProviderKey
          ? records.filter((record) => record.date === date && !keys.includes(record.provider))
          : records.filter((record) => record.date === date && record.provider === key);
      row[key] = sum(rowRecords, "tokens");
    });

    return row;
  });

  return Object.assign(rows, { keys });
}

function buildAgentTimeSeries(records: AgentUsageRecord[], dates: string[]) {
  const keys = agentCategories.map((category) => category.category);
  const rows = dates.map((date) => {
    const row: Record<string, string | number> = {
      date,
      label: formatDateLabel(date),
    };

    keys.forEach((key) => {
      row[key] = sum(
        records.filter((record) => record.date === date && record.category === key),
        "invocations",
      );
    });

    return row;
  });

  return Object.assign(rows, { keys });
}

function aggregateModelProviders(records: ModelUsageRecord[], total: number): AggregateRow[] {
  const providerNames = Array.from(new Set([...providers.map((provider) => provider.name), ...records.map((record) => record.provider)]));

  const rows = providerNames
    .map((provider) => {
      const value = sum(
        records.filter((record) => record.provider === provider),
        "tokens",
      );
      return {
        key: provider,
        value,
        color: getProviderColor(provider),
        share: total ? value / total : 0,
      };
    })
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value);

  return compactRows(rows, maxProviderShareRows, otherProviderKey, total);
}

function aggregateAgentFrameworks(records: AgentUsageRecord[], total: number): AggregateRow[] {
  return agentFrameworks
    .map((framework) => {
      const value = sum(
        records.filter((record) => record.framework === framework.framework),
        "invocations",
      );
      return {
        key: framework.framework,
        value,
        color: framework.color,
        share: total ? value / total : 0,
      };
    })
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value);
}

function topProviderKeys(records: ModelUsageRecord[], providerFilter: string, limit: number) {
  if (providerFilter !== "all") {
    return [providerFilter];
  }

  const totals = new Map<string, number>();
  records.forEach((record) => {
    totals.set(record.provider, (totals.get(record.provider) ?? 0) + record.tokens);
  });

  const topKeys = Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([provider]) => provider);

  const hasOther = Array.from(totals.keys()).some((provider) => !topKeys.includes(provider));
  return hasOther ? [...topKeys, otherProviderKey] : topKeys;
}

function compactRows(rows: AggregateRow[], limit: number, otherLabel: string, total: number) {
  if (rows.length <= limit) {
    return rows;
  }

  const visible = rows.slice(0, limit);
  const hidden = rows.slice(limit);
  const otherValue = hidden.reduce((accumulator, row) => accumulator + row.value, 0);

  if (!otherValue) {
    return visible;
  }

  return [
    ...visible,
    {
      key: otherLabel,
      value: otherValue,
      color: "#64748b",
      share: total ? otherValue / total : 0,
    },
  ];
}

function aggregateCountries<T extends ModelUsageRecord | AgentUsageRecord>(
  records: T[],
  metric: T extends ModelUsageRecord ? "tokens" : "invocations",
  total: number,
): AggregateRow[] {
  const rows = new Map<
    string,
    {
      key: string;
      value: number;
      color: string;
    }
  >();

  records.filter(isKnownCountry).forEach((record) => {
    const key = `${record.countryCode} ${record.country}`;
    const existing =
      rows.get(key) ??
      {
        key,
        value: 0,
        color: countryPalette[rows.size % countryPalette.length],
      };
    existing.value += Number(record[metric as keyof T]);
    rows.set(key, existing);
  });

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      share: total ? row.value / total : 0,
    }))
    .sort((left, right) => right.value - left.value);
}

function isKnownCountry(record: Pick<ModelUsageRecord | AgentUsageRecord, "country" | "countryCode">) {
  return record.country !== "未知" && record.countryCode !== "ZZ";
}

function readTelemetryCache(): CachedTelemetry | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawValue = window.localStorage.getItem(telemetryCacheKey);
    if (!rawValue) {
      return undefined;
    }

    const cached = JSON.parse(rawValue) as Partial<CachedTelemetry>;
    if (!cached.payload || !isTelemetryPayload(cached.payload) || !cached.cachedAt || !cached.signature) {
      return undefined;
    }

    const cachedAt = Date.parse(cached.cachedAt);
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > telemetryCacheMaxAgeMs) {
      window.localStorage.removeItem(telemetryCacheKey);
      return undefined;
    }

    return {
      payload: cached.payload,
      signature: cached.signature,
      cachedAt: cached.cachedAt,
    };
  } catch {
    return undefined;
  }
}

function writeTelemetryCache(payload: TelemetryPayload, signature = telemetrySignature(payload)) {
  if (typeof window === "undefined" || payload.sourceMode !== "live" || !hasTelemetryRows(payload)) {
    return;
  }

  try {
    const cached: CachedTelemetry = {
      payload,
      signature,
      cachedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(telemetryCacheKey, JSON.stringify(cached));
  } catch {
    // Storage can be unavailable or full; live API data still renders normally.
  }
}

function isTelemetryPayload(value: unknown): value is TelemetryPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as TelemetryPayload;
  return (
    typeof payload.generatedAt === "string" &&
    (payload.sourceMode === "live" || payload.sourceMode === "sample") &&
    Array.isArray(payload.modelUsageRecords) &&
    Array.isArray(payload.agentUsageRecords) &&
    Array.isArray(payload.sourceReadiness)
  );
}

function hasTelemetryRows(payload: TelemetryPayload) {
  return payload.modelUsageRecords.length > 0 || payload.agentUsageRecords.length > 0;
}

function telemetrySignature(payload: TelemetryPayload) {
  return hashString(
    JSON.stringify({
      sourceMode: payload.sourceMode,
      models: payload.modelUsageRecords.map((record) => [
        record.date,
        record.provider,
        record.model,
        record.countryCode,
        record.tokens,
        record.promptTokens,
        record.completionTokens,
        record.requests,
        record.activeUsers,
        record.avgLatencyMs,
        record.coverage,
      ]),
      agents: payload.agentUsageRecords.map((record) => [
        record.date,
        record.framework,
        record.category,
        record.countryCode,
        record.invocations,
        record.completedTasks,
        record.toolCalls,
        record.tokens,
        record.successRate,
        record.avgSteps,
        record.handoffRate,
      ]),
    }),
  );
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function collectDates(modelRecords: ModelUsageRecord[], agentRecords: AgentUsageRecord[]) {
  const dates = Array.from(
    new Set([...modelRecords.map((record) => record.date), ...agentRecords.map((record) => record.date)]),
  )
    .filter(Boolean)
    .sort();

  return dates.length ? dates : fallbackDateRange;
}

function buildContinuousDateWindow(dates: string[], days: number) {
  const endDate = dates.at(-1) ?? fallbackDateRange.at(-1);
  if (!endDate) {
    return [];
  }

  return Array.from({ length: Math.max(1, days) }, (_, index) => shiftDate(endDate, index - days + 1));
}

function shiftDate(date: string, offset: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function collectRecordDates(records: Array<ModelUsageRecord | AgentUsageRecord>) {
  return Array.from(new Set(records.map((record) => record.date))).filter(Boolean).sort();
}

function aggregateModelRows(records: ModelUsageRecord[], total: number, latestDate: string, previousDate: string) {
  const rows = new Map<
    string,
    {
      model: string;
      modelClass: string;
      provider: string;
      tokens: number;
      requests: number;
      countries: Set<string>;
      latestTokens: number;
      previousTokens: number;
    }
  >();

  records.forEach((record) => {
    const current =
      rows.get(record.model) ??
      {
        model: record.model,
        modelClass: record.modelClass,
        provider: record.provider,
        tokens: 0,
        requests: 0,
        countries: new Set<string>(),
        latestTokens: 0,
        previousTokens: 0,
      };

    current.tokens += record.tokens;
    current.requests += record.requests;
    if (isKnownCountry(record)) {
      current.countries.add(record.country);
    }

    if (record.date === latestDate) {
      current.latestTokens += record.tokens;
    }
    if (record.date === previousDate) {
      current.previousTokens += record.tokens;
    }

    rows.set(record.model, current);
  });

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      countries: row.countries.size,
      share: total ? row.tokens / total : 0,
      trend: delta(row.latestTokens, row.previousTokens),
    }))
    .sort((left, right) => right.tokens - left.tokens);
}

function aggregateAgentCategories(records: AgentUsageRecord[], total: number) {
  const rows = new Map<
    string,
    {
      category: string;
      invocations: number;
      completedTasks: number;
      toolCalls: number;
      tokens: number;
      weightedSuccess: number;
      weightedSteps: number;
      weightedHandoff: number;
      frameworks: Map<string, number>;
    }
  >();

  records.forEach((record) => {
    const current =
      rows.get(record.category) ??
      {
        category: record.category,
        invocations: 0,
        completedTasks: 0,
        toolCalls: 0,
        tokens: 0,
        weightedSuccess: 0,
        weightedSteps: 0,
        weightedHandoff: 0,
        frameworks: new Map<string, number>(),
      };

    current.invocations += record.invocations;
    current.completedTasks += record.completedTasks;
    current.toolCalls += record.toolCalls;
    current.tokens += record.tokens;
    current.weightedSuccess += record.successRate * record.invocations;
    current.weightedSteps += record.avgSteps * record.invocations;
    current.weightedHandoff += record.handoffRate * record.invocations;
    current.frameworks.set(record.framework, (current.frameworks.get(record.framework) ?? 0) + record.invocations);
    rows.set(record.category, current);
  });

  return Array.from(rows.values())
    .map((row) => ({
      category: row.category,
      invocations: row.invocations,
      completedTasks: row.completedTasks,
      toolCalls: row.toolCalls,
      tokens: row.tokens,
      share: total ? row.invocations / total : 0,
      successRate: row.invocations ? row.weightedSuccess / row.invocations / 100 : 0,
      avgSteps: row.invocations ? row.weightedSteps / row.invocations : 0,
      handoffRate: row.invocations ? row.weightedHandoff / row.invocations / 100 : 0,
      topFramework: topMapKey(row.frameworks),
    }))
    .sort((left, right) => right.invocations - left.invocations);
}

function sum<T extends Record<string, unknown>>(records: T[], key: keyof T) {
  return records.reduce((accumulator, record) => accumulator + Number(record[key] ?? 0), 0);
}

function weightedAverage<T extends Record<string, unknown>>(records: T[], valueKey: keyof T, weightKey: keyof T) {
  const weight = sum(records, weightKey);
  if (!weight) {
    return 0;
  }

  return records.reduce((accumulator, record) => {
    return accumulator + Number(record[valueKey] ?? 0) * Number(record[weightKey] ?? 0);
  }, 0) / weight;
}

function delta(current: number, previous: number) {
  if (!previous) {
    return 0;
  }

  return (current - previous) / previous;
}

function topMapKey(map: Map<string, number>) {
  return Array.from(map.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "-";
}

function categoryColor(category: string) {
  const index = agentCategories.findIndex((item) => item.category === category);
  return categoryPalette[index >= 0 ? index % categoryPalette.length : 0];
}

function trendTone(value: number): TrendTone {
  if (value > 0.004) {
    return "up";
  }
  if (value < -0.004) {
    return "down";
  }
  return "flat";
}

function formatTokens(value: number) {
  if (value >= 1_000_000_000_000) {
    return `${trimNumber(value / 1_000_000_000_000)} 万亿`;
  }
  if (value >= 1_000_000_000) {
    return `${trimNumber(value / 1_000_000_000)} 十亿`;
  }
  if (value >= 1_000_000) {
    return `${trimNumber(value / 1_000_000)} 百万`;
  }
  return formatCompact(value);
}

function formatAxisTokens(value: number) {
  if (value >= 1_000_000_000_000) {
    return `${trimNumber(value / 1_000_000_000_000)}万亿`;
  }
  if (value >= 1_000_000_000) {
    return `${trimNumber(value / 1_000_000_000)}十亿`;
  }
  return formatAxisCompact(value);
}

function formatAxisCompact(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(Math.abs(value) < 0.1 ? 1 : 0)}%`;
}

function formatRatio(numerator: number, denominator: number) {
  if (!denominator) {
    return "0";
  }

  return (numerator / denominator).toFixed(1);
}

function formatDateLabel(date: string) {
  return date.slice(5).replace("-", "/");
}

function trimNumber(value: number) {
  return value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

const tooltipStyle = {
  border: "1px solid #d9dee8",
  borderRadius: 8,
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.13)",
};

const categoryPalette = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#dc2626", "#0891b2", "#be123c"];
const countryPalette = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#0f766e",
  "#c2410c",
  "#4f46e5",
  "#be123c",
  "#047857",
  "#b45309",
];

export default App;
