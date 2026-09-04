// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureFirstTouch,
  deriveFirstTouch,
  getFirstTouch,
  sanitizeCampaignCode,
} from './attribution';

function setStartParam(value: string | undefined) {
  (window as any).Telegram = {
    WebApp: { initDataUnsafe: value === undefined ? {} : { start_param: value } },
  };
}

describe('deriveFirstTouch', () => {
  it('reads a plain campaign code', () => {
    expect(deriveFirstTouch('twitter_launch')).toEqual({
      source: 'campaign',
      campaignCode: 'twitter_launch',
      rawStartParam: 'twitter_launch',
    });
  });

  it('strips a c_ campaign prefix and lowercases', () => {
    expect(deriveFirstTouch('c_Summer-2026')).toEqual({
      source: 'campaign',
      campaignCode: 'summer-2026',
      rawStartParam: 'c_Summer-2026',
    });
  });

  it('classifies a ref_ link as referral, not a campaign', () => {
    expect(deriveFirstTouch('ref_ABC123')).toEqual({
      source: 'referral',
      campaignCode: null,
      rawStartParam: 'ref_ABC123',
    });
  });

  it('is direct when there is no start_param', () => {
    expect(deriveFirstTouch(null)).toEqual({
      source: 'direct',
      campaignCode: null,
      rawStartParam: null,
    });
  });

  it('keeps an unusable start_param verbatim but attributes nothing', () => {
    // A code with characters outside the allowed set.
    expect(deriveFirstTouch('c_has spaces!')).toEqual({
      source: 'direct',
      campaignCode: null,
      rawStartParam: 'c_has spaces!',
    });
  });
});

describe('sanitizeCampaignCode', () => {
  it('accepts the allowed set and rejects the rest', () => {
    expect(sanitizeCampaignCode('Launch_01-A')).toBe('launch_01-a');
    expect(sanitizeCampaignCode('has spaces')).toBeNull();
    expect(sanitizeCampaignCode('x'.repeat(65))).toBeNull();
    expect(sanitizeCampaignCode('')).toBeNull();
  });
});

describe('captureFirstTouch immutability', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('captures the first open and ignores every later one', () => {
    setStartParam('first_campaign');
    captureFirstTouch();
    expect(getFirstTouch()).toMatchObject({ campaignCode: 'first_campaign' });

    // A later reopen with a different code must not overwrite it.
    setStartParam('second_campaign');
    captureFirstTouch();
    expect(getFirstTouch()).toMatchObject({ campaignCode: 'first_campaign' });
  });

  it('does not throw when storage is blocked, and reads back null', () => {
    const throwing = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(throwing);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(throwing);

    setStartParam('campaign');
    expect(() => captureFirstTouch()).not.toThrow();
    expect(getFirstTouch()).toBeNull();
  });
});
