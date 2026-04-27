import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTelemetry } from "./aggregate";
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
      const days = clamp(Number(url.searchParams.get("days") || 30), 1, 90);
      const payload = await buildTelemetry(days);
      sendJson(response, payload);
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(response, { ok: true, generatedAt: new Date().toISOString() });
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
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

function sendJson(response: import("node:http").ServerResponse, payload: unknown) {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
