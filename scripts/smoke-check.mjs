#!/usr/bin/env node
/**
 * Ask production whether its functions still load.
 *
 * Twice now this API has been dead without anyone noticing: every route from
 * 688e9bf until it was found, and /api/profile/bootstrap for long enough that
 * no new user could sign up. Both were module-load failures. Typecheck and
 * unit tests cannot see them, because nothing was wrong with the source — the
 * deployed bundle was missing a file.
 *
 * Two assertions catch that class of failure without any credentials:
 *
 *   1. An authed route answers 401, not 500. A function that fails to load
 *      answers FUNCTION_INVOCATION_FAILED, so reaching the handler at all is
 *      the signal.
 *   2. The response is JSON. vercel.json sends an unknown /api/* path to
 *      index.html, so a route that stopped existing returns 200 with a page of
 *      HTML — which a status-only check would happily accept.
 */

const BASE_URL =
  process.argv[2] ??
  process.env.SMOKE_BASE_URL ??
  "https://tg-mini-app-peach-ten.vercel.app";

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 15_000);

/** expect: the status a working deployment returns without credentials. */
const CHECKS = [
  // Answers 500 listing the module that failed. This is the only check here
  // that can see a break inside an authenticated path, because those fail on a
  // require rather than on a request.
  { method: "GET", path: "/api/health/deps", expect: 200 },

  // The one probe that actually opens a database connection. deps proves the
  // code loads; this proves Supabase answers. 503 here means the database is
  // down even if everything else on this list is green.
  { method: "GET", path: "/api/health/db", expect: 200 },

  { method: "GET", path: "/api/market/markets", expect: 200 },
  { method: "GET", path: "/api/market/stats", expect: 200 },
  { method: "GET", path: "/api/market/mids", expect: 200 },
  { method: "GET", path: "/api/market/ticker?symbol=BTC", expect: 200 },
  { method: "GET", path: "/api/market/depth?symbol=BTC", expect: 200 },
  { method: "GET", path: "/api/market/candles?symbol=BTC&interval=1h", expect: 200 },

  { method: "GET", path: "/api/account/snapshot", expect: 401 },
  { method: "GET", path: "/api/account/portfolio", expect: 401 },
  { method: "GET", path: "/api/account/orders", expect: 401 },
  { method: "GET", path: "/api/account/fills", expect: 401 },

  { method: "GET", path: "/api/profile", expect: 401 },
  { method: "POST", path: "/api/profile/bootstrap", expect: 401, body: {} },
  { method: "PATCH", path: "/api/profile/notifications", expect: 401, body: {} },

  { method: "POST", path: "/api/onramp/bootstrap", expect: 401, body: {} },
  { method: "POST", path: "/api/onramp/quote", expect: 401, body: {} },
  { method: "POST", path: "/api/onramp/checkout", expect: 401, body: {} },
  { method: "GET", path: "/api/onramp/status", expect: 401 },

  { method: "POST", path: "/api/rewards/dashboard", expect: 401, body: {} },
  { method: "POST", path: "/api/rewards/referral/apply", expect: 401, body: {} },
  { method: "GET", path: "/api/rewards/weekly-raffle", expect: 401 },

  { method: "GET", path: "/api/notifications/worker", expect: 401 },

  // The reporting endpoint has to work when everything else is broken.
  { method: "POST", path: "/api/client-errors", expect: 204, body: { message: "smoke-check" } },
  { method: "GET", path: "/api/client-errors", expect: 405 },
];

function looksLikeHtml(body) {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

async function runCheck(check) {
  const url = `${BASE_URL}${check.path}`;
  const started = Date.now();

  let response;
  try {
    response = await fetch(url, {
      method: check.method,
      headers: check.body ? { "content-type": "application/json" } : undefined,
      body: check.body ? JSON.stringify(check.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ...check,
      ok: false,
      ms: Date.now() - started,
      reason: `request failed: ${error instanceof Error ? error.message : error}`,
    };
  }

  const ms = Date.now() - started;
  const text = await response.text();

  if (response.status !== check.expect) {
    const detail = text.slice(0, 160).replace(/\s+/g, " ");
    return {
      ...check,
      ok: false,
      ms,
      reason: `expected ${check.expect}, got ${response.status} — ${detail}`,
    };
  }

  // 204 carries no body by definition.
  if (response.status !== 204 && looksLikeHtml(text)) {
    return {
      ...check,
      ok: false,
      ms,
      reason:
        "returned the SPA fallback HTML — the route is not registered on this deployment",
    };
  }

  return { ...check, ok: true, ms };
}

const results = [];
for (const check of CHECKS) {
  results.push(await runCheck(check));
}

const failures = results.filter((result) => !result.ok);

for (const result of results) {
  const label = `${result.method} ${result.path}`;
  if (result.ok) {
    console.log(`  ok   ${result.expect}  ${label}  (${result.ms}ms)`);
  } else {
    console.log(`  FAIL       ${label}  ${result.reason}`);
  }
}

console.log(
  `\n${results.length - failures.length}/${results.length} passed against ${BASE_URL}`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
