import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type mysql from "mysql2/promise";
import { createDbConnection, ensureMysqlSchema, mysqlEnabled } from "./db";

export type UserTier = "free" | "pro" | "enterprise";

export type AuthUser = {
  id: number;
  username: string;
  email?: string;
  role: "admin" | "viewer";
  tier: UserTier;
  subscriptionStatus: string;
};

export type UserAccess = {
  maxDays: number;
  canViewModels: boolean;
  canViewAgents: boolean;
  canViewCountries: boolean;
  canViewDetails: boolean;
  canViewSources: boolean;
  maxRowsPerDate: number | null;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
  access: UserAccess;
};

const sessionDays = 30;
const validTiers: UserTier[] = ["free", "pro", "enterprise"];

export async function registerUser(input: { username?: unknown; email?: unknown; password?: unknown }): Promise<AuthSession> {
  assertAuthEnabled();
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);

  await ensureMysqlSchema();
  const connection = await createDbConnection();

  try {
    const [[countRow]] = await connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS user_count FROM siteusers");
    const isFirstUser = Number(countRow?.user_count ?? 0) === 0;
    const role = isFirstUser ? "admin" : "viewer";
    const tier: UserTier = isFirstUser ? "enterprise" : "free";

    await connection.query(
      `INSERT INTO siteusers
        (username, email, password_hash, role, tier, subscription_status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, JSON_OBJECT())`,
      [username, email || null, hashPassword(password), role, tier, "active"],
    );

    return loginUser({ identifier: username, password });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "ER_DUP_ENTRY") {
      throw new AuthError(409, "USER_EXISTS", "Username or email already exists");
    }
    throw error;
  } finally {
    await connection.end();
  }
}

export async function loginUser(input: { identifier?: unknown; password?: unknown }): Promise<AuthSession> {
  assertAuthEnabled();
  const identifier = normalizeIdentifier(input.identifier);
  const password = normalizePassword(input.password);

  await ensureMysqlSchema();
  const connection = await createDbConnection();

  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, username, email, password_hash, role, tier, subscription_status
       FROM siteusers
       WHERE username = ? OR email = ?
       LIMIT 1`,
      [identifier, identifier],
    );
    const row = rows[0];
    if (!row || !row.password_hash || !verifyPassword(password, String(row.password_hash))) {
      throw new AuthError(401, "INVALID_CREDENTIALS", "Invalid username/email or password");
    }

    const token = randomBytes(32).toString("base64url");
    await connection.query(
      `INSERT INTO usersessions (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY))`,
      [Number(row.id), hashToken(token), sessionDays],
    );
    await connection.query("UPDATE siteusers SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(row.id)]);

    const user = rowToAuthUser(row);
    return { token, user, access: accessForUser(user) };
  } finally {
    await connection.end();
  }
}

export async function getUserByToken(token: string): Promise<AuthUser | undefined> {
  if (!token || !mysqlEnabled()) {
    return undefined;
  }

  await ensureMysqlSchema();
  const connection = await createDbConnection();

  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.username, u.email, u.role, u.tier, u.subscription_status
       FROM usersessions s
       JOIN siteusers u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [hashToken(token)],
    );
    return rows[0] ? rowToAuthUser(rows[0]) : undefined;
  } finally {
    await connection.end();
  }
}

export async function logoutToken(token: string) {
  if (!token || !mysqlEnabled()) {
    return;
  }

  await ensureMysqlSchema();
  const connection = await createDbConnection();

  try {
    await connection.query("DELETE FROM usersessions WHERE token_hash = ?", [hashToken(token)]);
  } finally {
    await connection.end();
  }
}

export async function listUsers() {
  await ensureMysqlSchema();
  const connection = await createDbConnection();

  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, username, email, role, tier, subscription_status, created_at, last_login_at
       FROM siteusers
       ORDER BY created_at DESC`,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      username: String(row.username),
      email: row.email ? String(row.email) : undefined,
      role: normalizeRole(row.role),
      tier: normalizeTier(row.tier),
      subscriptionStatus: String(row.subscription_status ?? "active"),
      createdAt: row.created_at ? String(row.created_at) : undefined,
      lastLoginAt: row.last_login_at ? String(row.last_login_at) : undefined,
    }));
  } finally {
    await connection.end();
  }
}

