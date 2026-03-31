import { createPublicKey, createVerify, KeyObject } from 'node:crypto';

const ARBITRUM_CHAIN_ID = 42161;
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const HL_BRIDGE_ARBITRUM = '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

type BridgeRequestBody = {
  amount?: number;
  walletAddress?: string;
  chainId?: number;
  tokenAddress?: string;
  bridgeAddress?: string;
  data?: `0x${string}`;
};

type JwtPayload = {
  sub?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
};

let cachedVerificationKey: KeyObject | null = null;

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEnvNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getVerificationKey() {
  if (cachedVerificationKey) return cachedVerificationKey;
  cachedVerificationKey = createPublicKey(getRequiredEnv('PRIVY_VERIFICATION_KEY'));
  return cachedVerificationKey;
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function normalizeAddress(address: string) {
  return address.toLowerCase();
}

function isAddressEqual(left: string, right: string) {
  return normalizeAddress(left) === normalizeAddress(right);
}

function parseTransferCalldata(data: string) {
  const normalized = data.startsWith('0x') ? data.slice(2) : data;
  const selector = normalized.slice(0, 8).toLowerCase();
  if (selector !== 'a9059cbb') {
    throw new Error('Only ERC20 transfer calldata is supported');
  }

  const args = normalized.slice(8);
  if (args.length !== 128) {
    throw new Error('Invalid transfer calldata length');
  }

  const addressWord = args.slice(0, 64);
  const amountWord = args.slice(64, 128);
  const transferTarget = `0x${addressWord.slice(24)}`;
  const transferAmount = BigInt(`0x${amountWord}`);
  return { transferTarget, transferAmount };
}

async function verifyAccessToken(token: string) {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID;
  if (!appId) {
    throw new Error('Missing required environment variable: PRIVY_APP_ID');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Privy access token');
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const verifier = createVerify('SHA256');
  verifier.update(`${headerSegment}.${payloadSegment}`);
  verifier.end();

  const verified = verifier.verify(
    { key: await getVerificationKey(), dsaEncoding: 'ieee-p1363' },
    decodeBase64Url(signatureSegment),
  );
  if (!verified) {
    throw new Error('Invalid Privy access token signature');
  }

  const payload = JSON.parse(decodeBase64Url(payloadSegment).toString('utf8')) as JwtPayload;
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== 'privy.io') {
    throw new Error('Invalid Privy access token issuer');
  }
  if (!audience.includes(appId)) {
    throw new Error('Invalid Privy access token audience');
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    throw new Error('Privy access token has expired');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Privy access token missing sub claim');
  }

  return payload.sub;
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const baseUrl = getRequiredEnv('VITE_SUPABASE_URL');
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getMatchingUser(privyUserId: string, walletAddress: string) {
  const params = new URLSearchParams({
    select: 'id',
    privy_user_id: `eq.${privyUserId}`,
    wallet_address: `eq.${walletAddress}`,
    limit: '1',
  });

  const response = await supabaseFetch(`users?${params.toString()}`);
  return Array.isArray(response) ? response[0] ?? null : null;
}

async function sumAmount(filter: string) {
  const response = await supabaseFetch(`bridge_sponsorship_events?select=amount_usdc&status=eq.authorized&${filter}`);
  if (!Array.isArray(response)) return 0;
  return response.reduce((sum, row) => sum + Number(row.amount_usdc ?? 0), 0);
}

async function recordEvent(event: {
  privy_user_id: string;
  wallet_address: string;
  amount_usdc: number;
  chain_id: number;
  token_address: string;
  bridge_address: string;
  status: 'authorized' | 'rejected';
  rejection_code?: string;
  rejection_reason?: string;
}) {
  await supabaseFetch('bridge_sponsorship_events', {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

function reject(res: any, status: number, code: string, reason: string) {
  return res.status(status).json({ authorized: false, code, reason });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reject(res, 405, 'method_not_allowed', 'Only POST is supported.');
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reject(res, 401, 'missing_auth', 'Missing Privy access token.');
    }

    const privyUserId = await verifyAccessToken(authHeader.slice('Bearer '.length).trim());
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as BridgeRequestBody;

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return reject(res, 400, 'invalid_amount', 'Invalid bridge amount.');
    }

    if (!body.walletAddress) {
      return reject(res, 400, 'missing_wallet', 'Missing wallet address.');
    }

    if (!body.data) {
      return reject(res, 400, 'missing_data', 'Missing transaction calldata.');
    }

    if (body.chainId !== ARBITRUM_CHAIN_ID) {
      return reject(res, 400, 'wrong_chain', 'Gas sponsorship is only available for Arbitrum bridge deposits.');
    }

    if (!body.tokenAddress || !isAddressEqual(body.tokenAddress, USDC_ARBITRUM)) {
      return reject(res, 400, 'wrong_token', 'Only Arbitrum USDC deposits can be sponsored.');
    }

    if (!body.bridgeAddress || !isAddressEqual(body.bridgeAddress, HL_BRIDGE_ARBITRUM)) {
      return reject(res, 400, 'wrong_destination', 'Only the Hyperliquid bridge address can be sponsored.');
    }

    let transferTarget: string;
    let transferAmountRaw: bigint;
    try {
      const parsed = parseTransferCalldata(body.data);
      transferTarget = parsed.transferTarget;
      transferAmountRaw = parsed.transferAmount;
    } catch {
      return reject(res, 400, 'invalid_calldata', 'Only direct USDC transfers to the Hyperliquid bridge can be sponsored.');
    }
    if (!isAddressEqual(transferTarget, HL_BRIDGE_ARBITRUM)) {
      return reject(res, 400, 'wrong_transfer_target', 'Bridge deposit target mismatch.');
    }

    const expectedAmountRaw = BigInt(Math.floor(amount * 1e6));
    if (transferAmountRaw !== expectedAmountRaw) {
      return reject(res, 400, 'amount_mismatch', 'Bridge amount does not match transaction calldata.');
    }

    const matchingUser = await getMatchingUser(privyUserId, body.walletAddress);
    if (!matchingUser) {
      await recordEvent({
        privy_user_id: privyUserId,
        wallet_address: body.walletAddress,
        amount_usdc: amount,
        chain_id: body.chainId,
        token_address: body.tokenAddress,
        bridge_address: body.bridgeAddress,
        status: 'rejected',
        rejection_code: 'wallet_mismatch',
        rejection_reason: 'Wallet does not belong to the authenticated user.',
      });
      return reject(res, 403, 'wallet_mismatch', 'Wallet does not belong to the authenticated user.');
    }

    const maxPerTx = getEnvNumber('SPONSORED_BRIDGE_MAX_USDC_PER_TX', 250);
    const userDailyCap = getEnvNumber('SPONSORED_BRIDGE_USER_DAILY_USDC', 500);
    const userWeeklyCap = getEnvNumber('SPONSORED_BRIDGE_USER_WEEKLY_USDC', 1500);
    const walletDailyCap = getEnvNumber('SPONSORED_BRIDGE_WALLET_DAILY_USDC', 500);
    const walletLifetimeCap = getEnvNumber('SPONSORED_BRIDGE_WALLET_LIFETIME_USDC', 5000);
    const appDailyCap = getEnvNumber('SPONSORED_BRIDGE_APP_DAILY_USDC', 5000);

    if (amount > maxPerTx) {
      return reject(res, 403, 'tx_cap_exceeded', 'This bridge amount exceeds the sponsored transaction limit.');
    }

    const dayCutoff = new Date(Date.now() - DAY_MS).toISOString();
    const weekCutoff = new Date(Date.now() - WEEK_MS).toISOString();

    const [userDailyUsed, userWeeklyUsed, walletDailyUsed, walletLifetimeUsed, appDailyUsed] = await Promise.all([
      sumAmount(`privy_user_id=eq.${encodeURIComponent(privyUserId)}&created_at=gte.${encodeURIComponent(dayCutoff)}`),
      sumAmount(`privy_user_id=eq.${encodeURIComponent(privyUserId)}&created_at=gte.${encodeURIComponent(weekCutoff)}`),
      sumAmount(`wallet_address=eq.${encodeURIComponent(body.walletAddress)}&created_at=gte.${encodeURIComponent(dayCutoff)}`),
      sumAmount(`wallet_address=eq.${encodeURIComponent(body.walletAddress)}`),
      sumAmount(`created_at=gte.${encodeURIComponent(dayCutoff)}`),
    ]);

    let rejectionCode: string | null = null;
    let rejectionReason: string | null = null;

    if (userDailyUsed + amount > userDailyCap) {
      rejectionCode = 'user_daily_cap_exceeded';
      rejectionReason = 'Daily sponsorship limit reached for this user.';
    } else if (userWeeklyUsed + amount > userWeeklyCap) {
      rejectionCode = 'user_weekly_cap_exceeded';
      rejectionReason = 'Weekly sponsorship limit reached for this user.';
    } else if (walletDailyUsed + amount > walletDailyCap) {
      rejectionCode = 'wallet_daily_cap_exceeded';
      rejectionReason = 'Daily sponsorship limit reached for this wallet.';
    } else if (walletLifetimeUsed + amount > walletLifetimeCap) {
      rejectionCode = 'wallet_lifetime_cap_exceeded';
      rejectionReason = 'Lifetime sponsorship limit reached for this wallet.';
    } else if (appDailyUsed + amount > appDailyCap) {
      rejectionCode = 'app_daily_cap_exceeded';
      rejectionReason = 'App sponsorship budget is exhausted for today.';
    }

    if (rejectionCode && rejectionReason) {
      await recordEvent({
        privy_user_id: privyUserId,
        wallet_address: body.walletAddress,
        amount_usdc: amount,
        chain_id: body.chainId,
        token_address: body.tokenAddress,
        bridge_address: body.bridgeAddress,
        status: 'rejected',
        rejection_code: rejectionCode,
        rejection_reason: rejectionReason,
      });
      return reject(res, 403, rejectionCode, rejectionReason);
    }

    await recordEvent({
      privy_user_id: privyUserId,
      wallet_address: body.walletAddress,
      amount_usdc: amount,
      chain_id: body.chainId,
      token_address: body.tokenAddress,
      bridge_address: body.bridgeAddress,
      status: 'authorized',
    });

    return res.status(200).json({ authorized: true, sponsor: true });
  } catch (error) {
    console.error('[bridge sponsorship] authorize failed', error);
    return reject(
      res,
      500,
      'authorization_failed',
      'Unable to authorize gas sponsorship right now. You may need Arbitrum ETH for gas.',
    );
  }
}
