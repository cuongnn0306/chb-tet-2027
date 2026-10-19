/**
 * Per-line commission breakdown (COM-002, PRD §19.1-19.4, Owner decision 17/10/2026). Pure integer math: money is
 * whole VND. The database is authoritative (`estimate_order_commission`, and the snapshot taken when an order is
 * first CONFIRMED); this mirrors its rounding for previews and is checked against it in an integration test.
 *
 * commission revenue = list price x quantity (gross line amount); base = revenue x rate.
 *
 * Three distinct figures per line, so returns can still use the exact customer discount:
 *   - customerDiscountShare: the line's share of the order discount (split by gross line amount). Always
 *     sums to the order discount.
 *   - commissionDeduction: the part of the discount the employee's commission pays for on that line,
 *     0 <= deduction <= base. Sums to min(discount, base total).
 *   - payableCommission = base - deduction >= 0, never negative.
 * Whatever the commission cannot fund is borne by the company (`companyBorneExcess`, order level):
 *   discount = sum(commissionDeduction) + companyBorneExcess, exactly.
 *
 * Rounding (fixed, so totals always reconcile): largest-remainder allocation.
 *   1. base: sum(line base) = floor(sum(gross x rate / 100)), the same figure as the discount ceiling (ORD-005).
 *   2. discount share: split by gross line amount, sum = order discount.
 *   3. deduction: start from min(share, base) per line; the remaining funded amount
 *      (min(discount, base total) - sum of those) is spread over each line's remaining room
 *      (base - min(share, base)), proportionally, largest remainder first.
 * Ties on a remainder go to the lower SKU (byte order), then the lower line id.
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
  /** Customer-facing discount attributed to the line (used for returns). */
  customerDiscountShare: number
  /** Discount funded by this line's commission: 0 <= deduction <= base. */
  commissionDeduction: number
  /** base - deduction: what the employee can be paid for the line. Never negative. */
  payableCommission: number
}

export interface CommissionBreakdown {
  lines: CommissionLine[]
  baseCommission: number
  customerDiscount: number
  /** Sum of line deductions = min(discount, base). */
  commissionFundedDiscount: number
  /** Discount the commission cannot fund: discount - base when positive, else 0. */
  companyBorneExcess: number
  /** Sum of payable commissions = base - funded discount. Zero when the company bears an excess. */
  payableCommission: number
  /** False when the discount exceeds the base commission: needs the Admin exception before payout. */
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

const minOf = (a: bigint, b: bigint) => (a < b ? a : b)

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
  const discountBig = BigInt(discount)

  const baseWeights = lines.map((line, index) => ({
    index,
    weight: BigInt(line.grossLineAmount) * BigInt(Math.round(line.ratePercent * 100)),
  }))
  const baseTarget = baseWeights.reduce((sum, w) => sum + w.weight, 0n) / 10_000n
  const bases = allocate(baseTarget, baseWeights, 10_000n, order)

  const discountWeights = lines.map((line, index) => ({
    index,
    weight: discountBig * BigInt(line.grossLineAmount),
  }))
  const shares = allocate(discountBig, discountWeights, grossTotal, order)

  // Commission-funded part: first the line's own share (capped by its base), then spread the rest over room.
  const funded = minOf(discountBig, baseTarget)
  const own = lines.map((_, index) => minOf(shares[index] as bigint, bases[index] as bigint))
  const room = lines.map((_, index) => (bases[index] as bigint) - (own[index] as bigint))
  const roomTotal = room.reduce((sum, r) => sum + r, 0n)
  const remaining = funded - own.reduce((sum, o) => sum + o, 0n)
  const extra = allocate(
    remaining,
    room.map((weight, index) => ({ index, weight: remaining * weight })),
    roomTotal,
    order,
  )

  const result: CommissionLine[] = order.map((index) => {
    const line = lines[index] as CommissionLineInput
    const base = bases[index] as bigint
    const deduction = (own[index] as bigint) + (extra[index] as bigint)
    return {
      id: line.id,
      sku: line.sku,
      commissionRevenue: line.grossLineAmount,
      ratePercent: line.ratePercent,
      baseCommission: Number(base),
      customerDiscountShare: Number(shares[index]),
      commissionDeduction: Number(deduction),
      payableCommission: Number(base - deduction),
    }
  })

  return {
    lines: result,
    baseCommission: Number(baseTarget),
    customerDiscount: discount,
    commissionFundedDiscount: Number(funded),
    companyBorneExcess: Number(discountBig - funded),
    payableCommission: Number(baseTarget - funded),
    discountWithinBaseCommission: discountBig <= baseTarget,
  }
}
