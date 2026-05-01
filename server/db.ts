import mysql from "mysql2/promise";
import type { AgentUsageRecord, ModelUsageRecord } from "../src/data";
import type { SourceStatus, TelemetryPayload } from "./connectors/types";
import { dateDaysAgo, status } from "./connectors/utils";

type MySqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export function mysqlConfigured() {
  return Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_PASSWORD);
}

export function mysqlEnabled() {
  return process.env.MODEL_MONITOR_MYSQL_ENABLED !== "false" && mysqlConfigured();
}

export async function ensureMysqlSchema() {
  const config = mysqlConfig();
  await tryCreateDatabase(config);

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    multipleStatements: true,
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS globalaitokenusage (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        usage_date DATE NOT NULL,
        provider VARCHAR(128) NOT NULL,
        provider_region VARCHAR(64) NOT NULL,
        model VARCHAR(255) NOT NULL,
        model_class VARCHAR(128) NOT NULL,
        country VARCHAR(128) NOT NULL,
        country_code VARCHAR(16) NOT NULL,
        region VARCHAR(64) NOT NULL,
        tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
        prompt_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
        completion_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
        requests BIGINT UNSIGNED NOT NULL DEFAULT 0,
        active_users BIGINT UNSIGNED NOT NULL DEFAULT 0,
        avg_latency_ms DOUBLE NOT NULL DEFAULT 0,
        coverage DOUBLE NOT NULL DEFAULT 0,
        source_id VARCHAR(255) NOT NULL DEFAULT 'unknown',
        source_kind VARCHAR(64) NOT NULL DEFAULT 'unknown',
        is_estimate TINYINT(1) NOT NULL DEFAULT 0,
        metric_note VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_global_ai_usage (usage_date, provider, model, country_code),
        KEY idx_global_ai_usage_date (usage_date),
        KEY idx_global_ai_usage_provider (provider),
        KEY idx_global_ai_usage_country (country_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS globalagentusage (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        usage_date DATE NOT NULL,
        category VARCHAR(128) NOT NULL,
        framework VARCHAR(255) NOT NULL,
        country VARCHAR(128) NOT NULL,
        country_code VARCHAR(16) NOT NULL,
        region VARCHAR(64) NOT NULL,
        invocations BIGINT UNSIGNED NOT NULL DEFAULT 0,
        completed_tasks BIGINT UNSIGNED NOT NULL DEFAULT 0,
        tool_calls BIGINT UNSIGNED NOT NULL DEFAULT 0,
        tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
        success_rate DOUBLE NOT NULL DEFAULT 0,
        avg_steps DOUBLE NOT NULL DEFAULT 0,
        handoff_rate DOUBLE NOT NULL DEFAULT 0,
        source_id VARCHAR(255) NOT NULL DEFAULT 'unknown',
        source_kind VARCHAR(64) NOT NULL DEFAULT 'unknown',
        is_estimate TINYINT(1) NOT NULL DEFAULT 0,
        metric_note VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_global_agent_usage (usage_date, framework, category, country_code),
        KEY idx_global_agent_usage_date (usage_date),
        KEY idx_global_agent_usage_framework (framework),
        KEY idx_global_agent_usage_country (country_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS siteusers (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(128) NOT NULL,
        email VARCHAR(255) NULL,
        password_hash VARCHAR(255) NULL,
        role VARCHAR(64) NOT NULL DEFAULT 'viewer',
        metadata JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_siteusers_username (username),
        UNIQUE KEY uniq_siteusers_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await ensureTelemetryMetadataColumns(connection, config.database);
  } finally {
    await connection.end();
  }
}

async function ensureTelemetryMetadataColumns(connection: mysql.Connection, database: string) {
  await ensureColumn(connection, database, "globalaitokenusage", "source_id", "source_id VARCHAR(255) NOT NULL DEFAULT 'unknown'");
  await ensureColumn(connection, database, "globalaitokenusage", "source_kind", "source_kind VARCHAR(64) NOT NULL DEFAULT 'unknown'");
  await ensureColumn(connection, database, "globalaitokenusage", "is_estimate", "is_estimate TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn(connection, database, "globalaitokenusage", "metric_note", "metric_note VARCHAR(255) NULL");
  await ensureColumn(connection, database, "globalagentusage", "source_id", "source_id VARCHAR(255) NOT NULL DEFAULT 'unknown'");
  await ensureColumn(connection, database, "globalagentusage", "source_kind", "source_kind VARCHAR(64) NOT NULL DEFAULT 'unknown'");
  await ensureColumn(connection, database, "globalagentusage", "is_estimate", "is_estimate TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn(connection, database, "globalagentusage", "metric_note", "metric_note VARCHAR(255) NULL");
}

async function ensureColumn(connection: mysql.Connection, database: string, table: string, column: string, definition: string) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS column_count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [database, table, column],
  );

  if (Number(rows[0]?.column_count ?? 0) === 0) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  }
}

async function tryCreateDatabase(config: MySqlConfig) {
  let bootstrap: mysql.Connection | undefined;
  try {
    bootstrap = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      multipleStatements: true,
    });
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\`
       DEFAULT CHARACTER SET utf8mb4
       COLLATE utf8mb4_unicode_ci`,
    );
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "ER_DBACCESS_DENIED_ERROR" && code !== "ER_ACCESS_DENIED_ERROR") {
      throw error;
    }
  } finally {
    await bootstrap?.end();
  }
}