export async function updateUserAccess(userId: number, input: { tier?: unknown; role?: unknown; subscriptionStatus?: unknown }) {
  const tier = input.tier === undefined ? undefined : normalizeTier(input.tier);
  const role = input.role === undefined ? undefined : normalizeRole(input.role);
  const subscriptionStatus =
    input.subscriptionStatus === undefined ? undefined : normalizeSubscriptionStatus(input.subscriptionStatus);
  const updates: string[] = [];
  const values: Array<string | number> = [];

  if (tier) {
    updates.push("tier = ?");
    values.push(tier);
  }
  if (role) {
    updates.push("role = ?");
    values.push(role);
  }
  if (subscriptionStatus) {
    updates.push("subscription_status = ?");
    values.push(subscriptionStatus);
  }
  if (!updates.length) {
    throw new AuthError(400, "NO_UPDATES", "No valid user fields to update");
  }

  await ensureMysqlSchema();
  const connection = await createDbConnection();

  try {
    values.push(userId);
    await connection.query(`UPDATE siteusers SET ${updates.join(", ")} WHERE id = ?`, values);
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, username, email, role, tier, subscription_status
       FROM siteusers WHERE id = ? LIMIT 1`,
      [userId],
    );
    if (!rows[0]) {
      throw new AuthError(404, "USER_NOT_FOUND", "User not found");
    }
    return rowToAuthUser(rows[0]);
  } finally {
    await connection.end();
  }
}

export function accessForUser(user: AuthUser): UserAccess {
  if (user.role === "admin" || user.tier === "enterprise") {
    return {
      maxDays: 90,
      canViewModels: true,
      canViewAgents: true,
      canViewCountries: true,
      canViewDetails: true,
      canViewSources: true,
      maxRowsPerDate: null,
    };
  }

  if (user.tier === "pro") {
    return {
      maxDays: 30,
      canViewModels: true,
      canViewAgents: true,
      canViewCountries: true,
      canViewDetails: true,
      canViewSources: false,
      maxRowsPerDate: 120,
    };
  }

  return {
    maxDays: 7,
    canViewModels: true,
    canViewAgents: false,
    canViewCountries: false,
    canViewDetails: false,
    canViewSources: false,
    maxRowsPerDate: 20,
  };
}

export function tokenFromRequest(request: IncomingMessage) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return "";
  }
  return authHeader.slice("Bearer ".length).trim();
}

export function isLocalRequest(request: IncomingMessage) {
  const address = request.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function systemUser(): AuthUser {
  return {
    id: 0,
    username: "system",
    role: "admin",
    tier: "enterprise",
    subscriptionStatus: "active",
  };
}

export class AuthError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function assertAuthEnabled() {
  if (!mysqlEnabled()) {
    throw new AuthError(503, "AUTH_UNAVAILABLE", "MySQL is required for authentication");
  }
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [scheme, salt, expectedHash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !expectedHash) {
    return false;
  }

  const expected = Buffer.from(expectedHash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function rowToAuthUser(row: mysql.RowDataPacket): AuthUser {
  return {
    id: Number(row.id),
    username: String(row.username),
    email: row.email ? String(row.email) : undefined,
    role: normalizeRole(row.role),
    tier: normalizeTier(row.tier),
    subscriptionStatus: String(row.subscription_status ?? "active"),
  };
}

function normalizeUsername(value: unknown) {
  const username = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    throw new AuthError(400, "INVALID_USERNAME", "Username must be 3-40 letters, numbers, dots, underscores, or dashes");
  }
  return username;
}

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email) {
    return "";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    throw new AuthError(400, "INVALID_EMAIL", "Invalid email address");
  }
  return email;
}

function normalizeIdentifier(value: unknown) {
  const identifier = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!identifier) {
    throw new AuthError(400, "INVALID_IDENTIFIER", "Username or email is required");
  }
  return identifier;
}

function normalizePassword(value: unknown) {
  const password = typeof value === "string" ? value : "";
  if (password.length < 8 || password.length > 200) {
    throw new AuthError(400, "INVALID_PASSWORD", "Password must be at least 8 characters");
  }
  return password;
}

function normalizeRole(value: unknown): AuthUser["role"] {
  return value === "admin" ? "admin" : "viewer";
}

function normalizeTier(value: unknown): UserTier {
  return validTiers.includes(value as UserTier) ? (value as UserTier) : "free";
}

function normalizeSubscriptionStatus(value: unknown) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["active", "trial", "past_due", "canceled"].includes(status)) {
    return status;
  }
  throw new AuthError(400, "INVALID_SUBSCRIPTION_STATUS", "Invalid subscription status");
}
