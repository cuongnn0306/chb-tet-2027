/**
 * Order pricing (ORD-004, ORD-005). Pure integer math: money is whole VND, never floating point.
 * The database is authoritative (RPC save_draft_order / quote_order); these functions power the
 * live preview in the form and are checked against the database in an integration test.
 *
 * gross = sum(list_price x quantity); net = gross - discount.
 * Customer discount must not exceed the base commission of the order (PRD §19.3).
 */
export interface PricedLine {
  listPrice: number
  quantity: number
  /** Commission rate in percent with up to two decimals, e.g. 7.5. */
  commissionRatePercent: number
}

export function lineGross(listPrice: number, quantity: number): number {
  return listPrice * quantity
}

export function orderGross(lines: readonly PricedLine[]): number {
  return lines.reduce((sum, line) => sum + lineGross(line.listPrice, line.quantity), 0)
}

/** Percent -> basis points (7.5% -> 750) so the math stays in integers. */
function toBasisPoints(percent: number): bigint {
  return BigInt(Math.round(percent * 100))
}

/**
 * Base commission = floor(sum(gross_line x rate / 100)).
 * Floored because the docs do not define rounding: flooring never lets a discount exceed the exact value.
 * Uses BigInt: price x quantity x basis points can exceed Number.MAX_SAFE_INTEGER.
 */
export function baseCommission(lines: readonly PricedLine[]): number {
  const numerator = lines.reduce(
    (sum, line) =>
      sum +
      BigInt(lineGross(line.listPrice, line.quantity)) * toBasisPoints(line.commissionRatePercent),
    0n,
  )
  return Number(numerator / 10_000n)
}

/** Largest discount the order may carry: never above the order value or the base commission. */
export function maxDiscount(lines: readonly PricedLine[]): number {
  return Math.min(baseCommission(lines), orderGross(lines))
}

export type DiscountCheck =
  { ok: true } | { ok: false; reason: 'negative' | 'above_gross' | 'above_commission'; max: number }

export function checkDiscount(discount: number, lines: readonly PricedLine[]): DiscountCheck {
  if (!Number.isInteger(discount) || discount < 0) return { ok: false, reason: 'negative', max: 0 }
  const gross = orderGross(lines)
  if (discount > gross) return { ok: false, reason: 'above_gross', max: gross }
  const ceiling = baseCommission(lines)
  if (discount > ceiling) return { ok: false, reason: 'above_commission', max: ceiling }
  return { ok: true }
}

export interface OrderTotals {
  gross: number
  discount: number
  net: number
  /** What the salesperson keeps: base commission minus the customer discount. */
  finalCommission: number
}

export function orderTotals(lines: readonly PricedLine[], discount: number): OrderTotals {
  const gross = orderGross(lines)
  return {
    gross,
    discount,
    net: gross - discount,
    finalCommission: baseCommission(lines) - discount,
  }
}
