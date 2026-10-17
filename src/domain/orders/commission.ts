/**
 * Per-line commission breakdown (COM-002, PRD §19.1-19.4). Pure integer math: money is whole VND.
 * The database is authoritative (`estimate_order_commission`, and the snapshot taken when an order is
 * first CONFIRMED); this mirrors its rounding for previews and is checked against it in an integration test.
 *
 * commission revenue = list price x quantity (gross line amount); base = revenue x rate;
 * final = base - the line's share of the customer discount.
 *
 * Rounding (fixed, so totals always reconcile): largest-remainder allocation.
 *   - sum(line base) = floor(sum(gross x rate / 100)), the same figure as the discount ceiling (ORD-005);
 *   - sum(line discount share) = the order discount, split by gross line amount.
 * Ties on the remainder go to the lower SKU (byte order), then the lower line id.
 */
export interface CommissionLineInput {
  /** Order item id: last tie-break so the result never depends on input order. */
  id: string
  sku: string
  /** list price x quantity */
  grossLineAmount: number
  /** Commission rate in percent with up to two decimals, e.g. 7.5. */
  ratePercent: number
}

export interface CommissionLine {
  id: string
  sku: string
  commissionRevenue: number
  ratePercent: number
  baseCommission: number
  customerDiscountShare: number
  /** base - discount share; can be negative for one line (e.g. a 0% line carrying part of the discount). */
  finalCommission: number
}

export interface CommissionBreakdown {
  lines: CommissionLine[]
  baseCommission: number
  customerDiscount: number
  finalCommission: number
  /** False when a rate cut left the discount above the base commission (PRD §19.3 would reject the order). */
  discountWithinBaseCommission: boolean
}

interface Weighted {
  index: number
  weight: bigint
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Splits `total` across lines proportionally to `weight / denominator`: every line gets the floor,
 * then the leftover units go one each to the largest remainders (`order` breaks ties).
 */
function allocate(
  total: bigint,
  items: readonly Weighted[],
  denominator: bigint,
  order: readonly number[],
): bigint[] {
  const shares = items.map((item) => (denominator === 0n ? 0n : item.weight / denominator))
  if (denominator === 0n) return shares
  const floored = shares.reduce((sum, share) => sum + share, 0n)
  let leftover = total - floored
  const ranked = [...order].sort((a, b) => {
    const ra = (items[a] as Weighted).weight % denominator
    const rb = (items[b] as Weighted).weight % denominator
    if (ra !== rb) return ra > rb ? -1 : 1
    return 0 // `order` is already the tie-break order and Array.sort is stable
  })
  for (const index of ranked) {
    if (leftover <= 0n) break
    shares[index] = (shares[index] as bigint) + 1n
    leftover -= 1n
  }
  return shares
}

export function commissionBreakdown(
  lines: readonly CommissionLineInput[],
  discount: number,
): CommissionBreakdown {
  // Tie-break order: SKU (byte order), then id.
  const order = lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => compareText(a.line.sku, b.line.sku) || compareText(a.line.id, b.line.id))
    .map((entry) => entry.index)

  const grossTotal = lines.reduce((sum, line) => sum + BigInt(line.grossLineAmount), 0n)

  const baseWeights = lines.map((line, index) => ({
    index,
    weight: BigInt(line.grossLineAmount) * BigInt(Math.round(line.ratePercent * 100)),
  }))
  const baseTarget = baseWeights.reduce((sum, w) => sum + w.weight, 0n) / 10_000n
  const bases = allocate(baseTarget, baseWeights, 10_000n, order)

  const discountWeights = lines.map((line, index) => ({
    index,
    weight: BigInt(discount) * BigInt(line.grossLineAmount),
  }))
  const shares = allocate(BigInt(discount), discountWeights, grossTotal, order)

  const result: CommissionLine[] = order.map((index) => {
    const line = lines[index] as CommissionLineInput
    const base = Number(bases[index])
    const share = Number(shares[index])
    return {
      id: line.id,
      sku: line.sku,
      commissionRevenue: line.grossLineAmount,
      ratePercent: line.ratePercent,
      baseCommission: base,
      customerDiscountShare: share,
      finalCommission: base - share,
    }
  })

  const baseCommission = Number(baseTarget)
  return {
    lines: result,
    baseCommission,
    customerDiscount: discount,
    finalCommission: baseCommission - discount,
    discountWithinBaseCommission: discount <= baseCommission,
  }
}
