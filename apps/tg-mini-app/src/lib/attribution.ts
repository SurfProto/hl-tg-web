import { getTelegramStartParam } from './referrals';

/**
 * First-touch attribution: the channel an account arrived through, captured on
 * the very first open and never changed.
 *
 * The preservation the growth spec asks for — through reopening, auth and
 * wallet creation — is two-layered. The code is derived from the Telegram
 * start_param on the first open and written to storage once; a later open with
 * a different (or absent) start_param does not overwrite it. Then, on the first
 * authenticated call, it is sent to the server, where the first write is
 * permanent. Storage bridges the pre-auth gap; the server makes it durable.
 */

export type AttributionSource = 'campaign' | 'referral' | 'direct';

export interface FirstTouch {
  source: AttributionSource;
  campaignCode: string | null;
  rawStartParam: string | null;
}

const FIRST_TOUCH_KEY = 'p34k-first-touch';

/** Campaign codes are case-insensitive [a-z0-9_-], Telegram's start_param set. */
export function sanitizeCampaignCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/u.test(normalized) ? normalized : null;
}

/**
 * Derive the first touch from a Telegram start_param. A `ref_` link is a
 * referral (the referral system records who; here it is just the channel); a
 * `c_` link, or any other non-empty code, is a campaign; nothing is direct.
 */
export function deriveFirstTouch(startParam: string | null | undefined): FirstTouch {
  const raw = startParam?.trim() ?? '';
  if (!raw) {
    return { source: 'direct', campaignCode: null, rawStartParam: null };
  }

  if (/^ref[:_-]/iu.test(raw)) {
    return { source: 'referral', campaignCode: null, rawStartParam: raw };
  }

  const withoutCampaignPrefix = raw.replace(/^c[:_-]/iu, '');
  const campaignCode = sanitizeCampaignCode(withoutCampaignPrefix);
  if (!campaignCode) {
    // A start_param we cannot make a code of — keep it verbatim for audit, but
    // it attributes nothing.
    return { source: 'direct', campaignCode: null, rawStartParam: raw };
  }

  return { source: 'campaign', campaignCode, rawStartParam: raw };
}

/**
 * Capture the first touch once. A no-op if one is already stored — that is the
 * client half of immutability. Safe in a storage-restricted WebView.
 */
export function captureFirstTouch(): void {
  try {
    if (localStorage.getItem(FIRST_TOUCH_KEY)) {
      return;
    }
    const firstTouch = deriveFirstTouch(getTelegramStartParam());
    localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(firstTouch));
  } catch {
    // Storage blocked: the session simply has no persisted first touch. The
    // server will record 'direct' if this session authenticates.
  }
}

export function getFirstTouch(): FirstTouch | null {
  try {
    const stored = localStorage.getItem(FIRST_TOUCH_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as FirstTouch;
    if (
      parsed.source === 'campaign' ||
      parsed.source === 'referral' ||
      parsed.source === 'direct'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
