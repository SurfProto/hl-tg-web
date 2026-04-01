import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const AGENT_KEY_PREFIX = 'hl_agent_';
const AGENT_EXPIRY_PREFIX = 'hl_agent_expiry_';

export function generateAgentKey(): `0x${string}` {
  return generatePrivateKey();
}

export function getAgentAddress(privateKey: `0x${string}`): `0x${string}` {
  return privateKeyToAccount(privateKey).address;
}

export function getStoredAgentKey(userAddress: string): `0x${string}` | null {
  try {
    return (localStorage.getItem(`${AGENT_KEY_PREFIX}${userAddress.toLowerCase()}`) as `0x${string}` | null);
  } catch {
    return null;
  }
}

export function storeAgentKey(userAddress: string, privateKey: `0x${string}`): void {
  localStorage.setItem(`${AGENT_KEY_PREFIX}${userAddress.toLowerCase()}`, privateKey);
}

export function clearAgentKey(userAddress: string): void {
  localStorage.removeItem(`${AGENT_KEY_PREFIX}${userAddress.toLowerCase()}`);
  localStorage.removeItem(`${AGENT_EXPIRY_PREFIX}${userAddress.toLowerCase()}`);
}

export function storeAgentExpiry(userAddress: string, expiryMs: number): void {
  localStorage.setItem(`${AGENT_EXPIRY_PREFIX}${userAddress.toLowerCase()}`, String(expiryMs));
}

export function getStoredAgentExpiry(userAddress: string): number | null {
  try {
    const raw = localStorage.getItem(`${AGENT_EXPIRY_PREFIX}${userAddress.toLowerCase()}`);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isAgentKeyExpired(userAddress: string): boolean {
  const expiry = getStoredAgentExpiry(userAddress);
  if (expiry === null) return false;
  return Date.now() > expiry;
}
