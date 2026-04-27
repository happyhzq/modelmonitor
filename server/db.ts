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
  } finally {
    await connection.end();
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
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }

    return status("mysql", "MySQL 持久化", "已同步", "ready", {
      records: payload.modelUsageRecords.length + payload.agentUsageRecords.length,
      message: `写入 ${mysqlConfig().database}.globalaitokenusage / globalagentusage`,
    });
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
              tokens, prompt_tokens, completion_tokens, requests, active_users, avg_latency_ms, coverage
       FROM globalaitokenusage
       WHERE usage_date >= ?
       ORDER BY usage_date ASC, tokens DESC`,
      [startDate],
    );
    const [agentRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT usage_date, category, framework, country, country_code, region,
              invocations, completed_tasks, tool_calls, tokens, success_rate, avg_steps, handoff_rate
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
       tokens, prompt_tokens, completion_tokens, requests, active_users, avg_latency_ms, coverage)
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
    ]),
  ]);
}

async function upsertAgentRecords(connection: mysql.Connection, records: AgentUsageRecord[]) {
  if (!records.length) {
    return;
  }

  const sql = `
    INSERT INTO globalagentusage
      (usage_date, category, framework, country, country_code, region,
       invocations, completed_tasks, tool_calls, tokens, success_rate, avg_steps, handoff_rate)
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
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}
