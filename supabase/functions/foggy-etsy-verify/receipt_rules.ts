// Pure receipt decision logic shared by production validation and mocked tests.
// This never authorizes an order unless payment status and listing both match.
export function evaluateFoggyReceipt(
  receipt: { status?: unknown; transactions?: unknown } | null,
  foggyListingId: string,
): { ok: boolean; error?: string; status?: string } {
  if (!receipt) return { ok: false, error: 'ORDER_NOT_FOUND' }
  const status = String(receipt.status || '').toLowerCase()
  if (!['paid','completed'].includes(status)) {
    return { ok: false, error: status === 'canceled' ? 'ORDER_CANCELED' : 'ORDER_NOT_PAID' }
  }
  if (!foggyListingId) return { ok: false, error: 'FOGGY_LISTING_NOT_CONFIGURED' }
  const transactions = Array.isArray(receipt.transactions) ? receipt.transactions : []
  if (!transactions.some((t: { listing_id?: unknown }) => String(t?.listing_id || '') === foggyListingId)) {
    return { ok: false, error: 'FOGGY_NOT_IN_ORDER' }
  }
  return { ok: true, status }
}
