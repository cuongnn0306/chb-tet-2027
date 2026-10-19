import { describe, expect, it } from 'vitest'
import { validateOrderForm, type OrderFormInput } from '@/domain/orders/form'

const valid: OrderFormInput = {
  customerId: 'c1',
  lines: [
    { productId: 'p1', quantity: '2' },
    { productId: 'p2', quantity: ' 10 ' },
  ],
  discount: '',
  locationId: 'l1',
  channelId: 'ch1',
  sourceId: 's1',
}

describe('validateOrderForm (ORD-006)', () => {
  it('parses a valid form; a blank discount means 0', () => {
    const { errors, parsed } = validateOrderForm(valid)
    expect(errors).toEqual({})
    expect(parsed).toEqual({
      items: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 10 },
      ],
      discountAmount: 0,
    })
  })

  it('parses a VND discount typed with separators', () => {
    expect(validateOrderForm({ ...valid, discount: '50.000' }).parsed?.discountAmount).toBe(50000)
    expect(validateOrderForm({ ...valid, discount: '0' }).parsed?.discountAmount).toBe(0)
  })

  it('requires customer and attribution, in plain Vietnamese', () => {
    const { errors, parsed } = validateOrderForm({
      ...valid,
      customerId: '',
      locationId: '',
      channelId: '',
      sourceId: '',
    })
    expect(parsed).toBeNull()
    expect(Object.keys(errors).sort()).toEqual(['channel', 'customer', 'location', 'source'])
    expect(errors.customer).toMatch(/khách hàng/)
  })

  it('requires at least one product line', () => {
    expect(validateOrderForm({ ...valid, lines: [] }).errors).toHaveProperty('lines')
  })

  it('flags each invalid quantity on its own line', () => {
    const { errors } = validateOrderForm({
      ...valid,
      lines: [
        { productId: 'p1', quantity: '0' },
        { productId: 'p2', quantity: '3' },
        { productId: 'p3', quantity: 'abc' },
        { productId: 'p4', quantity: '1.5' },
        { productId: 'p5', quantity: '' },
      ],
    })
    expect(Object.keys(errors).sort()).toEqual(['line:0', 'line:2', 'line:3', 'line:4'])
  })

  it('rejects a fractional or non-numeric discount', () => {
    expect(validateOrderForm({ ...valid, discount: '12.5' }).errors).toHaveProperty('discount')
    expect(validateOrderForm({ ...valid, discount: 'abc' }).errors).toHaveProperty('discount')
    expect(validateOrderForm({ ...valid, discount: '-5' }).errors).toHaveProperty('discount')
  })
})
