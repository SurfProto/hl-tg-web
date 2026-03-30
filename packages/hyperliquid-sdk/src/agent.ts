import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const AGENT_KEY_PREFIX = 'hl_agent_';

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
}
