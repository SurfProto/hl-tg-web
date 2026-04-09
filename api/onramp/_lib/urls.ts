export function buildReturnUrl(baseUrl: string, externalOrderId: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("onramp_external_order_id", externalOrderId);
  return url.toString();
}
