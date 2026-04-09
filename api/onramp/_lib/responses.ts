import { getSymbolCurrencies, type OnrampConfig } from "./config";
import { normalizeOrderState } from "./normalize";
import type { ProviderOrder, ProviderQuote } from "./provider";
import type { OnrampOrderStatus, OnrampQuote } from "./types";

function normalizePayoutCurrency(config: OnrampConfig, providerCurrency: string): string {
  const appCurrencies = getSymbolCurrencies(config.appSymbol);
  const providerCurrencies = getSymbolCurrencies(config.providerSymbol);

  if (providerCurrency === providerCurrencies.payoutCurrency) {
    return appCurrencies.payoutCurrency;
  }

  return providerCurrency;
}

export function toQuoteResponse(config: OnrampConfig, quote: ProviderQuote): OnrampQuote {
  return {
    symbol: config.appSymbol,
    payinAmount: String(quote.payin_breakdown.amount),
    payinCurrency: quote.payin_breakdown.currency,
    payoutAmount: String(quote.payout_breakdown.amount),
    payoutCurrency: normalizePayoutCurrency(config, quote.payout_breakdown.currency),
  };
}

export function toOrderStatus(config: OnrampConfig, order: ProviderOrder): OnrampOrderStatus {
  const { payinCurrency, payoutCurrency } = getSymbolCurrencies(config.appSymbol);

  return {
    id: order.id,
    externalOrderId: order.external_order_id,
    serviceId: order.service_id,
    providerState: order.state,
    appState: normalizeOrderState(order.state),
    payinAmount: order.payin_amount,
    payinCurrency,
    payoutAmount: order.payout_amount,
    payoutCurrency,
    feeAmount: order.fee ?? null,
    invoiceUrl: order.invoice_url,
    invoiceUrlExpiresAt: order.invoice_url_expires_at,
    errorCode: null,
    errorMessage: null,
    lastSyncedAt: order.touched_at ?? order.created_at,
  };
}
