import { pathToFileURL } from "node:url";

import { PrivyClient } from "@privy-io/node";

import { identityFromPrivyUser, type AuthoritativeProfileIdentity } from "../api/profile/_lib/identity";

export interface AuditedUserRow {
  id: string;
  privy_user_id: string | null;
  wallet_address: string | null;
  email: string | null;
  telegram_id: string | null;
}

export interface IdentityFinding {
  userId: string;
  privyUserId: string | null;
  type: "missing_privy_user" | "wallet_mismatch" | "email_mismatch" | "telegram_manual_review";
  stored?: string | null;
  canonical?: string | null;
  telegramId?: string | null;
  error?: string;
}

export interface IdentityAuditReport {
  mode: "report" | "apply";
  scannedCount: number;
  appliedCount: number;
  manualReviewCount: number;
  findings: IdentityFinding[];
}

type IdentityLookup = (privyUserId: string) => Promise<AuthoritativeProfileIdentity>;
type IdentityUpdate = (
  userId: string,
  updates: { wallet_address: string; email: string | null },
) => Promise<void>;

export async function auditIdentityRows(
  rows: AuditedUserRow[],
  resolveIdentity: IdentityLookup,
  updateIdentity: IdentityUpdate,
  apply: boolean,
): Promise<IdentityAuditReport> {
  const findings: IdentityFinding[] = [];
  let appliedCount = 0;

  for (const row of rows) {
    if (!row.privy_user_id) {
      findings.push({
        userId: row.id,
        privyUserId: null,
        type: "missing_privy_user",
        error: "Row has no Privy DID",
      });
      continue;
    }

    let canonical: AuthoritativeProfileIdentity;
    try {
      canonical = await resolveIdentity(row.privy_user_id);
    } catch (error) {
      findings.push({
        userId: row.id,
        privyUserId: row.privy_user_id,
        type: "missing_privy_user",
        error: error instanceof Error ? error.message : "Privy lookup failed",
      });
      continue;
    }

    const storedEmail = row.email?.trim().toLowerCase() ?? null;
    const hasWalletMismatch = row.wallet_address !== canonical.walletAddress;
    const hasEmailMismatch = storedEmail !== canonical.email;

    if (hasWalletMismatch) {
      findings.push({
        userId: row.id,
        privyUserId: row.privy_user_id,
        type: "wallet_mismatch",
        stored: row.wallet_address,
        canonical: canonical.walletAddress,
      });
    }
    if (hasEmailMismatch) {
      findings.push({
        userId: row.id,
        privyUserId: row.privy_user_id,
        type: "email_mismatch",
        stored: storedEmail,
        canonical: canonical.email,
      });
    }
    if (row.telegram_id) {
      findings.push({
        userId: row.id,
        privyUserId: row.privy_user_id,
        type: "telegram_manual_review",
        telegramId: row.telegram_id,
      });
    }

    if (apply && (hasWalletMismatch || hasEmailMismatch)) {
      await updateIdentity(row.id, {
        wallet_address: canonical.walletAddress,
        email: canonical.email,
      });
      appliedCount += 1;
    }
  }

  return {
    mode: apply ? "apply" : "report",
    scannedCount: rows.length,
    appliedCount,
    manualReviewCount: findings.filter((finding) => finding.type === "telegram_manual_review").length,
    findings,
  };
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function fetchUsers(supabaseUrl: string, serviceRoleKey: string): Promise<AuditedUserRow[]> {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/users?select=id,privy_user_id,wallet_address,email,telegram_id`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Supabase users audit read failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<AuditedUserRow[]>;
}

// Writes a users row outside the API. HANDOFF.md ("During a Supabase outage")
// requires such writes to clear both profile cache keys for the row's Privy id
// — `invalidateProfileCache` in api/profile/_lib/supabase-admin.ts — or the
// pre-repair wallet can be served as the stale copy for up to 24h during an
// outage. This script does not yet do that; run it with that in mind.
async function patchUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  updates: { wallet_address: string; email: string | null },
) {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
  );
  if (!response.ok) {
    throw new Error(`Supabase users audit repair failed: ${response.status} ${await response.text()}`);
  }
}

export async function runIdentityAuditCli(args = process.argv.slice(2)) {
  const apply = args.includes("--apply");
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const appId = process.env.PROFILE_PRIVY_APP_ID?.trim() || requiredEnv("VITE_PRIVY_APP_ID");
  const client = new PrivyClient({
    appId,
    appSecret: requiredEnv("PRIVY_APP_SECRET"),
  });
  const rows = await fetchUsers(supabaseUrl, serviceRoleKey);
  const report = await auditIdentityRows(
    rows,
    async (privyUserId) => identityFromPrivyUser(await client.users()._get(privyUserId)),
    async (userId, updates) => patchUser(supabaseUrl, serviceRoleKey, userId, updates),
    apply,
  );

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(
    `Scanned ${report.scannedCount} profiles; applied ${report.appliedCount} deterministic corrections; ${report.manualReviewCount} Telegram bindings need manual review.\n`,
  );
  return apply && report.manualReviewCount > 0 ? 2 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runIdentityAuditCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
