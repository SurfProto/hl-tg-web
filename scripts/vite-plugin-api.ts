import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Connect, Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Serves the Vercel functions under api/ from inside the Vite dev server.
 *
 * Why this exists: `pnpm dev` only ran Vite, with no local counterpart to the
 * /api/* routes, so every request fell through to the SPA fallback and came back
 * as index.html. That is why edge-proxy.ts and onramp.ts both throw "returned
 * HTML instead of JSON" — those guards were written around this gap rather than
 * closing it. Before the read layer moved server-side the SDK called Hyperliquid
 * straight from the browser, so local development used to work.
 *
 * A Vite plugin rather than a separate server: one process, no proxy, no extra
 * dependency, and Vite's ssrLoadModule both compiles the TypeScript and
 * invalidates it on change, so editing a handler takes effect on the next
 * request.
 *
 * This reimplements only the part of Vercel's Node contract the handlers use —
 * request.query, request.body parsed by Content-Type, and
 * response.status().json() / .setHeader(). It is not a Vercel emulator; preview
 * deployments remain the fidelity check.
 */

export interface ApiPluginOptions {
  /** Repository root, i.e. the directory containing `api/`. */
  root: string;
}

// ---------------------------------------------------------------------------
// .env loading — deliberately dependency-free
// ---------------------------------------------------------------------------

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // A real environment variable always wins over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Route discovery — mirrors Vercel's api/ convention
// ---------------------------------------------------------------------------

/** Vercel excludes any path segment beginning with `_` from routing. */
function isPrivatePath(relativePath: string): boolean {
  return relativePath.split(sep).some((segment) => segment.startsWith("_"));
}

async function discoverRoutes(apiRoot: string): Promise<Map<string, string>> {
  const routes = new Map<string, string>();

  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(apiRoot, full);
      if (isPrivatePath(rel)) continue;

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;

      routes.set(`/api/${rel.replace(/\.ts$/, "").split(sep).join("/")}`, full);
    }
  }

  await walk(apiRoot);
  return routes;
}

// ---------------------------------------------------------------------------
// Vercel request/response shims
// ---------------------------------------------------------------------------

function buildQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return query;
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** Mirrors Vercel's documented Content-Type handling for `request.body`. */
function parseBody(raw: Buffer, contentType: string | undefined): unknown {
  if (raw.length === 0 || !contentType) return undefined;

  const type = contentType.split(";")[0].trim().toLowerCase();
  const text = raw.toString("utf8");

  if (type === "application/json") {
    try {
      return JSON.parse(text);
    } catch {
      // Pass the raw string through; parseJsonBody turns it into a 400.
      return text;
    }
  }
  if (type === "application/x-www-form-urlencoded") {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (type === "text/plain") return text;
  if (type === "application/octet-stream") return raw;
  return text;
}

function createResponseShim(response: ServerResponse) {
  let statusCode = 200;
  let finished = false;

  const shim = {
    setHeader(name: string, value: string) {
      if (!response.headersSent) response.setHeader(name, value);
      return shim;
    },
    status(code: number) {
      statusCode = code;
      return shim;
    },
    json(payload: unknown) {
      if (finished) return shim;
      finished = true;
      response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
      return shim;
    },
    send(payload: unknown) {
      if (finished) return shim;
      finished = true;
      if (payload == null) {
        response.writeHead(statusCode);
        response.end();
      } else if (typeof payload === "string" || Buffer.isBuffer(payload)) {
        response.writeHead(statusCode);
        response.end(payload);
      } else {
        finished = false;
        return shim.json(payload);
      }
      return shim;
    },
    end() {
      if (!finished) {
        finished = true;
        response.writeHead(statusCode);
        response.end();
      }
      return shim;
    },
    get writableEnded() {
      return finished;
    },
  };

  return shim;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

type NodeHandler = (request: any, response: any) => unknown | Promise<unknown>;
type WebHandler = { fetch: (request: Request) => Promise<Response> };

function isWebHandler(value: unknown): value is WebHandler {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WebHandler).fetch === "function"
  );
}

export function apiPlugin(options: ApiPluginOptions): Plugin {
  const apiRoot = join(options.root, "api");

  return {
    name: "hl-tg-web:api",
    apply: "serve",

    async configureServer(server: ViteDevServer) {
      loadEnvFile(join(options.root, ".env.local"));
      loadEnvFile(join(options.root, ".env"));

      const routes = await discoverRoutes(apiRoot);

      server.config.logger.info(
        `  api  ${routes.size} routes mounted from api/ (${[...routes.keys()]
          .filter((path) => path.startsWith("/api/market"))
          .length} market, ${[...routes.keys()].filter((path) => path.startsWith("/api/account")).length} account)`,
      );

      const middleware: Connect.NextHandleFunction = async (incoming, outgoing, next) => {
        const rawUrl = incoming.url ?? "/";
        if (!rawUrl.startsWith("/api/")) return next();

        const url = new URL(rawUrl, "http://localhost");
        const file = routes.get(url.pathname);

        if (!file) {
          // A 404 in JSON, not the SPA shell — the whole point of this plugin.
          outgoing.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          outgoing.end(
            JSON.stringify({
              success: false,
              error: `No API route for ${url.pathname}`,
              code: "NOT_FOUND",
              details: null,
            }),
          );
          return;
        }

        const raw = await readRawBody(incoming);
        const request = {
          method: incoming.method,
          url: rawUrl,
          headers: incoming.headers,
          query: buildQuery(url),
          body: parseBody(raw, incoming.headers["content-type"]),
          rawBody: raw,
        };
        const response = createResponseShim(outgoing);
        const startedAt = Date.now();

        try {
          const module = await server.ssrLoadModule(file);
          const exported = module.default;

          if (typeof exported === "function") {
            await (exported as NodeHandler)(request, response);
          } else if (isWebHandler(exported)) {
            // Web Standard export. Nothing routed uses this today, but support
            // it so adding one does not silently fail.
            const webResponse = await exported.fetch(
              new Request(`http://localhost${rawUrl}`, {
                method: request.method,
                headers: incoming.headers as HeadersInit,
                body: ["GET", "HEAD"].includes(request.method ?? "GET") ? undefined : raw,
              }),
            );
            webResponse.headers.forEach((value, key) => response.setHeader(key, value));
            response
              .status(webResponse.status)
              .send(Buffer.from(await webResponse.arrayBuffer()));
          } else {
            throw new Error(`${file} has no usable default export`);
          }

          if (!response.writableEnded) response.end();
        } catch (error) {
          // Locally the full error is what you want, unlike production where
          // detail is deliberately withheld.
          server.config.logger.error(
            `  api  ${incoming.method} ${url.pathname} threw:\n${
              error instanceof Error ? (error.stack ?? error.message) : String(error)
            }`,
          );
          if (!response.writableEnded) {
            response.status(500).json({
              success: false,
              error: error instanceof Error ? error.message : "Unexpected error",
              code: "DEV_HANDLER_THREW",
              details: null,
            });
          }
        }

        server.config.logger.info(
          `  api  ${incoming.method} ${url.pathname} → ${outgoing.statusCode} (${
            Date.now() - startedAt
          }ms)`,
        );
      };

      // Ahead of Vite's SPA fallback, which is what used to swallow these.
      server.middlewares.use(middleware);
    },
  };
}
