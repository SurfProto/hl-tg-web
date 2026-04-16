function requireBotUsername() {
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME?.trim();
  if (!botUsername) {
    throw new Error("Missing VITE_TELEGRAM_BOT_USERNAME");
  }

  return botUsername.replace(/^@/, "");
}

export function normalizeReferralCode(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  return normalized.replace(/^ref[:_-]?/iu, "").toUpperCase();
}

export function getTelegramStartParam() {
  return window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? null;
}

export function buildTelegramReferralLink(referralCode: string) {
  const normalizedCode = normalizeReferralCode(referralCode);
  const botUsername = requireBotUsername();

  return `https://t.me/${botUsername}?startapp=ref_${normalizedCode}`;
}

export async function openReferralInvite(referralCode: string) {
  const inviteLink = buildTelegramReferralLink(referralCode);
  const telegramWebApp = window.Telegram?.WebApp as
    | (TelegramWebApp & { openTelegramLink?: (url: string) => void })
    | undefined;

  if (telegramWebApp?.openTelegramLink) {
    telegramWebApp.openTelegramLink(inviteLink);
    return "opened";
  }

  if (telegramWebApp?.openLink) {
    telegramWebApp.openLink(inviteLink);
    return "opened";
  }

  await navigator.clipboard.writeText(inviteLink);
  return "copied";
}
