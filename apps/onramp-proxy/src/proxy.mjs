import { createHash, timingSafeEqual } from "node:crypto";

const ALLOWED_ROUTES = new Map([
  ["POST /externals/cex/precalc", true],
  ["POST /externals/cex/order/preorder", true],
  ["POST /externals/cex/order/create", true],
  ["GET /externals/cex/order/get", true],
  ["GET /externals/cex/services", true],
]);

function json(status, body) {
  return Response.json(body, { status });
}

function getRequired(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function safeTokenEquals(actual, expected) {
  const actualBuffer = Buffer.from(actual ?? "");
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function serializeSignatureParams(params) {
  return Object.keys(params)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}:${params[key]};`)
    .join("");
}

function createSignature(serializedParams, timestamp, secret) {
  return createHash("sha256")
    .update(`${serializedParams}${timestamp}${secret}`)
    .digest("hex");
}

function looksLikeHtml(body) {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function toProviderError(path, providerUrl, response, contentType, kind) {
  const diagnosticSuffix = ` (host: ${providerUrl.host}, status: ${response.status || 0}, content-type: ${contentType || "unknown"})`;
  if (kind === "html") {
    return {
      code: "PROVIDER_HTML_RESPONSE",
      error: `Onramp provider returned HTML for ${path}${diagnosticSuffix}`,
    };
  }

  return {
    code: "PROVIDER_INVALID_JSON",
    error: `Onramp provider returned invalid JSON for ${path}${diagnosticSuffix}`,
  };
}

async function parseRequestParams(request, url) {
  if (request.method === "GET") {
    return Object.fromEntries(url.searchParams.entries());
  }

  const bodyText = await request.text();
  if (!bodyText) {
    return {};
  }

  return JSON.parse(bodyText);
}

export function createProxyHandler({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const providerBaseUrl = getRequired(env, "ONRAMP_PROVIDER_BASE_URL").replace(/\/+$/, "");
  const clientId = getRequired(env, "ONRAMP_CLIENT_ID");
  const secret = getRequired(env, "ONRAMP_SECRET");
  const proxyToken = getRequired(env, "ONRAMP_PROXY_TOKEN");

  return async function handleProxyRequest(request) {
    const incomingUrl = new URL(request.url);
    const routeKey = `${request.method} ${incomingUrl.pathname}`;

    if (!safeTokenEquals(request.headers.get("x-onramp-proxy-token"), proxyToken)) {
      return json(401, {
        success: false,
        code: "UNAUTHORIZED",
        error: "Missing or invalid proxy token",
      });
    }

    if (!ALLOWED_ROUTES.has(routeKey)) {
      return json(404, {
        success: false,
        code: "NOT_FOUND",
        error: "Unsupported onramp proxy route",
      });
    }

    let params;
    try {
      params = await parseRequestParams(request, incomingUrl);
    } catch {
      return json(400, {
        success: false,
        code: "INVALID_JSON",
        error: "Invalid JSON request body",
      });
    }

    const timestamp = Math.floor(now() / 1000).toString();
    const signature = createSignature(serializeSignatureParams(params), timestamp, secret);
    const providerUrl = new URL(`${providerBaseUrl}${incomingUrl.pathname}`);

    if (request.method === "GET") {
      providerUrl.search = incomingUrl.searchParams.toString();
    }

    const providerResponse = await fetchImpl(providerUrl, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        "X-Client-ID": clientId,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
      },
      body: request.method === "POST" ? JSON.stringify(params) : undefined,
    });

    const rawBody = await providerResponse.text();
    const contentType = providerResponse.headers.get("content-type")?.toLowerCase() ?? "";

    if (contentType.includes("text/html") || looksLikeHtml(rawBody)) {
      const error = toProviderError(incomingUrl.pathname, providerUrl, providerResponse, contentType, "html");
      return json(providerResponse.status || 502, {
        success: false,
        ...error,
        details: null,
      });
    }

    try {
      JSON.parse(rawBody);
    } catch {
      const error = toProviderError(incomingUrl.pathname, providerUrl, providerResponse, contentType, "invalid-json");
      return json(providerResponse.status || 502, {
        success: false,
        ...error,
        details: null,
      });
    }

    return new Response(rawBody, {
      status: providerResponse.status,
      headers: {
        "Content-Type": contentType || "application/json",
      },
    });
  };
}
