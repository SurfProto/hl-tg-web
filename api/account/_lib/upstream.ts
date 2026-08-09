import { mapPortfolioPeriod } from "../../market/_lib/upstream";

interface AccountReadArgs {
  walletAddress: string;
  testnet: boolean;
}

/**
 * Load HyperliquidClient on demand.
 *
 * Importing it at module scope pulls ~2,400 lines plus the viem graph into every
 * /api/account/* function, so requests that never reach a read — a rejected
 * token, a rate limit, a missing profile — still paid the cold-start cost.
 * Earlier commits (d58a5d4, 1a10330, f9572a7) fixed the same eager-import
 * pattern in the rewards routes after it crashed in production.
 */
async function createClient(args: AccountReadArgs) {
  const { HyperliquidClient } = await import(
    "../../../packages/hyperliquid-sdk/src/client"
  );
  return new HyperliquidClient({
    masterAccountAddress: args.walletAddress,
    walletAddress: args.walletAddress,
    testnet: args.testnet,
  });
}

export async function getAccountSnapshot(args: AccountReadArgs) {
  const client = await createClient(args);
  const [userState, spotBalance] = await Promise.all([
    client.getUserState({ fresh: true }),
    client.getSpotBalance(),
  ]);
  return { userState, spotBalance };
}

export async function getAccountOrders(args: AccountReadArgs) {
  return (await createClient(args)).getOpenOrders();
}

export async function getAccountFills(args: AccountReadArgs) {
  return (await createClient(args)).getFills();
}

export async function getAccountPortfolio(args: AccountReadArgs & { period: string }) {
  const portfolio = await (await createClient(args)).getPortfolio();
  return mapPortfolioPeriod(portfolio, args.period);
}