export async function upsertTelemetryToMysql(payload: TelemetryPayload): Promise<SourceStatus> {
  if (!mysqlEnabled()) {
    return status("mysql", "MySQL 持久化", "未配置", "pending", {
      message: "配置 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD 后启用",
    });
  }

  try {
    await ensureMysqlSchema();
    const connection = await createDbConnection();

    try {
      await connection.beginTransaction();
      await upsertModelRecords(connection, payload.modelUsageRecords);
      await upsertAgentRecords(connection, payload.agentUsageRecords);
      const pruneResult = await pruneStaleRows(connection, payload);
      await connection.commit();

      return status("mysql", "MySQL 持久化", "已同步", "ready", {
        records: payload.modelUsageRecords.length + payload.agentUsageRecords.length,
        message: `写入 ${mysqlConfig().database}.globalaitokenusage / globalagentusage${
          pruneResult.skipped ? `；${pruneResult.reason}` : `；清理旧行 ${pruneResult.deleted}`
        }`,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }
  } catch (error) {
    return status("mysql", "MySQL 持久化", "错误", "error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function readTelemetryFromMysql(days: number) {
  if (!mysqlEnabled() || process.env.MODEL_MONITOR_MYSQL_READ === "false") {
    return undefined;
  }

  await ensureMysqlSchema();
  const connection = await createDbConnection();
  const startDate = dateDaysAgo(days);

  try {
    const [modelRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT usage_date, provider, provider_region, model, model_class, country, country_code, region,
              tokens, prompt_tokens, completion_tokens, requests, active_users, avg_latency_ms, coverage,
              source_id, source_kind, is_estimate, metric_note
       FROM globalaitokenusage
       WHERE usage_date >= ?
       ORDER BY usage_date ASC, tokens DESC`,
      [startDate],
    );
    const [agentRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT usage_date, category, framework, country, country_code, region,
              invocations, completed_tasks, tool_calls, tokens, success_rate, avg_steps, handoff_rate,
              source_id, source_kind, is_estimate, metric_note
       FROM globalagentusage
       WHERE usage_date >= ?
       ORDER BY usage_date ASC, tokens DESC`,
      [startDate],
    );

    return {
      modelUsageRecords: modelRows.map(rowToModelRecord),
      agentUsageRecords: agentRows.map(rowToAgentRecord),
      status: status("mysql-read", "MySQL 数据读取", "已读取", "ready", {
        records: modelRows.length + agentRows.length,
        message: `从 ${mysqlConfig().database} 读取最近 ${days} 天`,
      }),
    };
  } finally {
    await connection.end();
  }
}

async function upsertModelRecords(connection: mysql.Connection, records: ModelUsageRecord[]) {
  if (!records.length) {
    return;
  }

  const sql = `
    INSERT INTO globalaitokenusage
      (usage_date, provider, provider_region, model, model_class, country, country_code, region,
       tokens, prompt_tokens, completion_tokens, requests, active_users, avg_latency_ms, coverage,
       source_id, source_kind, is_estimate, metric_note)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      provider_region = VALUES(provider_region),
      model_class = VALUES(model_class),
      country = VALUES(country),
      region = VALUES(region),
      tokens = VALUES(tokens),
      prompt_tokens = VALUES(prompt_tokens),
      completion_tokens = VALUES(completion_tokens),
      requests = VALUES(requests),
      active_users = VALUES(active_users),
      avg_latency_ms = VALUES(avg_latency_ms),
      coverage = VALUES(coverage),
      source_id = VALUES(source_id),
      source_kind = VALUES(source_kind),
      is_estimate = VALUES(is_estimate),
      metric_note = VALUES(metric_note),
      updated_at = CURRENT_TIMESTAMP
  `;

  await connection.query(sql, [
    records.map((record) => [
      record.date,
      record.provider,
      record.providerRegion,
      record.model,
      record.modelClass,
      record.country,
      record.countryCode,
      record.region,
      Math.round(record.tokens),
      Math.round(record.promptTokens),
      Math.round(record.completionTokens),
      Math.round(record.requests),
      Math.round(record.activeUsers),
      record.avgLatencyMs,
      record.coverage,
      record.source ?? "unknown",
      record.sourceKind ?? "unknown",
      record.isEstimate ? 1 : 0,
      record.metricNote ?? null,
    ]),
  ]);
}

async function pruneStaleRows(connection: mysql.Connection, payload: TelemetryPayload) {
  if (process.env.MODEL_MONITOR_MYSQL_PRUNE === "false") {
    return { deleted: 0, skipped: true, reason: "旧行清理已关闭" };
  }

  const hasBlockingError = payload.sourceReadiness.some(
    (item) => item.status === "error" && item.id !== "huggingface-model-downloads",
  );
  if (hasBlockingError) {
    return { deleted: 0, skipped: true, reason: "存在数据源错误，已跳过旧行清理" };
  }

  const modelDeleted = await pruneModelRows(connection, payload.modelUsageRecords.filter(isPruneableRecord));
  const agentDeleted = await pruneAgentRows(connection, payload.agentUsageRecords.filter(isPruneableRecord));
  return { deleted: modelDeleted + agentDeleted, skipped: false, reason: "" };
}

function isPruneableRecord(record: Pick<ModelUsageRecord | AgentUsageRecord, "sourceKind">) {
  return ["gateway", "trace", "provider_api", "cloud_metric", "billing_export"].includes(record.sourceKind ?? "");
}

async function pruneModelRows(connection: mysql.Connection, records: ModelUsageRecord[]) {
  const dates = Array.from(new Set(records.map((record) => record.date))).filter(Boolean);
  if (!dates.length) {
    return 0;
  }

  const activeKeys = new Set(records.map(modelDbKey));
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id, usage_date, provider, model, country_code
     FROM globalaitokenusage
     WHERE usage_date IN (?) AND source_kind IN ('gateway', 'trace', 'provider_api', 'cloud_metric', 'billing_export')`,
    [dates],
  );
  const staleIds = rows
    .filter((row) => !activeKeys.has(modelDbKey(rowToModelPruneRecord(row))))
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));

  if (!staleIds.length) {
    return 0;
  }

  await connection.query(`DELETE FROM globalaitokenusage WHERE id IN (?)`, [staleIds]);
  return staleIds.length;
}

async function pruneAgentRows(connection: mysql.Connection, records: AgentUsageRecord[]) {
  const dates = Array.from(new Set(records.map((record) => record.date))).filter(Boolean);
  if (!dates.length) {
    return 0;
  }

  const activeKeys = new Set(records.map(agentDbKey));
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id, usage_date, framework, category, country_code
     FROM globalagentusage
     WHERE usage_date IN (?) AND source_kind IN ('gateway', 'trace', 'provider_api', 'cloud_metric', 'billing_export')`,
    [dates],
  );
  const staleIds = rows
    .filter((row) => !activeKeys.has(agentDbKey(rowToAgentPruneRecord(row))))
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));

  if (!staleIds.length) {
    return 0;
  }

  await connection.query(`DELETE FROM globalagentusage WHERE id IN (?)`, [staleIds]);
  return staleIds.length;
}

function modelDbKey(record: Pick<ModelUsageRecord, "date" | "provider" | "model" | "countryCode">) {
  return [record.date, record.provider, record.model, record.countryCode].join("|");
}

function agentDbKey(record: Pick<AgentUsageRecord, "date" | "framework" | "category" | "countryCode">) {
  return [record.date, record.framework, record.category, record.countryCode].join("|");
}

function rowToModelPruneRecord(row: mysql.RowDataPacket): Pick<ModelUsageRecord, "date" | "provider" | "model" | "countryCode"> {
  return {
    date: toDateString(row.usage_date),
    provider: String(row.provider),
    model: String(row.model),
    countryCode: String(row.country_code),
  };
}

function rowToAgentPruneRecord(row: mysql.RowDataPacket): Pick<AgentUsageRecord, "date" | "framework" | "category" | "countryCode"> {
  return {
    date: toDateString(row.usage_date),
    framework: String(row.framework),
    category: String(row.category),
    countryCode: String(row.country_code),
  };
}

async function upsertAgentRecords(connection: mysql.Connection, records: AgentUsageRecord[]) {
  if (!records.length) {
    return;
  }

  const sql = `
    INSERT INTO globalagentusage
      (usage_date, category, framework, country, country_code, region,
       invocations, completed_tasks, tool_calls, tokens, success_rate, avg_steps, handoff_rate,
       source_id, source_kind, is_estimate, metric_note)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      country = VALUES(country),
      region = VALUES(region),
      invocations = VALUES(invocations),
      completed_tasks = VALUES(completed_tasks),
      tool_calls = VALUES(tool_calls),
      tokens = VALUES(tokens),
      success_rate = VALUES(success_rate),
      avg_steps = VALUES(avg_steps),
      handoff_rate = VALUES(handoff_rate),
      source_id = VALUES(source_id),
      source_kind = VALUES(source_kind),
      is_estimate = VALUES(is_estimate),
      metric_note = VALUES(metric_note),
      updated_at = CURRENT_TIMESTAMP
  `;

  await connection.query(sql, [
    records.map((record) => [
      record.date,
      record.category,
      record.framework,
      record.country,
      record.countryCode,
      record.region,
      Math.round(record.invocations),
      Math.round(record.completedTasks),
      Math.round(record.toolCalls),
      Math.round(record.tokens),
      record.successRate,
      record.avgSteps,
      record.handoffRate,
      record.source ?? "unknown",
      record.sourceKind ?? "unknown",
      record.isEstimate ? 1 : 0,
      record.metricNote ?? null,
    ]),
  ]);
}

function rowToModelRecord(row: mysql.RowDataPacket): ModelUsageRecord {
  return {
    date: toDateString(row.usage_date),
    provider: String(row.provider),
    providerRegion: String(row.provider_region),
    model: String(row.model),
    modelClass: String(row.model_class),
    country: String(row.country),
    countryCode: String(row.country_code),
    region: String(row.region),
    tokens: Number(row.tokens),
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
    requests: Number(row.requests),
    activeUsers: Number(row.active_users),
    avgLatencyMs: Number(row.avg_latency_ms),
    coverage: Number(row.coverage),
    source: String(row.source_id ?? "unknown"),
    sourceKind: String(row.source_kind ?? "unknown"),
    isEstimate: Boolean(Number(row.is_estimate ?? 0)),
    metricNote: row.metric_note ? String(row.metric_note) : undefined,
  };
}

function rowToAgentRecord(row: mysql.RowDataPacket): AgentUsageRecord {
  return {
    date: toDateString(row.usage_date),
    category: String(row.category),
    framework: String(row.framework),
    country: String(row.country),
    countryCode: String(row.country_code),
    region: String(row.region),
    invocations: Number(row.invocations),
    completedTasks: Number(row.completed_tasks),
    toolCalls: Number(row.tool_calls),
    tokens: Number(row.tokens),
    successRate: Number(row.success_rate),
    avgSteps: Number(row.avg_steps),
    handoffRate: Number(row.handoff_rate),
    source: String(row.source_id ?? "unknown"),
    sourceKind: String(row.source_kind ?? "unknown"),
    isEstimate: Boolean(Number(row.is_estimate ?? 0)),
    metricNote: row.metric_note ? String(row.metric_note) : undefined,
  };
}

async function createDbConnection() {
  const config = mysqlConfig();
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    supportBigNumbers: true,
    dateStrings: true,
  });
}

function mysqlConfig(): MySqlConfig {
  return {
    host: process.env.MYSQL_HOST ?? "",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE || "modelmonitor",
  };
}

function toDateString(value: unknown) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}
