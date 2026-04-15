import type { PendingNotificationEvent } from "./types";

function formatNumber(value: unknown, digits = 2): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "0";
  }

  return value.toFixed(digits);
}

function formatFill(event: PendingNotificationEvent): string {
  const language = event.language.toLowerCase();
  const coin = String(event.payload.coin ?? "");
  const side = String(event.payload.side ?? "");
  const size = formatNumber(Number(event.payload.sz), 4);
  const price = formatNumber(Number(event.payload.px), 2);

  if (language === "ru") {
    return `Исполнение ордера: ${coin} ${side} ${size} по ${price}`;
  }

  return `Order fill: ${coin} ${side} ${size} @ ${price}`;
}

function formatLiquidation(event: PendingNotificationEvent): string {
  const language = event.language.toLowerCase();
  const coin = String(event.payload.coin ?? "");
  const band = String(event.payload.band ?? "");
  const markPx = formatNumber(Number(event.payload.markPx), 2);
  const liquidationPx = formatNumber(Number(event.payload.liquidationPx), 2);

  if (language === "ru") {
    return `Риск ликвидации ${coin}: осталось ${band}% до ликвидации. Mark ${markPx}, liquidation ${liquidationPx}`;
  }

  return `Liquidation risk on ${coin}: within ${band}% of liquidation. Mark ${markPx}, liquidation ${liquidationPx}`;
}

function formatDeposit(event: PendingNotificationEvent): string {
  const language = event.language.toLowerCase();
  const amount = String(event.payload.payoutAmount ?? "");
  const currency = String(event.payload.payoutCurrency ?? "USDC");

  if (language === "ru") {
    return `Депозит завершён: ${amount} ${currency} зачислены.`;
  }

  return `Deposit complete: ${amount} ${currency} credited.`;
}

export function buildTelegramMessage(event: PendingNotificationEvent): string {
  switch (event.topic) {
    case "liquidation_risk":
      return formatLiquidation(event);
    case "usdc_deposit":
      return formatDeposit(event);
    case "order_fill":
    default:
      return formatFill(event);
  }
}
