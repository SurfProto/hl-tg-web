import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRewardsHyperliquidClient } from "./hyperliquid-client";

/**
 * Dormant. Retained for audited history and isolated tests only.
 *
 * The rewards program is XP-only: no deployed request or cron handler imports
 * this module, and `server-imports.test.ts` fails the build if one starts to.
 * It is kept rather than deleted because reconciling the held cash ledger needs
 * the transfer shape to stay readable, and because deleting it would only mean
 * rewriting it from memory at relaunch.
 *
 * It is also not a production payout system, and re-enabling it as-is would not
 * make it one. A relaunch needs durable per-attempt state, an exchange transfer
 * reference, manual review for "sent but the write failed" outcomes, treasury
 * and per-transfer limits, and an emergency stop. See the relaunch gates in
 * docs/superpowers/specs/2026-08-24-points-xp-only-hardening-design.md.
 */

/**
 * Payout configuration, read separately from `RewardsConfig` on purpose.
 *
 * Keeping the treasury key out of the config object that request handlers
 * receive is what makes "a dashboard request cannot move money" a structural
 * property rather than a convention.
 */
export interface PayoutConfig {
  hyperliquidTestnet: boolean;
  treasuryPrivateKey: `0x${string}` | null;
}

export function getPayoutConfig(env: NodeJS.ProcessEnv = process.env): PayoutConfig {
  return {
    hyperliquidTestnet: env.VITE_HYPERLIQUID_TESTNET === "true",
    treasuryPrivateKey: (env.REWARDS_TREASURY_PRIVATE_KEY as `0x${string}` | undefined) ?? null,
  };
}

function formatUsdcAmount(amount: number) {
  return amount.toFixed(6).replace(/\.?0+$/, "");
}

export function hasRewardsTreasury(config: PayoutConfig) {
  return Boolean(config.treasuryPrivateKey);
}

export async function sendRewardUsdc(
  config: PayoutConfig,
  input: { amount: number; destination: string },
) {
  if (!config.treasuryPrivateKey) {
    throw new Error("REWARDS_TREASURY_NOT_CONFIGURED");
  }

  const account = privateKeyToAccount(config.treasuryPrivateKey);
  const wallet = createWalletClient({
    account,
    transport: http(
      config.hyperliquidTestnet
        ? "https://api.hyperliquid-testnet.xyz"
        : "https://api.hyperliquid.xyz",
    ),
  });
  const client = await createRewardsHyperliquidClient({
    customSigner: wallet,
    testnet: config.hyperliquidTestnet,
    walletAddress: account.address,
  });

  return client.usdSend(input.destination, formatUsdcAmount(input.amount));
}
