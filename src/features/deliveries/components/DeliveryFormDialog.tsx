import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SelectField, TextAreaField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import {
  DELIVERY_METHODS,
  DELIVERY_METHOD_LABELS,
  SHIPPING_PAYERS,
  SHIPPING_PAYER_LABELS,
  unassignedQuantity,
  validateDeliveryPlan,
  vietnamToday,
  type DeliveryMethod,
  type ShippingPayer,
} from '@/domain/deliveries/deliveries'
import { describeDbError } from '@/lib/db-errors'
import { parseVnd } from '@/lib/money'
import type { OrderDelivery } from '@/services/deliveries.service'
import { useDeliveryService } from '../hooks/useDeliveryService'

export interface PlanOrder {
  id: string
  creationLocationId: string
  items: { id: string; name: string; sku: string; quantity: number }[]
  /** Quantity per order line already assigned to other active deliveries. */
  assigned: Record<string, number>
}

interface Props {
  open: boolean
  order: PlanOrder
  /** When set, the delivery is being edited (only possible while PREPARING). */
  editing: OrderDelivery | null
  onClose: () => void
  onSaved: () => void
}

/** DEL-004/005: choose products, quantities, date, recipient, address, source and shipping fee. */
export function DeliveryFormDialog({ open, order, editing, onClose, onSaved }: Props) {
  return (
    <Dialog
      open={open}
      title={editing ? `Sửa đợt giao ${editing.delivery_code}` : 'Lập đợt giao mới'}
      onClose={onClose}
    >
      {open ? (
        <FormBody
          key={editing?.id ?? 'new'}
          order={order}
          editing={editing}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  )
}

function FormBody({ order, editing, onClose, onSaved }: Omit<Props, 'open'>) {
  const service = useDeliveryService()
  const today = vietnamToday()
  const locations = useQuery({
    queryKey: ['delivery-locations'],
    queryFn: () => service.sourceLocations(),
  })

  const [date, setDate] = useState(editing?.scheduled_date ?? today)
  const [time, setTime] = useState(editing?.scheduled_time?.slice(0, 5) ?? '')
  const [method, setMethod] = useState<DeliveryMethod>(editing?.delivery_method ?? 'CHB_DELIVERY')
  const [name, setName] = useState(editing?.recipient_name ?? '')
  const [phone, setPhone] = useState(editing?.recipient_phone ?? '')
  const [address, setAddress] = useState(editing?.delivery_address ?? '')
  const [sourceId, setSourceId] = useState(editing?.source_location_id ?? order.creationLocationId)
  const [fee, setFee] = useState(editing ? String(editing.shipping_fee) : '0')
  const [payer, setPayer] = useState<ShippingPayer>(editing?.shipping_fee_payer ?? 'CUSTOMER')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [quantities, setQuantities] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const item of order.items) {
      const own = editing?.delivery_items.find((d) => d.order_item_id === item.id)?.quantity
      // A new delivery starts with everything not yet assigned, the usual one-shot case.
      initial[item.id] = String(
        own ?? unassignedQuantity(item.quantity, order.assigned[item.id] ?? 0),
      )
    }
    return initial
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const lines = order.items.map((item) => ({
    item,
    max: unassignedQuantity(item.quantity, order.assigned[item.id] ?? 0),
    quantity: Number(quantities[item.id] ?? '0'),
  }))

  const mutation = useMutation({
    mutationFn: () => {
      const shippingFee = parseVnd(fee).value ?? 0
      return service.save({
        deliveryId: editing?.id ?? null,
        orderId: order.id,
        scheduledDate: date,
        scheduledTime: time || null,
        items: lines
          .filter((l) => l.quantity > 0)
          .map((l) => ({ order_item_id: l.item.id, quantity: l.quantity })),
        recipientName: name.trim(),
        recipientPhone: phone.trim(),
        address: address.trim(),
        sourceLocationId: sourceId,
        method,
        shippingFee,
        shippingFeePayer: payer,
        notes: notes.trim(),
      })
    },
    onSuccess: onSaved,
  })

  function submit() {
    const found = validateDeliveryPlan({
      scheduledDate: date,
      today: editing ? '0000-00-00' : today,
      method,
      address,
      lines: lines.map((l) => ({ quantity: l.quantity, max: l.max, name: l.item.name })),
    })
    if (parseVnd(fee).value === null)
      found.fee = 'Phí giao hàng phải là số tiền VND hợp lệ (nhập 0 nếu không có).'
    setErrors(found)
    if (Object.keys(found).length === 0) mutation.mutate()
  }

  return (
    <div className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto pr-1">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">Sản phẩm giao đợt này</legend>
        {lines.map(({ item, max }) => (
          <div key={item.id} className="grid grid-cols-[1fr_6rem] items-center gap-2 text-sm">
            <label htmlFor={`qty-${item.id}`} className="text-slate-800">
              {item.name} <span className="text-slate-500">({item.sku})</span>
              <span className="block text-xs text-slate-500">
                Đặt {item.quantity} · còn có thể giao thêm {max}
              </span>
            </label>
            <input
              id={`qty-${item.id}`}
              inputMode="numeric"
              className="min-h-11 rounded-md border border-slate-300 px-3 py-2 text-right text-base"
              value={quantities[item.id] ?? ''}
              disabled={max === 0}
              onChange={(e) =>
                setQuantities({ ...quantities, [item.id]: e.target.value.replace(/\D/g, '') })
              }
            />
          </div>
        ))}
        {errors.lines ? <p className="text-sm text-red-700">{errors.lines}</p> : null}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Ngày giao"
          type="date"
          min={editing ? undefined : today}
          value={date}
          error={errors.scheduledDate}
          onChange={(e) => setDate(e.target.value)}
        />
        <TextField
          label="Giờ giao (không bắt buộc)"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>
      <SelectField
        label="Hình thức giao"
        value={method}
        options={DELIVERY_METHODS.map((m) => ({ value: m, label: DELIVERY_METHOD_LABELS[m] }))}
        onChange={(e) => setMethod(e.target.value as DeliveryMethod)}
      />
      <TextField
        label="Người nhận"
        value={name}
        hint="Để trống: lấy theo khách hàng của đơn."
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="Số điện thoại người nhận"
        inputMode="tel"
        value={phone}
        hint="Để trống: lấy theo khách hàng của đơn."
        onChange={(e) => setPhone(e.target.value)}
      />
      <TextField
        label="Địa chỉ giao hàng"
        value={address}
        error={errors.address}
        hint="Để trống: lấy địa chỉ của khách hàng."
        onChange={(e) => setAddress(e.target.value)}
      />
      <SelectField
        label="Kho xuất hàng"
        value={sourceId}
        options={(locations.data ?? []).map((l) => ({
          value: l.id,
          label: `${l.code} · ${l.name}`,
        }))}
        onChange={(e) => setSourceId(e.target.value)}
      />
      <p className="-mt-2 text-xs text-slate-500">
        Hàng phải được phân bổ tại kho xuất này thì mới xuất đi giao được.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Phí giao hàng (₫)"
          inputMode="numeric"
          value={fee}
          error={errors.fee}
          onChange={(e) => setFee(e.target.value)}
        />
        <SelectField
          label="Bên trả phí giao"
          value={payer}
          options={SHIPPING_PAYERS.map((p) => ({ value: p, label: SHIPPING_PAYER_LABELS[p] }))}
          onChange={(e) => setPayer(e.target.value as ShippingPayer)}
        />
      </div>
      <TextAreaField
        label="Ghi chú giao hàng"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as { code?: string; message?: string })}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Quay lại
        </Button>
        <Button loading={mutation.isPending} onClick={submit}>
          {editing ? 'Lưu đợt giao' : 'Lập đợt giao'}
        </Button>
      </div>
    </div>
  )
}
