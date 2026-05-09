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
  Languages,
  LineChart,
  LockKeyhole,
  LogOut,
  Network,
  Server,
  TrendingDown,
  TrendingUp,
  UserCog,
  Users,
  Workflow,
  X,
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
type Language = "zh" | "en" | "es" | "ja" | "ko" | "yue";
type UserTier = "free" | "pro" | "enterprise";

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
  access?: UserAccess;
  viewer?: {
    username: string;
    role: AuthUser["role"];
    tier: UserTier;
    subscriptionStatus: string;
  };
};

type CachedTelemetry = {
  payload: TelemetryPayload;
  signature: string;
  cachedAt: string;
};

type AuthUser = {
  id: number;
  username: string;
  email?: string;
  role: "admin" | "viewer";
  tier: UserTier;
  subscriptionStatus: string;
};

type UserAccess = {
  maxDays: number;
  canViewModels: boolean;
  canViewAgents: boolean;
  canViewCountries: boolean;
  canViewDetails: boolean;
  canViewSources: boolean;
  maxRowsPerDate: number | null;
};

type AuthPayload = {
  token?: string;
  user: AuthUser;
  access: UserAccess;
};

const daysOptions = [7, 14, 30, 90];
const otherProviderKey = "其他供应商";
const maxTrendProviders = 8;
const maxProviderShareRows = 10;
const telemetryCacheKey = "modelmonitor.telemetry.v1";
const authTokenKey = "modelmonitor.authToken.v1";
const languageKey = "modelmonitor.language.v1";
const telemetryCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const languageOptions: Array<{ value: Language; label: string }> = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "yue", label: "粵語" },
];
const translations = {
  zh: {
    language: "语言",
    loginTitle: "登录 Model Monitor",
    loginSubtitle: "使用账号进入分级数据看板。首个注册用户自动成为企业管理员。",
    login: "登录",
    register: "注册",
    username: "用户名",
    usernameOrEmail: "用户名或邮箱",
    email: "邮箱",
    password: "密码",
    createAccount: "创建账号",
    switchToLogin: "已有账号，去登录",
    switchToRegister: "没有账号，注册",
    authHelp: "免费用户查看 7 天模型概览；Pro 用户查看 30 天模型与 Agent；Enterprise 用户查看 90 天全量与数据源状态。",
    logout: "退出",
    signIn: "登录 / 注册",
    guestUser: "游客",
    adminUsers: "用户管理",
    save: "保存",
    close: "关闭",
    tier: "会员等级",
    role: "角色",
    subscription: "订阅状态",
    dashboardSubtitle: "接入数据源的模型与 Agent 用量监测",
    navLabel: "监控视图",
    models: "模型",
    agents: "Agent",
    modelTitle: "AI 模型 token 用量",
    agentTitle: "Agent token 与估算调用",
    modelEyebrow: "Model Tokens",
    agentEyebrow: "Agent Tokens",
    to: "至",
    locked: "当前会员等级不可用",
    upgradeAgents: "Agent 页面需要 Pro 或 Enterprise 权限。",
    filters: "筛选",
    days: "天数",
    recentDays: (days: number) => `最近 ${days} 天`,
    provider: "供应商",
    framework: "框架",
    country: "国家",
    allProviders: "全部供应商",
    allFrameworks: "全部框架",
    allCountries: "全部国家",
    loadingTitle: "正在读取 MySQL 与接入源数据",
    loadingBody: "加载完成前不会展示示例遥测，避免刷新时出现数据跳变。",
    liveData: "接入源数据",
    sampleData: "示例遥测",
    loading: "数据加载中",
    cache: "缓存数据",
    cacheUpdating: "缓存数据 · 更新中",
    apiOffline: "API 未连接",
    sourceScope: "接入源口径",
    countrySplit: "国家拆分",
    boundary: "口径边界",
    countriesAvailable: "可按国家拆分",
    countriesLocked: "国家拆分需 Pro 或 Enterprise",
    unknownCountryHidden: "未知国家不进入国家榜",
    agentEstimated: "Agent 调用含估算",
    notGlobalTotal: "不等同于全球全量",
    totalTokens: "总 token",
    requests: "请求量",
    activeUsers: "活跃用户",
    avgLatency: "平均延迟",
    coverage: "覆盖率",
    weightedByRequests: "按请求量加权",
    modelSeries: (count: number) => `${count} 个模型系列`,
    dailyTokenTrend: "每日 token 趋势",
    stackedByProvider: "按供应商堆叠",
    tokenMix: "token 构成",
    providerShare: "供应商份额",
    knownCountrySplit: "已知国家拆分",
    top12: "前 12",
    totalTokenNote: "总 token",
    modelDetails: "模型明细",
    sortedByTokens: "按总 token 排序",
    model: "模型",
    tokenTotal: "总 token",
    countries: "国家数",
    share: "份额",
    dailyChange: "日变化",
    estimatedCalls: "估算调用",
    publicTokenRatio: "公开 token 按 8k/次折算",
    toolCalls: "工具调用",
    successRate: "成功率",
    agentToken: "Agent token",
    undisclosedPublicSource: "公开源未披露",
    undisclosedSuccess: "公开源未披露真实成功率",
    averageSteps: (steps: string) => `平均 ${steps} 步`,
    agentContextToken: "Agent/App 上下文 token",
    dailyAgentTrend: "每日估算调用趋势",
    stackedByType: "按类型堆叠",
    frameworkShare: "框架份额",
    agentCountrySplit: "Agent 已知国家拆分",
    typeEfficiency: "类型效率",
    successSteps: "成功率 / 步数",
    estimatedCallUnit: "估算调用",
    steps: "步",
    agentDetails: "Agent 明细",
    sortedByEstimatedCalls: "按估算调用排序",
    type: "类型",
    mainFramework: "主框架",
    completedTasks: "完成任务",
    noCountryData: "当前权限或接入源没有可用国家字段，国家榜已隐藏。",
    apiFrontend: "前端 API",
    disconnected: "未连接",
    date: "日期",
    rows: "条",
    planFree: "Free",
    planPro: "Pro",
    planEnterprise: "Enterprise",
  },
  en: {
    language: "Language",
    loginTitle: "Sign in to Model Monitor",
    loginSubtitle: "Use an account to enter the tiered telemetry dashboard. The first registered user becomes the enterprise admin.",
    login: "Sign in",
    register: "Register",
    username: "Username",
    usernameOrEmail: "Username or email",
    email: "Email",
    password: "Password",
    createAccount: "Create account",
    switchToLogin: "Already have an account",
    switchToRegister: "Create an account",
    authHelp: "Free sees 7 days of model overview; Pro sees 30 days of models and agents; Enterprise sees 90 days plus source status.",
    logout: "Log out",
    signIn: "Sign in / register",
    guestUser: "Guest",
    adminUsers: "Users",
    save: "Save",
    close: "Close",
    tier: "Tier",
    role: "Role",
    subscription: "Subscription",
    dashboardSubtitle: "Model and agent usage monitoring from connected data sources",
    navLabel: "Monitor view",
    models: "Models",
    agents: "Agents",
    modelTitle: "AI model token usage",
    agentTitle: "Agent tokens and estimated calls",
    modelEyebrow: "Model Tokens",
    agentEyebrow: "Agent Tokens",
    to: "to",
    locked: "Locked for this tier",
    upgradeAgents: "Agent view requires Pro or Enterprise.",
    filters: "Filters",
    days: "Days",
    recentDays: (days: number) => `Last ${days} days`,
    provider: "Provider",
    framework: "Framework",
    country: "Country",
    allProviders: "All providers",
    allFrameworks: "All frameworks",
    allCountries: "All countries",
    loadingTitle: "Reading MySQL and source telemetry",
    loadingBody: "Sample telemetry is hidden while loading to avoid refresh-time jumps.",
    liveData: "Connected data",
    sampleData: "Sample telemetry",
    loading: "Loading",
    cache: "Cached data",
    cacheUpdating: "Cached data · updating",
    apiOffline: "API offline",
    sourceScope: "Source scope",
    countrySplit: "Country split",
    boundary: "Boundary",
    countriesAvailable: "Country split available",
    countriesLocked: "Country split requires Pro or Enterprise",
    unknownCountryHidden: "Unknown countries are hidden",
    agentEstimated: "Agent calls include estimates",
    notGlobalTotal: "Not global all-provider total",
    totalTokens: "Total tokens",
    requests: "Requests",
    activeUsers: "Active users",
    avgLatency: "Avg latency",
    coverage: "Coverage",
    weightedByRequests: "Weighted by requests",
    modelSeries: (count: number) => `${count} model series`,
    dailyTokenTrend: "Daily token trend",
    stackedByProvider: "Stacked by provider",
    tokenMix: "Token mix",
    providerShare: "Provider share",
    knownCountrySplit: "Known country split",
    top12: "Top 12",
    totalTokenNote: "Total tokens",
    modelDetails: "Model details",
    sortedByTokens: "Sorted by total tokens",
    model: "Model",
    tokenTotal: "Total tokens",
    countries: "Countries",
    share: "Share",
    dailyChange: "Daily change",
    estimatedCalls: "Estimated calls",
    publicTokenRatio: "Public tokens converted at 8k/call",
    toolCalls: "Tool calls",
    successRate: "Success rate",
    agentToken: "Agent tokens",
    undisclosedPublicSource: "Not disclosed by public source",
    undisclosedSuccess: "Public source does not disclose true success rate",
    averageSteps: (steps: string) => `Average ${steps} steps`,
    agentContextToken: "Agent/App context tokens",
    dailyAgentTrend: "Daily estimated call trend",
    stackedByType: "Stacked by type",
    frameworkShare: "Framework share",
    agentCountrySplit: "Agent known country split",
    typeEfficiency: "Type efficiency",
    successSteps: "Success / steps",
    estimatedCallUnit: "estimated calls",
    steps: "steps",
    agentDetails: "Agent details",
    sortedByEstimatedCalls: "Sorted by estimated calls",
    type: "Type",
    mainFramework: "Main framework",
    completedTasks: "Completed tasks",
    noCountryData: "No country fields are available for this tier or source.",
    apiFrontend: "Frontend API",
    disconnected: "Disconnected",
    date: "Date",
    rows: "rows",
    planFree: "Free",
    planPro: "Pro",
    planEnterprise: "Enterprise",
  },
  es: {
    language: "Idioma",
    loginTitle: "Iniciar sesion en Model Monitor",
    loginSubtitle: "Usa una cuenta para entrar al panel con niveles. El primer usuario registrado sera administrador enterprise.",
    login: "Iniciar sesion",
    register: "Registrarse",
    username: "Usuario",
    usernameOrEmail: "Usuario o email",
    email: "Email",
    password: "Contrasena",
    createAccount: "Crear cuenta",
    switchToLogin: "Ya tengo cuenta",
    switchToRegister: "Crear una cuenta",
    authHelp: "Free ve 7 dias de modelos; Pro ve 30 dias de modelos y agentes; Enterprise ve 90 dias y estados de fuentes.",
    logout: "Salir",
    signIn: "Iniciar sesion / registrarse",
    guestUser: "Invitado",
    adminUsers: "Usuarios",
    save: "Guardar",
    close: "Cerrar",
    tier: "Nivel",
    role: "Rol",
    subscription: "Suscripcion",
    dashboardSubtitle: "Monitor de uso de modelos y agentes desde fuentes conectadas",
    navLabel: "Vista de monitoreo",
    models: "Modelos",
    agents: "Agentes",
    modelTitle: "Uso de tokens de modelos AI",
    agentTitle: "Tokens de agentes y llamadas estimadas",
    modelEyebrow: "Tokens de modelos",
    agentEyebrow: "Tokens de agentes",
    to: "a",
    locked: "Bloqueado para este nivel",
    upgradeAgents: "La vista de agentes requiere Pro o Enterprise.",
    filters: "Filtros",
    days: "Dias",
    recentDays: (days: number) => `Ultimos ${days} dias`,
    provider: "Proveedor",
    framework: "Framework",
    country: "Pais",
    allProviders: "Todos los proveedores",
    allFrameworks: "Todos los frameworks",
    allCountries: "Todos los paises",
    loadingTitle: "Leyendo MySQL y fuentes",
    loadingBody: "No se muestra telemetria de ejemplo durante la carga para evitar saltos al refrescar.",
    liveData: "Datos conectados",
    sampleData: "Telemetria de ejemplo",
    loading: "Cargando",
    cache: "Datos en cache",
    cacheUpdating: "Cache · actualizando",
    apiOffline: "API desconectada",
    sourceScope: "Alcance de fuente",
    countrySplit: "Division por pais",
    boundary: "Limite",
    countriesAvailable: "Division por pais disponible",
    countriesLocked: "La division por pais requiere Pro o Enterprise",
    unknownCountryHidden: "Paises desconocidos ocultos",
    agentEstimated: "Llamadas de agentes estimadas",
    notGlobalTotal: "No es total global completo",
    totalTokens: "Tokens totales",
    requests: "Solicitudes",
    activeUsers: "Usuarios activos",
    avgLatency: "Latencia media",
    coverage: "Cobertura",
    weightedByRequests: "Ponderado por solicitudes",
    modelSeries: (count: number) => `${count} series de modelos`,
    dailyTokenTrend: "Tendencia diaria de tokens",
    stackedByProvider: "Apilado por proveedor",
    tokenMix: "Mezcla de tokens",
    providerShare: "Cuota por proveedor",
    knownCountrySplit: "Paises conocidos",
    top12: "Top 12",
    totalTokenNote: "Tokens totales",
    modelDetails: "Detalle de modelos",
    sortedByTokens: "Ordenado por tokens",
    model: "Modelo",
    tokenTotal: "Tokens totales",
    countries: "Paises",
    share: "Cuota",
    dailyChange: "Cambio diario",
    estimatedCalls: "Llamadas estimadas",
    publicTokenRatio: "Tokens publicos convertidos a 8k/llamada",
    toolCalls: "Llamadas a herramientas",
    successRate: "Tasa de exito",
    agentToken: "Tokens de agentes",
    undisclosedPublicSource: "No divulgado por la fuente publica",
    undisclosedSuccess: "La fuente publica no divulga exito real",
    averageSteps: (steps: string) => `Media ${steps} pasos`,
    agentContextToken: "Tokens de contexto Agent/App",
    dailyAgentTrend: "Tendencia diaria de llamadas estimadas",
    stackedByType: "Apilado por tipo",
    frameworkShare: "Cuota por framework",
    agentCountrySplit: "Paises conocidos de agentes",
    typeEfficiency: "Eficiencia por tipo",
    successSteps: "Exito / pasos",
    estimatedCallUnit: "llamadas estimadas",
    steps: "pasos",
    agentDetails: "Detalle de agentes",
    sortedByEstimatedCalls: "Ordenado por llamadas estimadas",
    type: "Tipo",
    mainFramework: "Framework principal",
    completedTasks: "Tareas completadas",
    noCountryData: "No hay campos de pais disponibles para este nivel o fuente.",
    apiFrontend: "API frontend",
    disconnected: "Desconectado",
    date: "Fecha",
    rows: "filas",
    planFree: "Free",
    planPro: "Pro",
    planEnterprise: "Enterprise",
  },
  ja: {
    language: "言語",
    loginTitle: "Model Monitor にログイン",
    loginSubtitle: "アカウントで階層別データダッシュボードに入ります。最初の登録ユーザーは自動的に Enterprise 管理者になります。",
    login: "ログイン",
    register: "登録",
    username: "ユーザー名",
    usernameOrEmail: "ユーザー名またはメール",
    email: "メール",
    password: "パスワード",
    createAccount: "アカウント作成",
    switchToLogin: "アカウントをお持ちの方",
    switchToRegister: "アカウントを作成",
    authHelp: "Free は直近 7 日のモデル概要、Pro は 30 日のモデルと Agent、Enterprise は 90 日の全量とデータソース状態を表示します。",
    logout: "ログアウト",
    signIn: "ログイン / 登録",
    guestUser: "ゲスト",
    adminUsers: "ユーザー管理",
    save: "保存",
    close: "閉じる",
    tier: "プラン",
    role: "権限",
    subscription: "購読状態",
    dashboardSubtitle: "接続データソースによるモデルと Agent の利用監視",
    navLabel: "監視ビュー",
    models: "モデル",
    agents: "Agent",
    modelTitle: "AI モデル token 使用量",
    agentTitle: "Agent token と推定呼び出し",
    modelEyebrow: "Model Tokens",
    agentEyebrow: "Agent Tokens",
    to: "から",
    locked: "現在のプランでは利用できません",
    upgradeAgents: "Agent ビューには Pro または Enterprise 権限が必要です。",
    filters: "フィルター",
    days: "日数",
    recentDays: (days: number) => `直近 ${days} 日`,
    provider: "プロバイダー",
    framework: "フレームワーク",
    country: "国",
    allProviders: "すべてのプロバイダー",
    allFrameworks: "すべてのフレームワーク",
    allCountries: "すべての国",
    loadingTitle: "MySQL と接続ソースを読み込み中",
    loadingBody: "読み込み中はサンプルテレメトリを表示せず、更新時の表示揺れを防ぎます。",
    liveData: "接続データ",
    sampleData: "サンプルテレメトリ",
    loading: "読み込み中",
    cache: "キャッシュデータ",
    cacheUpdating: "キャッシュデータ · 更新中",
    apiOffline: "API 未接続",
    sourceScope: "ソース範囲",
    countrySplit: "国別内訳",
    boundary: "集計範囲",
    countriesAvailable: "国別内訳を利用可能",
    countriesLocked: "国別内訳には Pro または Enterprise が必要",
    unknownCountryHidden: "不明な国は国ランキングから除外",
    agentEstimated: "Agent 呼び出しには推定値を含む",
    notGlobalTotal: "世界全体の完全な総量ではありません",
    totalTokens: "総 token",
    requests: "リクエスト",
    activeUsers: "アクティブユーザー",
    avgLatency: "平均レイテンシ",
    coverage: "カバレッジ",
    weightedByRequests: "リクエスト数で加重",
    modelSeries: (count: number) => `${count} モデル系列`,
    dailyTokenTrend: "日次 token トレンド",
    stackedByProvider: "プロバイダー別積み上げ",
    tokenMix: "token 構成",
    providerShare: "プロバイダーシェア",
    knownCountrySplit: "判明している国別内訳",
    top12: "上位 12",
    totalTokenNote: "総 token",
    modelDetails: "モデル詳細",
    sortedByTokens: "総 token 順",
    model: "モデル",
    tokenTotal: "総 token",
    countries: "国数",
    share: "シェア",
    dailyChange: "日次変化",
    estimatedCalls: "推定呼び出し",
    publicTokenRatio: "公開 token を 8k/回で換算",
    toolCalls: "ツール呼び出し",
    successRate: "成功率",
    agentToken: "Agent token",
    undisclosedPublicSource: "公開ソースでは非開示",
    undisclosedSuccess: "公開ソースは実際の成功率を開示していません",
    averageSteps: (steps: string) => `平均 ${steps} ステップ`,
    agentContextToken: "Agent/App コンテキスト token",
    dailyAgentTrend: "日次推定呼び出しトレンド",
    stackedByType: "タイプ別積み上げ",
    frameworkShare: "フレームワークシェア",
    agentCountrySplit: "Agent の判明国別内訳",
    typeEfficiency: "タイプ別効率",
    successSteps: "成功率 / ステップ",
    estimatedCallUnit: "推定呼び出し",
    steps: "ステップ",
    agentDetails: "Agent 詳細",
    sortedByEstimatedCalls: "推定呼び出し順",
    type: "タイプ",
    mainFramework: "主要フレームワーク",
    completedTasks: "完了タスク",
    noCountryData: "現在の権限またはソースには利用可能な国フィールドがありません。",
    apiFrontend: "フロントエンド API",
    disconnected: "未接続",
    date: "日付",
    rows: "件",
    planFree: "Free",
    planPro: "Pro",
    planEnterprise: "Enterprise",
  },
  ko: {
    language: "언어",
    loginTitle: "Model Monitor 로그인",
    loginSubtitle: "계정으로 등급별 데이터 대시보드에 들어갑니다. 첫 등록 사용자는 자동으로 Enterprise 관리자가 됩니다.",
    login: "로그인",
    register: "가입",
    username: "사용자 이름",
    usernameOrEmail: "사용자 이름 또는 이메일",
    email: "이메일",
    password: "비밀번호",
    createAccount: "계정 만들기",
    switchToLogin: "이미 계정이 있음",
    switchToRegister: "계정 만들기",
    authHelp: "Free는 최근 7일 모델 개요, Pro는 30일 모델과 Agent, Enterprise는 90일 전체 데이터와 소스 상태를 볼 수 있습니다.",
    logout: "로그아웃",
    signIn: "로그인 / 가입",
    guestUser: "게스트",
    adminUsers: "사용자 관리",
    save: "저장",
    close: "닫기",
    tier: "등급",
    role: "역할",
    subscription: "구독 상태",
    dashboardSubtitle: "연결된 데이터 소스 기반 모델 및 Agent 사용량 모니터링",
    navLabel: "모니터링 보기",
    models: "모델",
    agents: "Agent",
    modelTitle: "AI 모델 token 사용량",
    agentTitle: "Agent token 및 추정 호출",
    modelEyebrow: "Model Tokens",
    agentEyebrow: "Agent Tokens",
    to: "부터",
    locked: "현재 등급에서 사용할 수 없음",
    upgradeAgents: "Agent 보기는 Pro 또는 Enterprise 권한이 필요합니다.",
    filters: "필터",
    days: "일수",
    recentDays: (days: number) => `최근 ${days}일`,
    provider: "공급사",
    framework: "프레임워크",
    country: "국가",
    allProviders: "전체 공급사",
    allFrameworks: "전체 프레임워크",
    allCountries: "전체 국가",
    loadingTitle: "MySQL 및 연결 소스 데이터 읽는 중",
    loadingBody: "새로고침 시 데이터가 튀는 것을 막기 위해 로딩 중에는 샘플 텔레메트리를 표시하지 않습니다.",
    liveData: "연결 데이터",
    sampleData: "샘플 텔레메트리",
    loading: "로딩 중",
    cache: "캐시 데이터",
    cacheUpdating: "캐시 데이터 · 업데이트 중",
    apiOffline: "API 연결 안 됨",
    sourceScope: "소스 범위",
    countrySplit: "국가별 분해",
    boundary: "집계 경계",
    countriesAvailable: "국가별 분해 가능",
    countriesLocked: "국가별 분해는 Pro 또는 Enterprise 필요",
    unknownCountryHidden: "알 수 없는 국가는 국가 순위에서 제외",
    agentEstimated: "Agent 호출에는 추정치 포함",
    notGlobalTotal: "전 세계 전체 총량과 같지 않음",
    totalTokens: "총 token",
    requests: "요청 수",
    activeUsers: "활성 사용자",
    avgLatency: "평균 지연",
    coverage: "커버리지",
    weightedByRequests: "요청 수 기준 가중",
    modelSeries: (count: number) => `${count}개 모델 시리즈`,
    dailyTokenTrend: "일별 token 추세",
    stackedByProvider: "공급사별 누적",
    tokenMix: "token 구성",
    providerShare: "공급사 점유율",
    knownCountrySplit: "확인된 국가별 분해",
    top12: "상위 12",
    totalTokenNote: "총 token",
    modelDetails: "모델 상세",
    sortedByTokens: "총 token 순",
    model: "모델",
    tokenTotal: "총 token",
    countries: "국가 수",
    share: "점유율",
    dailyChange: "일별 변화",
    estimatedCalls: "추정 호출",
    publicTokenRatio: "공개 token을 8k/회로 환산",
    toolCalls: "도구 호출",
    successRate: "성공률",
    agentToken: "Agent token",
    undisclosedPublicSource: "공개 소스에서 미공개",
    undisclosedSuccess: "공개 소스는 실제 성공률을 공개하지 않음",
    averageSteps: (steps: string) => `평균 ${steps} 단계`,
    agentContextToken: "Agent/App 컨텍스트 token",
    dailyAgentTrend: "일별 추정 호출 추세",
    stackedByType: "유형별 누적",
    frameworkShare: "프레임워크 점유율",
    agentCountrySplit: "Agent 확인 국가별 분해",
    typeEfficiency: "유형별 효율",
    successSteps: "성공률 / 단계",
    estimatedCallUnit: "추정 호출",
    steps: "단계",
    agentDetails: "Agent 상세",
    sortedByEstimatedCalls: "추정 호출 순",
    type: "유형",
    mainFramework: "주요 프레임워크",
    completedTasks: "완료 작업",
    noCountryData: "현재 권한 또는 소스에 사용 가능한 국가 필드가 없습니다.",
    apiFrontend: "프런트엔드 API",
    disconnected: "연결 끊김",
    date: "날짜",
    rows: "건",
    planFree: "Free",
    planPro: "Pro",
    planEnterprise: "Enterprise",
  },
  yue: {
    language: "語言",
    loginTitle: "登入 Model Monitor",
    loginSubtitle: "用帳號進入分級數據看板。第一個註冊用戶會自動成為 Enterprise 管理員。",
    login: "登入",
    register: "註冊",
    username: "用戶名",
    usernameOrEmail: "用戶名或電郵",
    email: "電郵",
    password: "密碼",
    createAccount: "開帳號",
    switchToLogin: "已有帳號，去登入",
    switchToRegister: "未有帳號，去註冊",
    authHelp: "Free 可睇最近 7 日模型概覽；Pro 可睇 30 日模型同 Agent；Enterprise 可睇 90 日全量同數據源狀態。",
    logout: "登出",
    signIn: "登入 / 註冊",
    guestUser: "訪客",
    adminUsers: "用戶管理",
    save: "儲存",
    close: "關閉",
    tier: "會員級別",
    role: "角色",
    subscription: "訂閱狀態",
    dashboardSubtitle: "接入數據源嘅模型同 Agent 用量監測",
    navLabel: "監控視圖",
    models: "模型",
    agents: "Agent",
    modelTitle: "AI 模型 token 用量",
    agentTitle: "Agent token 同估算調用",
    modelEyebrow: "Model Tokens",
    agentEyebrow: "Agent Tokens",
    to: "至",
    locked: "目前會員級別未開放",
    upgradeAgents: "Agent 頁面需要 Pro 或 Enterprise 權限。",
    filters: "篩選",
    days: "天數",
    recentDays: (days: number) => `最近 ${days} 日`,
    provider: "供應商",
    framework: "框架",
    country: "國家",
    allProviders: "全部供應商",
    allFrameworks: "全部框架",
    allCountries: "全部國家",
    loadingTitle: "讀緊 MySQL 同接入源數據",
    loadingBody: "載入完成前唔顯示示例遙測，避免刷新時數據跳動。",
    liveData: "接入源數據",
    sampleData: "示例遙測",
    loading: "載入中",
    cache: "快取數據",
    cacheUpdating: "快取數據 · 更新中",
    apiOffline: "API 未連接",
    sourceScope: "接入源口徑",
    countrySplit: "國家拆分",
    boundary: "口徑邊界",
    countriesAvailable: "可按國家拆分",
    countriesLocked: "國家拆分需要 Pro 或 Enterprise",
    unknownCountryHidden: "未知國家唔入國家榜",
    agentEstimated: "Agent 調用包含估算",
    notGlobalTotal: "唔等於全球全量",
    totalTokens: "總 token",
    requests: "請求量",
    activeUsers: "活躍用戶",
    avgLatency: "平均延遲",
    coverage: "覆蓋率",
    weightedByRequests: "按請求量加權",
    modelSeries: (count: number) => `${count} 個模型系列`,
    dailyTokenTrend: "每日 token 趨勢",
    stackedByProvider: "按供應商堆疊",
    tokenMix: "token 構成",
    providerShare: "供應商份額",
    knownCountrySplit: "已知國家拆分",
    top12: "前 12",
    totalTokenNote: "總 token",
    modelDetails: "模型明細",
    sortedByTokens: "按總 token 排序",
    model: "模型",
    tokenTotal: "總 token",
    countries: "國家數",
    share: "份額",
    dailyChange: "日變化",
    estimatedCalls: "估算調用",
    publicTokenRatio: "公開 token 按 8k/次折算",
    toolCalls: "工具調用",
    successRate: "成功率",
    agentToken: "Agent token",
    undisclosedPublicSource: "公開源未披露",
    undisclosedSuccess: "公開源未披露真實成功率",
    averageSteps: (steps: string) => `平均 ${steps} 步`,
    agentContextToken: "Agent/App 上下文 token",
    dailyAgentTrend: "每日估算調用趨勢",
    stackedByType: "按類型堆疊",
    frameworkShare: "框架份額",
    agentCountrySplit: "Agent 已知國家拆分",
    typeEfficiency: "類型效率",
    successSteps: "成功率 / 步數",
    estimatedCallUnit: "估算調用",
    steps: "步",
    agentDetails: "Agent 明細",
    sortedByEstimatedCalls: "按估算調用排序",
    type: "類型",
    mainFramework: "主框架",
    completedTasks: "完成任務",
    noCountryData: "目前權限或接入源冇可用國家欄位，國家榜已隱藏。",
    apiFrontend: "前端 API",
    disconnected: "未連接",
    date: "日期",
    rows: "條",
    planFree: "Free",
    planPro: "Pro",
    planEnterprise: "Enterprise",
  },
};

