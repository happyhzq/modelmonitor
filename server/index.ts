import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTelemetry } from "./aggregate";
import {
  accessForUser,
  AuthError,
  getUserByToken,
  isLocalRequest,
  listUsers,
  loginUser,
  logoutToken,
  registerUser,
  systemUser,
  tokenFromRequest,
  updateUserAccess,
  type AuthUser,
  type UserAccess,
} from "./auth";
import { loadEnv } from "./env";

loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const port = Number(process.env.PORT || 8787);

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/api/telemetry") {
      const user = await requireTelemetryUser(request);
      if (!user) {
        sendJson(response, { error: "AUTH_REQUIRED", message: "Login required" }, 401);
        return;
      }

      const access = accessForUser(user);
      const responseDays = Math.min(clamp(Number(url.searchParams.get("days") || 30), 1, 90), access.maxDays);
      const payload = await buildTelemetry(90);
      sendJson(response, applyAccess(payload, user, access, responseDays));
      return;
    }

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      sendJson(response, await registerUser(await readJsonBody(request)));
      return;
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      sendJson(response, await loginUser(await readJsonBody(request)));
      return;
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      await logoutToken(tokenFromRequest(request));
      sendJson(response, { ok: true });
      return;
    }

    if (url.pathname === "/api/auth/me") {
      const user = await userFromBearer(request);
      if (!user) {
        sendJson(response, { error: "AUTH_REQUIRED", message: "Login required" }, 401);
        return;
      }
      sendJson(response, { user, access: accessForUser(user) });
      return;
    }

    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      const user = await requireAdmin(request);
      if (!user) {
        sendJson(response, { error: "FORBIDDEN", message: "Admin access required" }, 403);
        return;
      }
      sendJson(response, { users: await listUsers() });
      return;
    }

    if (url.pathname.startsWith("/api/admin/users/") && request.method === "PATCH") {
      const user = await requireAdmin(request);
      if (!user) {
        sendJson(response, { error: "FORBIDDEN", message: "Admin access required" }, 403);
        return;
      }
      const userId = Number(url.pathname.split("/").at(-1));
      if (!Number.isFinite(userId) || userId <= 0) {
        sendJson(response, { error: "INVALID_USER_ID", message: "Invalid user id" }, 400);
        return;
      }
      const updatedUser = await updateUserAccess(userId, await readJsonBody(request));
      sendJson(response, { user: updatedUser, access: accessForUser(updatedUser) });
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(response, { ok: true, generatedAt: new Date().toISOString() });
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    const statusCode = error instanceof AuthError ? error.statusCode : 500;
    response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        error: error instanceof AuthError ? error.code : "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

server.listen(port, () => {
  console.log(`AI Model Monitor running at http://localhost:${port}`);
});

async function serveStatic(pathname: string, response: import("node:http").ServerResponse) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(dist, cleanPath));

  if (!filePath.startsWith(dist)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const exists = await stat(filePath).then((item) => item.isFile()).catch(() => false);
  const resolvedPath = exists ? filePath : path.join(dist, "index.html");
  const body = await readFile(resolvedPath);
  const extension = path.extname(resolvedPath);

  response.writeHead(200, {
    "content-type": mimeTypes[extension] || "application/octet-stream",
    "cache-control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  response.end(body);
}

function sendJson(response: import("node:http").ServerResponse, payload: unknown, statusCode = 200) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((size, item) => size + item.length, 0) > 1024 * 1024) {
      throw new AuthError(413, "BODY_TOO_LARGE", "Request body is too large");
    }
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AuthError(400, "INVALID_JSON", "Invalid JSON body");
  }
}

async function userFromBearer(request: import("node:http").IncomingMessage) {
  const token = tokenFromRequest(request);
  return token ? getUserByToken(token) : undefined;
}

async function requireTelemetryUser(request: import("node:http").IncomingMessage) {
  const user = await userFromBearer(request);
  if (user) {
    return user;
  }

  return isLocalRequest(request) ? systemUser() : undefined;
}

async function requireAdmin(request: import("node:http").IncomingMessage) {
  const user = await userFromBearer(request);
  return user?.role === "admin" ? user : undefined;
}

function applyAccess(payload: Awaited<ReturnType<typeof buildTelemetry>>, user: AuthUser, access: UserAccess, days: number) {
  const modelRecordsForWindow = filterRecordsByDays(payload.modelUsageRecords, days);
  const agentRecordsForWindow = filterRecordsByDays(payload.agentUsageRecords, days);
  const modelUsageRecords = limitRowsByDate(
    access.canViewCountries ? modelRecordsForWindow : modelRecordsForWindow.map(removeCountryScope),
    access.maxRowsPerDate,
    "tokens",
  );
  const agentUsageRecords = access.canViewAgents
    ? limitRowsByDate(
        access.canViewCountries ? agentRecordsForWindow : agentRecordsForWindow.map(removeCountryScope),
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
            label: "Access tier",
            value: user.tier,
            status: "ready" as const,
            message: `Max ${access.maxDays} days${access.canViewAgents ? "" : "; agent view locked"}`,
          },
        ],
    viewer: {
      username: user.username,
      role: user.role,
      tier: user.tier,
      subscriptionStatus: user.subscriptionStatus,
    },
    access,
  };
}

function removeCountryScope<T extends { country: string; countryCode: string; region: string }>(record: T): T {
  return {
    ...record,
    country: "Locked",
    countryCode: "ZZ",
    region: "Locked",
  };
}

function filterRecordsByDays<T extends { date: string }>(records: T[], days: number) {
  const dates = Array.from(new Set(records.map((record) => record.date))).filter(Boolean).sort();
  const endDate = dates.at(-1);
  if (!endDate) {
    return records;
  }

  const startDate = shiftIsoDate(endDate, -Math.max(0, days - 1));
  return records.filter((record) => record.date >= startDate && record.date <= endDate);
}

function shiftIsoDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function limitRowsByDate<T extends Record<string, unknown>>(records: T[], maxRows: number | null, metric: keyof T) {
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

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
