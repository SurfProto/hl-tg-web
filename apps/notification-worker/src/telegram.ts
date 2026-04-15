import type { TelegramClient, TelegramSendResult } from "./types";

export function createTelegramClient(botToken: string): TelegramClient {
  return {
    async sendMessage({ target, text }): Promise<TelegramSendResult> {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: target,
            text,
            disable_web_page_preview: true,
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        error_code?: number;
        parameters?: {
          retry_after?: number;
        };
      };

      if (response.ok && payload.ok) {
        return { ok: true };
      }

      return {
        ok: false,
        code: payload.error_code ?? response.status,
        description: payload.description ?? "Telegram send failed",
        retryAfterSeconds: payload.parameters?.retry_after,
      };
    },
  };
}
