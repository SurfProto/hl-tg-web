import { HyperliquidClient } from "../../../packages/hyperliquid-sdk/src/client";

import { mapPortfolioPeriod } from "../../market/_lib/upstream";

interface AccountReadArgs {
  walletAddress: string;
  testnet: boolean;
}

function createClient(args: AccountReadArgs) {
  return new HyperliquidClient({
    masterAccountAddress: args.walletAddress,
    walletAddress: args.walletAddress,
    testnet: args.testnet,
  });
}

export async function getAccountSnapshot(args: AccountReadArgs) {
  const client = createClient(args);
  const [userState, spotBalance] = await Promise.all([
    client.getUserState({ fresh: true }),
    client.getSpotBalance(),
  ]);
  return { userState, spotBalance };
}

export async function getAccountOrders(args: AccountReadArgs) {
  return createClient(args).getOpenOrders();
}

export async function getAccountFills(args: AccountReadArgs) {
  return createClient(args).getFills();
}

export async function getAccountPortfolio(args: AccountReadArgs & { period: string }) {
  const portfolio = await createClient(args).getPortfolio();
  return mapPortfolioPeriod(portfolio, args.period);
}