type Copy = (typeof translations)["zh"];

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
const guestAccess: UserAccess = {
  maxDays: 7,
  canViewModels: true,
  canViewAgents: false,
  canViewCountries: false,
  canViewDetails: false,
  canViewSources: false,
  maxRowsPerDate: 20,
};
const guestUser: AuthUser = {
  id: 0,
  username: "guest",
  role: "viewer",
  tier: "free",
  subscriptionStatus: "guest",
};

function App() {
  const [language, setLanguageState] = useState<Language>(() => readLanguage());
  const text = translations[language];
  const [authToken, setAuthToken] = useState(() => readAuthToken());
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [view, setView] = useState<ViewMode>("models");
  const [days, setDays] = useState(14);
  const [country, setCountry] = useState("all");
  const [modelProvider, setModelProvider] = useState("all");
  const [agentFramework, setAgentFramework] = useState("all");
  const [telemetry, setTelemetry] = useState<TelemetryPayload>(emptyTelemetry);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCacheBacked, setIsCacheBacked] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!authToken) {
      setAuthUser(guestUser);
      setAccess(guestAccess);
      setAuthError(null);
      setAuthChecked(true);
      return () => {
        cancelled = true;
      };
    }

    fetch("/api/auth/me", {
      headers: authHeaders(authToken),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return response.json() as Promise<{ user: AuthUser; access: UserAccess }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setAuthUser(payload.user);
          setAccess(payload.access);
          setAuthError(null);
          setAuthChecked(true);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          clearAuthToken();
          setAuthToken("");
          setAuthUser(guestUser);
          setAccess(guestAccess);
          setAuthError(error.message);
          setAuthChecked(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!access) {
      return;
    }

    if (days > access.maxDays) {
      setDays(access.maxDays);
    }
    if (!access.canViewAgents && view === "agents") {
      setView("models");
    }
    if (!access.canViewCountries && country !== "all") {
      setCountry("all");
    }
  }, [access, country, days, view]);

  useEffect(() => {
    let cancelled = false;

    if (!authUser || !access) {
      return () => {
        cancelled = true;
      };
    }

    const cachedTelemetry = readTelemetryCache(authUser);
    if (cachedTelemetry) {
      setTelemetry(cachedTelemetry.payload);
      setIsLoading(false);
      setIsRefreshing(true);
      setIsCacheBacked(true);
    } else {
      setTelemetry(emptyTelemetry);
      setIsLoading(true);
      setIsRefreshing(false);
      setIsCacheBacked(false);
    }

    fetch(`/api/telemetry?days=${access.maxDays}`, authToken ? { headers: authHeaders(authToken) } : undefined)
      .then((response) => {
        if (response.status === 401) {
          clearAuthToken();
          setAuthToken("");
          setAuthUser(guestUser);
          setAccess(guestAccess);
        }
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return response.json() as Promise<TelemetryPayload>;
      })
      .then((payload) => {
        if (!cancelled) {
          const signature = telemetrySignature(payload);
          if (!cachedTelemetry || cachedTelemetry.signature !== signature) {
            setTelemetry(payload);
          }
          writeTelemetryCache(authUser, payload, signature);
          setApiError(null);
          setIsLoading(false);
          setIsRefreshing(false);
          setIsCacheBacked(false);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          if (!cachedTelemetry) {
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
  }, [access, authToken, authUser]);

  const setLanguage = (value: Language) => {
    setLanguageState(value);
    window.localStorage.setItem(languageKey, value);
  };

  const handleAuth = async (mode: "login" | "register", values: Record<string, string>) => {
    setAuthError(null);
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const payload =
      mode === "login"
        ? { identifier: values.identifier, password: values.password }
        : { username: values.username, email: values.email, password: values.password };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as Partial<AuthPayload> & { message?: string };

    if (!response.ok || !body.token || !body.user || !body.access) {
      throw new Error(body.message || `${response.status} ${response.statusText}`);
    }

    writeAuthToken(body.token);
    setAuthToken(body.token);
    setAuthUser(body.user);
    setAccess(body.access);
    setAuthError(null);
    setShowAuth(false);
  };

  const handleLogout = async () => {
    if (authToken) {
      await fetch("/api/auth/logout", { method: "POST", headers: authHeaders(authToken) }).catch(() => undefined);
    }
    clearAuthToken();
    setAuthToken("");
    setAuthUser(guestUser);
    setAccess(guestAccess);
    setTelemetry(emptyTelemetry);
  };
  const visibleTelemetry = useMemo(
    () => (authUser && access ? restrictTelemetryForAccess(telemetry, authUser, access, text) : telemetry),
    [access, authUser, telemetry, text],
  );

  const modelDates = useMemo(
    () => collectDates(visibleTelemetry.modelUsageRecords, []),
    [visibleTelemetry.modelUsageRecords],
  );
  const agentDates = useMemo(
    () => collectDates([], visibleTelemetry.agentUsageRecords),
    [visibleTelemetry.agentUsageRecords],
  );
  const viewDates = view === "models" ? modelDates : agentDates;
  const activeDates = useMemo(() => buildContinuousDateWindow(viewDates, days), [viewDates, days]);
  const latestDate = viewDates.at(-1) ?? fallbackDateRange.at(-1) ?? "";
  const previousDate = viewDates.at(-2) ?? latestDate;
  const providerOptions = useMemo(() => {
    const names = new Set([...providers.map((provider) => provider.name), ...visibleTelemetry.modelUsageRecords.map((record) => record.provider)]);
    return Array.from(names).filter(Boolean);
  }, [visibleTelemetry.modelUsageRecords]);
  const countryOptions = useMemo(() => {
    const names = new Set([
      ...countries.map((item) => item.name),
      ...visibleTelemetry.modelUsageRecords.map((record) => record.country),
      ...visibleTelemetry.agentUsageRecords.map((record) => record.country),
    ]);
    return Array.from(names).filter((item) => item && item !== "未知");
  }, [visibleTelemetry.modelUsageRecords, visibleTelemetry.agentUsageRecords]);
  const frameworkOptions = useMemo(() => {
    const names = new Set([
      ...agentFrameworks.map((framework) => framework.framework),
      ...visibleTelemetry.agentUsageRecords.map((record) => record.framework),
    ]);
    return Array.from(names).filter(Boolean);
  }, [visibleTelemetry.agentUsageRecords]);

  if (!authChecked) {
    return (
      <main className="app-shell">
        <LoadingDashboard text={text} />
      </main>
    );
  }

  if (!authUser || !access) {
    return (
      <AuthScreen
        text={text}
        language={language}
        authError={authError}
        onLanguageChange={setLanguage}
        onSubmit={handleAuth}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <Activity size={22} aria-hidden="true" />
          </div>
          <div>
            <h1>AI Model Monitor</h1>
            <p>{text.dashboardSubtitle}</p>
          </div>
        </div>

        <nav className="view-switch" aria-label={text.navLabel}>
          <button
            className={view === "models" ? "active" : ""}
            type="button"
            onClick={() => setView("models")}
            title={text.modelTitle}
          >
            <Server size={17} aria-hidden="true" />
            {text.models}
          </button>
          <button
            className={view === "agents" ? "active" : ""}
            type="button"
            onClick={() => setView("agents")}
            disabled={!access.canViewAgents}
            title={access.canViewAgents ? text.agentTitle : text.upgradeAgents}
          >
            <Bot size={17} aria-hidden="true" />
            {text.agents}
          </button>
        </nav>

        <div className="topbar-meta">
          <label className="language-select">
            <Languages size={15} aria-hidden="true" />
            <select value={language} aria-label={text.language} onChange={(event) => setLanguage(event.target.value as Language)}>
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <span className="status-badge live">
            <UserCog size={15} aria-hidden="true" />
            {userDisplayName(authUser, text)} · {tierLabel(authUser.tier, text)}
          </span>
          {authToken && authUser.role === "admin" && (
            <button className="icon-action" type="button" onClick={() => setShowAdmin(true)} title={text.adminUsers}>
              <UserCog size={16} aria-hidden="true" />
            </button>
          )}
          <span className={`status-badge ${isLoading || isRefreshing || apiError ? "warning" : visibleTelemetry.sourceMode}`}>
            <DatabaseZap size={15} aria-hidden="true" />
            {statusLabel({ isLoading, isRefreshing, isCacheBacked, apiError, sourceMode: visibleTelemetry.sourceMode }, text)}
          </span>
          <span className="last-update">
            <CalendarDays size={15} aria-hidden="true" />
            {latestDate}
          </span>
          {authToken ? (
            <button className="icon-action" type="button" onClick={handleLogout} title={text.logout}>
              <LogOut size={16} aria-hidden="true" />
            </button>
          ) : (
            <button className="topbar-action" type="button" onClick={() => setShowAuth(true)}>
              <LockKeyhole size={15} aria-hidden="true" />
              {text.signIn}
            </button>
          )}
        </div>
      </header>

      <section className="dashboard">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">{view === "models" ? text.modelEyebrow : text.agentEyebrow}</span>
            <h2>{view === "models" ? text.modelTitle : text.agentTitle}</h2>
          </div>
          <div className="scope-copy">
            <Globe2 size={17} aria-hidden="true" />
            {activeDates[0]} {text.to} {activeDates[activeDates.length - 1]}
          </div>
        </div>

        <DataScopeBanner telemetry={visibleTelemetry} access={access} text={text} />

        <FilterBar
          view={view}
          days={days}
          country={country}
          modelProvider={modelProvider}
          agentFramework={agentFramework}
          providerOptions={providerOptions}
          countryOptions={countryOptions}
          frameworkOptions={frameworkOptions}
          access={access}
          text={text}
          onDaysChange={setDays}
          onCountryChange={setCountry}
          onModelProviderChange={setModelProvider}
          onAgentFrameworkChange={setAgentFramework}
        />

        {isLoading ? (
          <LoadingDashboard text={text} />
        ) : view === "agents" && !access.canViewAgents ? (
          <LockedPanel text={text} message={text.upgradeAgents} />
        ) : (
          <>
            {view === "models" ? (
              <ModelDashboard
                records={visibleTelemetry.modelUsageRecords}
                activeDates={activeDates}
                latestDate={latestDate}
                previousDate={previousDate}
                country={country}
                providerFilter={modelProvider}
                canViewDetails={access.canViewDetails}
                text={text}
              />
            ) : (
              <AgentDashboard
                records={visibleTelemetry.agentUsageRecords}
                activeDates={activeDates}
                latestDate={latestDate}
                previousDate={previousDate}
                country={country}
                frameworkFilter={agentFramework}
                canViewDetails={access.canViewDetails}
                text={text}
              />
            )}
          </>
        )}

        <SourceStrip sourceReadiness={visibleTelemetry.sourceReadiness} apiError={apiError} text={text} />
      </section>
      {showAdmin && authUser.role === "admin" && (
        <AdminUsersPanel text={text} token={authToken} onClose={() => setShowAdmin(false)} />
      )}
      {showAuth && (
        <div className="modal-backdrop">
          <AuthScreen
            text={text}
            language={language}
            authError={authError}
            embedded
            onClose={() => setShowAuth(false)}
            onLanguageChange={setLanguage}
            onSubmit={handleAuth}
          />
        </div>
      )}
    </main>
  );
}

function AuthScreen({
  text,
  language,
  authError,
  embedded = false,
  onClose,
  onLanguageChange,
  onSubmit,
}: {
  text: Copy;
  language: Language;
  authError: string | null;
  embedded?: boolean;
  onClose?: () => void;
  onLanguageChange: (language: Language) => void;
  onSubmit: (mode: "login" | "register", values: Record<string, string>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [values, setValues] = useState({ identifier: "", username: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(authError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setError(authError);
  }, [authError]);

  const updateValue = (key: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const card = (
    <section className={`auth-card ${embedded ? "embedded" : ""}`}>
        <div className="auth-topline">
          <div className="brand-mark">
            <Activity size={22} aria-hidden="true" />
          </div>
          <label className="language-select">
            <Languages size={15} aria-hidden="true" />
            <select value={language} aria-label={text.language} onChange={(event) => onLanguageChange(event.target.value as Language)}>
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {onClose && (
            <button className="icon-action" type="button" onClick={onClose} title={text.close}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <div>
          <span className="eyebrow">AI Model Monitor</span>
          <h1>{text.loginTitle}</h1>
          <p>{text.loginSubtitle}</p>
        </div>

        <div className="auth-tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            {text.login}
          </button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            {text.register}
          </button>
        </div>

        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setIsSubmitting(true);
            setError(null);
            try {
              await onSubmit(mode, values);
            } catch (submitError) {
              setError(submitError instanceof Error ? submitError.message : String(submitError));
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          {mode === "login" ? (
            <label>
              <span>{text.usernameOrEmail}</span>
              <input
                value={values.identifier}
                autoComplete="username"
                onChange={(event) => updateValue("identifier", event.target.value)}
                required
              />
            </label>
          ) : (
            <>
              <label>
                <span>{text.username}</span>
                <input
                  value={values.username}
                  autoComplete="username"
                  onChange={(event) => updateValue("username", event.target.value)}
                  required
                />
              </label>
              <label>
                <span>{text.email}</span>
                <input
                  value={values.email}
                  type="email"
                  autoComplete="email"
                  onChange={(event) => updateValue("email", event.target.value)}
                />
              </label>
            </>
          )}
          <label>
            <span>{text.password}</span>
            <input
              value={values.password}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              onChange={(event) => updateValue("password", event.target.value)}
              required
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary-action" type="submit" disabled={isSubmitting}>
            <LockKeyhole size={16} aria-hidden="true" />
            {mode === "login" ? text.login : text.createAccount}
          </button>
        </form>

        <p className="auth-help">{text.authHelp}</p>
        <button className="text-action" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? text.switchToRegister : text.switchToLogin}
        </button>
      </section>
  );

  return embedded ? card : <main className="auth-shell">{card}</main>;
}

function LockedPanel({ text, message }: { text: Copy; message: string }) {
  return (
    <section className="locked-panel">
      <LockKeyhole size={22} aria-hidden="true" />
      <strong>{text.locked}</strong>
      <span>{message}</span>
    </section>
  );
}

function AdminUsersPanel({ text, token, onClose }: { text: Copy; token: string; onClose: () => void }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/users", { headers: authHeaders(token) })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return response.json() as Promise<{ users: AuthUser[] }>;
      })
      .then((payload) => setUsers(payload.users))
      .catch((loadError: Error) => setError(loadError.message));
  }, [token]);

  const updateUser = async (user: AuthUser, patch: Partial<AuthUser>) => {
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({
        tier: patch.tier ?? user.tier,
        role: patch.role ?? user.role,
        subscriptionStatus: patch.subscriptionStatus ?? user.subscriptionStatus,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { user?: AuthUser; message?: string };
    if (!response.ok || !body.user) {
      throw new Error(body.message || `${response.status} ${response.statusText}`);
    }
    setUsers((current) => current.map((item) => (item.id === body.user?.id ? body.user : item)));
  };

  return (
    <div className="modal-backdrop">
      <section className="admin-panel">
        <div className="panel-header">
          <h3>
            <UserCog size={17} aria-hidden="true" />
            {text.adminUsers}
          </h3>
          <button className="text-action" type="button" onClick={onClose}>
            {text.close}
          </button>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{text.username}</th>
                <th>{text.email}</th>
                <th>{text.tier}</th>
                <th>{text.role}</th>
                <th>{text.subscription}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.email ?? "-"}</td>
                  <td>
                    <select value={user.tier} onChange={(event) => updateUser(user, { tier: event.target.value as UserTier })}>
                      <option value="free">{text.planFree}</option>
                      <option value="pro">{text.planPro}</option>
                      <option value="enterprise">{text.planEnterprise}</option>
                    </select>
                  </td>
                  <td>
                    <select value={user.role} onChange={(event) => updateUser(user, { role: event.target.value as AuthUser["role"] })}>
                      <option value="viewer">viewer</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>{user.subscriptionStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LoadingDashboard({ text }: { text: Copy }) {
  return (
    <section className="loading-state" aria-label={text.loading}>
      <DatabaseZap size={22} aria-hidden="true" />
      <strong>{text.loadingTitle}</strong>
      <span>{text.loadingBody}</span>
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
}, text: Copy) {
  if (isLoading) {
    return text.loading;
  }
  if (isCacheBacked || isRefreshing) {
    return apiError ? text.cache : text.cacheUpdating;
  }
  if (apiError) {
    return text.apiOffline;
  }
  return sourceMode === "live" ? text.liveData : text.sampleData;
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
  access,
  text,
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
  access: UserAccess;
  text: Copy;
  onDaysChange: (value: number) => void;
  onCountryChange: (value: string) => void;
  onModelProviderChange: (value: string) => void;
  onAgentFrameworkChange: (value: string) => void;
}) {
  return (
    <section className="filterbar" aria-label={text.filters}>
      <div className="filter-title">
        <Filter size={16} aria-hidden="true" />
        {text.filters}
      </div>
      <label className="control">
        <span>
          <CalendarDays size={14} aria-hidden="true" />
          {text.days}
        </span>
        <select value={days} onChange={(event) => onDaysChange(Number(event.target.value))}>
          {daysOptions.filter((option) => option <= access.maxDays).map((option) => (
            <option key={option} value={option}>
              {text.recentDays(option)}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span>
          {view === "models" ? <Server size={14} aria-hidden="true" /> : <Workflow size={14} aria-hidden="true" />}
          {view === "models" ? text.provider : text.framework}
        </span>
        {view === "models" ? (
          <select value={modelProvider} onChange={(event) => onModelProviderChange(event.target.value)}>
            <option value="all">{text.allProviders}</option>
            {providerOptions.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        ) : (
          <select value={agentFramework} onChange={(event) => onAgentFrameworkChange(event.target.value)}>
            <option value="all">{text.allFrameworks}</option>
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
          {text.country}
        </span>
        <select value={country} disabled={!access.canViewCountries} onChange={(event) => onCountryChange(event.target.value)}>
          <option value="all">{access.canViewCountries ? text.allCountries : text.countriesLocked}</option>
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

function DataScopeBanner({ telemetry, access, text }: { telemetry: TelemetryPayload; access: UserAccess; text: Copy }) {
  const ignored = new Set(["dedupe", "mysql", "mysql-read", "sample"]);
  const accessSource = telemetry.sourceReadiness.find((item) => item.id === "access");
  const readySources = telemetry.sourceReadiness
    .filter((item) => item.status === "ready" && !ignored.has(item.id ?? "") && (item.records ?? 0) > 0)
    .map((item) => item.label);
  const unknownCountryRows = [...telemetry.modelUsageRecords, ...telemetry.agentUsageRecords].filter(
    (record) => !isKnownCountry(record),
  ).length;
  const estimatedAgentRows = telemetry.agentUsageRecords.filter((record) => record.isEstimate).length;
  const sourceText = accessSource
    ? `${accessSource.label}: ${accessSource.value}`
    : readySources.length
      ? readySources.slice(0, 3).join(" / ")
      : "MySQL / configured sources";

  return (
    <section className="scope-banner" aria-label={text.sourceScope}>
      <div>
        <DatabaseZap size={16} aria-hidden="true" />
        <span>{text.sourceScope}</span>
        <strong>{telemetry.sourceMode === "sample" ? text.sampleData : sourceText}</strong>
      </div>
      <div>
        <Globe2 size={16} aria-hidden="true" />
        <span>{text.countrySplit}</span>
        <strong>
          {!access.canViewCountries
            ? text.countriesLocked
            : unknownCountryRows
              ? text.unknownCountryHidden
              : text.countriesAvailable}
        </strong>
      </div>
      <div>
        <CircleAlert size={16} aria-hidden="true" />
        <span>{text.boundary}</span>
        <strong>{estimatedAgentRows ? text.agentEstimated : text.notGlobalTotal}</strong>
      </div>
    </section>
  );
}

function restrictTelemetryForAccess(
  payload: TelemetryPayload,
  user: AuthUser,
  access: UserAccess,
  text: Copy,
): TelemetryPayload {
  const modelUsageRecords = limitClientRowsByDate(
    access.canViewCountries ? payload.modelUsageRecords : payload.modelUsageRecords.map(lockCountryScope),
    access.maxRowsPerDate,
    "tokens",
  );
  const agentUsageRecords = access.canViewAgents
    ? limitClientRowsByDate(
        access.canViewCountries ? payload.agentUsageRecords : payload.agentUsageRecords.map(lockCountryScope),
        access.maxRowsPerDate,
        "tokens",
      )
    : [];

  return {
    ...payload,
    modelUsageRecords,
    agentUsageRecords,
    sourceReadiness: access.canViewSources
      ? payload.sourceReadiness
      : [
          {
            id: "access",
            label: text.tier,
            value: tierLabel(user.tier, text),
            status: "ready",
            message: access.canViewAgents ? text.liveData : text.upgradeAgents,
          },
        ],
  };
}

function lockCountryScope<T extends { country: string; countryCode: string; region: string }>(record: T): T {
  return {
    ...record,
    country: "Locked",
    countryCode: "ZZ",
    region: "Locked",
  };
}

function limitClientRowsByDate<T extends Record<string, unknown>>(records: T[], maxRows: number | null, metric: keyof T) {
  if (!maxRows) {
    return records;
  }

  const grouped = new Map<string, T[]>();
  records.forEach((record) => {
    const date = String(record.date ?? "");
    grouped.set(date, [...(grouped.get(date) ?? []), record]);
  });

  return Array.from(grouped.values()).flatMap((rows) =>
    rows
      .sort((left, right) => Number(right[metric] ?? 0) - Number(left[metric] ?? 0))
      .slice(0, maxRows),
  );
}

function ModelDashboard({
  records,
  activeDates,
  latestDate,
  previousDate,
  country,
  providerFilter,
  canViewDetails,
  text,
}: {
  records: ModelUsageRecord[];
  activeDates: string[];
  latestDate: string;
  previousDate: string;
  country: string;
  providerFilter: string;
  canViewDetails: boolean;
  text: Copy;
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
          label={text.totalTokens}
          value={formatTokens(totalTokens)}
          detail={`${latestRecordDate} ${formatTokens(latestTokens)}`}
          tone="blue"
          delta={dailyDelta}
        />
        <MetricCard
          icon={Network}
          label={text.requests}
          value={formatCompact(totalRequests)}
          detail={text.modelSeries(modelCount)}
          tone="green"
        />
        <MetricCard
          icon={Users}
          label={text.activeUsers}
          value={formatCompact(totalActiveUsers)}
          detail={`${text.coverage} ${formatPercent(avgCoverage / 100)}`}
          tone="orange"
        />
        <MetricCard
          icon={Gauge}
          label={text.avgLatency}
          value={`${Math.round(avgLatency)} ms`}
          detail={text.weightedByRequests}
          tone="purple"
        />
      </section>

      <section className="content-grid primary-grid">
        <Panel
          title={text.dailyTokenTrend}
          icon={LineChart}
          action={<span className="panel-note">{text.stackedByProvider}</span>}
        >
          <div className="chart-frame tall">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 10, right: 22, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
                <YAxis tickFormatter={(value) => formatAxisTokens(Number(value))} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value, name) => [formatTokens(Number(value)), name]}
                  labelFormatter={(label) => `${text.date} ${label}`}
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

        <Panel title="Prompt / Completion" icon={Cpu} action={<span className="panel-note">{text.tokenMix}</span>}>
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
        <Panel title={text.providerShare} icon={BarChart3} action={<span className="panel-note">{text.totalTokenNote}</span>}>
          <HorizontalBarChart rows={providerRows} valueFormatter={formatTokens} />
        </Panel>
        <Panel title={text.knownCountrySplit} icon={Globe2} action={<span className="panel-note">{text.top12}</span>}>
          <CountryGrid rows={countryRows.slice(0, 12)} valueFormatter={formatTokens} text={text} />
        </Panel>
      </section>

      {canViewDetails && (
        <Panel title={text.modelDetails} icon={Server} action={<span className="panel-note">{text.sortedByTokens}</span>}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{text.model}</th>
                  <th>{text.provider}</th>
                  <th>{text.tokenTotal}</th>
                  <th>{text.requests}</th>
                  <th>{text.countries}</th>
                  <th>{text.share}</th>
                  <th>{text.dailyChange}</th>
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
      )}
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
  canViewDetails,
  text,
}: {
  records: AgentUsageRecord[];
  activeDates: string[];
  latestDate: string;
  previousDate: string;
  country: string;
  frameworkFilter: string;
  canViewDetails: boolean;
  text: Copy;
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
          label={text.estimatedCalls}
          value={formatCompact(totalInvocations)}
          detail={hasEstimatedRecords ? text.publicTokenRatio : `${latestRecordDate} ${formatCompact(latestInvocations)}`}
          tone="blue"
          delta={dailyDelta}
        />
        <MetricCard
          icon={Workflow}
          label={text.toolCalls}
          value={formatCompact(totalToolCalls)}
          detail={totalToolCalls ? `${formatRatio(totalToolCalls, totalInvocations)} / call` : text.undisclosedPublicSource}
          tone="green"
        />
        <MetricCard
          icon={CheckCircle2}
          label={text.successRate}
          value={formatPercent(avgSuccess / 100)}
          detail={hasEstimatedRecords ? text.undisclosedSuccess : text.averageSteps(avgSteps.toFixed(1))}
          tone="orange"
        />
        <MetricCard
          icon={DatabaseZap}
          label={text.agentToken}
          value={formatTokens(totalTokens)}
          detail={text.agentContextToken}
          tone="purple"
        />
      </section>

      <section className="content-grid primary-grid">
        <Panel title={text.dailyAgentTrend} icon={LineChart} action={<span className="panel-note">{text.stackedByType}</span>}>
          <div className="chart-frame tall">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 10, right: 22, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
                <YAxis tickFormatter={(value) => formatAxisCompact(Number(value))} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value, name) => [formatCompact(Number(value)), name]}
                  labelFormatter={(label) => `${text.date} ${label}`}
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

        <Panel title={text.frameworkShare} icon={Workflow} action={<span className="panel-note">{text.estimatedCalls}</span>}>
          <HorizontalBarChart rows={frameworkRows} valueFormatter={formatCompact} />
        </Panel>
      </section>

      <section className="content-grid secondary-grid">
        <Panel title={text.agentCountrySplit} icon={Globe2} action={<span className="panel-note">{text.top12}</span>}>
          <CountryGrid rows={countryRows.slice(0, 12)} valueFormatter={formatCompact} text={text} />
        </Panel>
        <Panel title={text.typeEfficiency} icon={Gauge} action={<span className="panel-note">{text.successSteps}</span>}>
          <div className="agent-matrix">
            {categoryRows.slice(0, 7).map((row) => (
              <div key={row.category} className="agent-matrix-row">
                <div>
                  <strong>{row.category}</strong>
                  <span>{formatCompact(row.invocations)} {text.estimatedCallUnit}</span>
                </div>
                <div className="matrix-values">
                  <span>{formatPercent(row.successRate)}</span>
                  <span>{row.avgSteps.toFixed(1)} {text.steps}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      {canViewDetails && (
        <Panel title={text.agentDetails} icon={Bot} action={<span className="panel-note">{text.sortedByEstimatedCalls}</span>}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{text.type}</th>
                  <th>{text.mainFramework}</th>
                  <th>{text.estimatedCalls}</th>
                  <th>{text.completedTasks}</th>
                  <th>{text.toolCalls}</th>
                  <th>{text.successRate}</th>
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
      )}
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
  text,
}: {
  rows: AggregateRow[];
  valueFormatter: (value: number) => string;
  text: Copy;
}) {
  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  if (!rows.length) {
    return <EmptyState message={text.noCountryData} />;
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
  text,
}: {
  sourceReadiness: SourceReadiness[];
  apiError: string | null;
  text: Copy;
}) {
  return (
    <section className="source-strip" aria-label={text.sourceScope}>
      {apiError && (
        <div className="source-item error">
          <span>{text.apiFrontend}</span>
          <strong>{text.disconnected}</strong>
          <em>{apiError}</em>
        </div>
      )}
      {sourceReadiness.map((item) => (
        <div key={item.id ?? item.label} className={`source-item ${item.status}`}>
          <span>{item.label}</span>
          <strong>{item.records ? `${item.value} · ${formatCompact(item.records)} ${text.rows}` : item.value}</strong>
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

function readAuthToken() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(authTokenKey) ?? "";
}

function writeAuthToken(token: string) {
  window.localStorage.setItem(authTokenKey, token);
}

function clearAuthToken() {
  window.localStorage.removeItem(authTokenKey);
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
  };
}

function readLanguage(): Language {
  if (typeof window === "undefined") {
    return "zh";
  }
  const value = window.localStorage.getItem(languageKey);
  return languageOptions.some((option) => option.value === value) ? (value as Language) : "zh";
}

function telemetryCacheKeyFor(user: AuthUser) {
  return `${telemetryCacheKey}.${user.username}.${user.tier}`;
}

function tierLabel(tier: UserTier, text: Copy) {
  if (tier === "enterprise") return text.planEnterprise;
  if (tier === "pro") return text.planPro;
  return text.planFree;
}

function userDisplayName(user: AuthUser, text: Copy) {
  return user.subscriptionStatus === "guest" ? text.guestUser : user.username;
}

function readTelemetryCache(user: AuthUser): CachedTelemetry | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawValue = window.localStorage.getItem(telemetryCacheKeyFor(user));
    if (!rawValue) {
      return undefined;
    }

    const cached = JSON.parse(rawValue) as Partial<CachedTelemetry>;
    if (!cached.payload || !isTelemetryPayload(cached.payload) || !cached.cachedAt || !cached.signature) {
      return undefined;
    }

    const cachedAt = Date.parse(cached.cachedAt);
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > telemetryCacheMaxAgeMs) {
      window.localStorage.removeItem(telemetryCacheKeyFor(user));
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

function writeTelemetryCache(user: AuthUser, payload: TelemetryPayload, signature = telemetrySignature(payload)) {
  if (typeof window === "undefined" || payload.sourceMode !== "live" || !hasTelemetryRows(payload)) {
    return;
  }

  try {
    const cached: CachedTelemetry = {
      payload,
      signature,
      cachedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(telemetryCacheKeyFor(user), JSON.stringify(cached));
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
