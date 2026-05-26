import { PrivyClient } from "@privy-io/node";

import { HttpError } from "../../onramp/_lib/http";
import type { ProfileConfig } from "./config";

interface PrivyLinkedAccount {
  type?: string;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
  connector_type?: string;
  verified_at?: string | number | null;
}

interface PrivyUserLike {
  linked_accounts?: PrivyLinkedAccount[];
}

export interface AuthoritativeProfileIdentity {
  walletAddress: string;
  email: string | null;
}

function isEmbeddedEthereumWallet(account: PrivyLinkedAccount) {
  return (
    account.type === "wallet" &&
    account.chain_type === "ethereum" &&
    account.wallet_client_type === "privy" &&
    account.connector_type === "embedded" &&
    typeof account.address === "string" &&
    account.address.trim().length > 0
  );
}

function isVerifiedEmail(account: PrivyLinkedAccount) {
  return (
    account.type === "email" &&
    typeof account.address === "string" &&
    account.address.trim().length > 0 &&
    typeof account.verified_at === "number"
  );
}

export function identityFromPrivyUser(user: PrivyUserLike): AuthoritativeProfileIdentity {
  const accounts = user.linked_accounts ?? [];
  const wallet = accounts.find(isEmbeddedEthereumWallet);
  if (!wallet?.address) {
    throw new HttpError(
      409,
      "EMBEDDED_WALLET_REQUIRED",
      "Create an embedded Ethereum wallet before completing onboarding",
    );
  }

  const email = accounts.find(isVerifiedEmail)?.address?.trim().toLowerCase() ?? null;

  return {
    walletAddress: wallet.address.trim(),
    email,
  };
}

export async function resolveAuthoritativeProfileIdentity(
  config: ProfileConfig,
  privyUserId: string,
): Promise<AuthoritativeProfileIdentity> {
  const client = new PrivyClient({
    appId: config.privyAppId,
    appSecret: config.privyAppSecret,
  });
  const user = (await client.users()._get(privyUserId)) as PrivyUserLike;
  return identityFromPrivyUser(user);
}
