import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HyperliquidClient } from "@repo/hyperliquid-sdk";
import type { RewardsConfig } from "./config";

function formatUsdcAmount(amount: number) {
  return amount.toFixed(6).replace(/\.?0+$/, "");
}

export function hasRewardsTreasury(config: RewardsConfig) {
  return Boolean(config.treasuryPrivateKey);
}

export async function sendRewardUsdc(
  config: RewardsConfig,
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
  const client = new HyperliquidClient({
    customSigner: wallet,
    testnet: config.hyperliquidTestnet,
    walletAddress: account.address,
  });

  return client.usdSend(input.destination, formatUsdcAmount(input.amount));
}
