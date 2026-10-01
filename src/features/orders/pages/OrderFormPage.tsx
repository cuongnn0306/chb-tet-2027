import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ROUTES } from '@/app/routes'
import { MoneyText } from '@/components/shared/MoneyText'
import { ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { CheckboxField, SelectField, TextAreaField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import { validateOrderForm, type LineInput } from '@/domain/orders/form'
import { shortageMessage } from '@/domain/inventory/shortage'
import { baseCommission, orderGross, type PricedLine } from '@/domain/orders/pricing'
import { useAuth } from '@/features/auth/auth-context'
import { CustomerPicker } from '@/features/customers/components/CustomerPicker'
import { useCustomerService } from '@/features/customers/hooks/useCustomerService'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { describeDbError } from '@/lib/db-errors'
import { formatVnd } from '@/lib/money'
import { getSupabase } from '@/lib/supabase'
import type { Customer } from '@/services/customers.service'
import { createLookupService } from '@/services/lookups.service'
import { OrderLinesEditor } from '../components/OrderLinesEditor'
import { useOrderService } from '../hooks/useOrderService'

/** Create (/orders/new) or edit a draft (/orders/:id/edit). Fastest path: customer, products, qty, save. */
export function OrderFormPage() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const service = useOrderService()
  const customers = useCustomerService()
  const lookups = useMemo(() => createLookupService(getSupabase()), [])
  const { access } = useAuth()
  const me = access.status === 'active' ? access.user : null
  const isAdmin = me?.roleCode === 'ADMIN'

  const catalog = useQuery({
    queryKey: ['order-form-catalog'],
    queryFn: async () => {
      const [products, attribution, profiles] = await Promise.all([
        lookups.activeProducts(),
        lookups.activeAttribution(),
        isAdmin ? lookups.profiles() : Promise.resolve([]),
      ])
      return { products, attribution, profiles }
    },
  })

  const existing = useQuery({
    queryKey: ['order-draft', orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const order = await service.get(orderId as string)
      const customer = order ? await customers.get(order.customer_id) : null
      return { order, customer }
    },
  })

  if (catalog.isPending || (orderId && existing.isPending)) return <LoadingState />
  if (catalog.isError || existing.isError) {
    return (
      <ErrorState
        title="Không tải được dữ liệu để tạo đơn"
        action={{
          label: 'Thử lại',
          onClick: () => {
            void catalog.refetch()
            void existing.refetch()
          },
        }}
      >
        Vui lòng kiểm tra kết nối mạng rồi thử lại.
      </ErrorState>
    )
  }
  if (orderId && !existing.data?.order) {
    return (
      <ErrorState title="Không tìm thấy đơn hàng">
        Đơn không tồn tại hoặc bạn không có quyền xem.
      </ErrorState>
    )
  }
  if (existing.data?.order && existing.data.order.status !== 'DRAFT') {
    return (
      <ErrorState title="Đơn này không còn là đơn nháp">
        Đơn đã gửi/xác nhận không được sửa khách hàng, số lượng hay giá. Muốn đổi, hãy hủy đơn cũ và
        tạo đơn mới.{' '}
        <Link className="underline" to={ROUTES.orderDetail(existing.data.order.id)}>
          Xem đơn
        </Link>
      </ErrorState>
    )
  }

  return (
    <OrderFormBody
      key={orderId ?? 'new'}
      catalog={catalog.data}
      draft={
        existing.data?.order
          ? { order: existing.data.order, customer: existing.data.customer }
          : null
      }
      defaults={{
        location: me?.defaultLocationId ?? '',
        channel: me?.defaultSalesChannelId ?? '',
        source: me?.defaultLeadSourceId ?? '',
      }}
      isAdmin={isAdmin}
      ownerName={me?.fullName ?? ''}
      onDone={(id) => void navigate(ROUTES.orderDetail(id))}
      service={service}
    />
  )
}

type Catalog = {
  products: Awaited<ReturnType<ReturnType<typeof createLookupService>['activeProducts']>>
  attribution: Awaited<ReturnType<ReturnType<typeof createLookupService>['activeAttribution']>>
  profiles: { value: string; label: string }[]
}

interface BodyProps {
  catalog: Catalog
  draft: {
    order: NonNullable<Awaited<ReturnType<ReturnType<typeof useOrderService>['get']>>>
    customer: Customer | null
  } | null
  defaults: { location: string; channel: string; source: string }
  isAdmin: boolean
  ownerName: string
  onDone: (orderId: string) => void
  service: ReturnType<typeof useOrderService>
}

function OrderFormBody({
  catalog,
  draft,
  defaults,
  isAdmin,
  ownerName,
  onDone,
  service,
}: BodyProps) {
  const order = draft?.order ?? null
  const [customer, setCustomer] = useState<Customer | null>(draft?.customer ?? null)
  const [lines, setLines] = useState<LineInput[]>(
    order?.order_items.map((i) => ({ productId: i.product_id, quantity: String(i.quantity) })) ??
      [],
  )
  const [discount, setDiscount] = useState(
    order && order.discount_amount > 0 ? String(order.discount_amount) : '',
  )
  const [locationId, setLocationId] = useState(order?.creation_location_id ?? defaults.location)
  const [channelId, setChannelId] = useState(order?.sales_channel_id ?? defaults.channel)
  const [sourceId, setSourceId] = useState(order?.lead_source_id ?? defaults.source)
  const [ownerId, setOwnerId] = useState(order?.owner_user_id ?? '')
  const [requiresInvoice, setRequiresInvoice] = useState(order?.requires_invoice ?? false)
  const [notes, setNotes] = useState(order?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savedId, setSavedId] = useState<string | null>(order?.id ?? null)

  const productById = useMemo(
    () => new Map(catalog.products.map((p) => [p.id, p])),
    [catalog.products],
  )

  // Live quote (server): commission rates and the discount ceiling. Sales cannot read commission rules.
  const quoteItems = useMemo(
    () =>
      lines
        .filter((l) => /^[1-9]\d{0,8}$/.test(l.quantity.trim()))
        .map((l) => ({ productId: l.productId, quantity: Number(l.quantity.trim()) })),
    [lines],
  )
  const debouncedItems = useDebouncedValue(quoteItems, 300)
  const quote = useQuery({
    queryKey: ['order-quote', JSON.stringify(debouncedItems), ownerId],
    enabled: debouncedItems.length > 0,
    queryFn: () => service.quote(debouncedItems, ownerId || null),
    placeholderData: (previous) => previous,
  })

  // RES-009: warn (never block) when the chosen location cannot cover the lines, and say where to get stock.
  const stockCheck = useQuery({
    queryKey: ['order-form-stock', locationId, JSON.stringify(debouncedItems)],
    enabled: debouncedItems.length > 0 && locationId !== '',
    queryFn: () => service.checkStock(locationId, debouncedItems),
    placeholderData: (previous) => previous,
  })

  // Effect-free derived totals from what is typed now, using the rates of the latest quote.
  const pricedLines: PricedLine[] = useMemo(() => {
    const rates = new Map(
      (quote.data?.lines ?? []).map((l) => [l.product_id, Number(l.commission_rate)]),
    )
    return quoteItems.flatMap((item) => {
      const product = productById.get(item.productId)
      return product
        ? [
            {
              listPrice: product.listPrice,
              quantity: item.quantity,
              commissionRatePercent: rates.get(item.productId) ?? 0,
            },
          ]
        : []
    })
  }, [quoteItems, quote.data, productById])

  const gross = orderGross(pricedLines)
  const maxDiscount = quote.data ? Math.min(baseCommission(pricedLines), gross) : null
  const typedDiscount = Number(discount.replace(/[.,\s]/g, '')) || 0
  const net = gross - typedDiscount

  const [serverError, setServerError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async (andSubmit: boolean) => {
      const { errors: found, parsed } = validateOrderForm({
        customerId: customer?.id ?? '',
        lines,
        discount,
        locationId,
        channelId,
        sourceId,
      })
      if (!parsed) throw new FormError(found)
      if (maxDiscount !== null && parsed.discountAmount > maxDiscount) {
        throw new FormError({
          discount: `Giảm giá tối đa ${formatVnd(maxDiscount)} cho đơn này (không vượt hoa hồng).`,
        })
      }
      const saved = await service.saveDraft({
        orderId: savedId,
        customerId: customer?.id as string,
        items: parsed.items,
        discountAmount: parsed.discountAmount,
        ownerUserId: isAdmin && ownerId ? ownerId : null,
        creationLocationId: locationId,
        salesChannelId: channelId,
        leadSourceId: sourceId,
        requiresInvoice,
        notes,
      })
      setSavedId(saved.id)
      if (andSubmit) {
        try {
          await service.transition(saved.id, 'submit')
        } catch (error) {
          throw new SubmitAfterSaveError(
            saved.id,
            describeDbError(error as { code?: string; message?: string }),
          )
        }
      }
      return saved
    },
    onMutate: () => {
      setErrors({})
      setServerError(null)
    },
    onSuccess: (saved) => onDone(saved.id),
    onError: (error) => {
      if (error instanceof FormError) setErrors(error.fields)
      else if (error instanceof SubmitAfterSaveError) {
        setServerError(`Đã lưu nháp nhưng chưa gửi được đơn: ${error.message}`)
      } else setServerError(describeDbError(error as { code?: string; message?: string }))
    },
  })

  // Scroll to the first problem so mobile users see why nothing happened.
  useEffect(() => {
    if (Object.keys(errors).length > 0)
      document
        .querySelector('[aria-invalid="true"], [role="alert"]')
        ?.scrollIntoView({ block: 'center' })
  }, [errors])

  return (
    <form
      className="mx-auto flex max-w-3xl flex-col gap-6 pb-24"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(false)
      }}
      noValidate
    >
      <header>
        <h1 className="text-xl font-semibold text-slate-900">
          {order ? `Sửa đơn nháp ${order.order_code}` : 'Tạo đơn hàng'}
        </h1>
        <p className="text-sm text-slate-600">Khách hàng → Sản phẩm → Số lượng → Lưu.</p>
      </header>

      <Section title="1. Khách hàng">
        <CustomerPicker value={customer} onChange={setCustomer} error={errors.customer} />
      </Section>

      <Section title="2. Sản phẩm và số lượng">
        <OrderLinesEditor
          products={catalog.products}
          lines={lines}
          onChange={setLines}
          errors={errors}
        />
        {(stockCheck.data ?? []).map((line) => {
          const message = shortageMessage(line)
          if (!message) return null
          const name = productById.get(line.product_id)?.name ?? 'Sản phẩm'
          return (
            <p
              key={line.product_id}
              role="status"
              className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"
            >
              <strong>{name}:</strong> {message} Bạn vẫn có thể lưu đơn.
            </p>
          )
        })}
      </Section>

      <Section title="3. Thông tin đơn">
        <p className="text-sm text-slate-600">
          Người phụ trách: <strong>{ownerName}</strong>. Các mục dưới đây đã điền sẵn theo hồ sơ của
          bạn.
        </p>
        {isAdmin ? (
          <SelectField
            label="Người phụ trách (Admin tạo hộ)"
            placeholder="Chính tôi"
            options={catalog.profiles}
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
          />
        ) : null}
        <SelectField
          label="Điểm tạo đơn"
          placeholder="Chọn…"
          options={catalog.attribution.locations}
          value={locationId}
          error={errors.location}
          onChange={(e) => setLocationId(e.target.value)}
        />
        <SelectField
          label="Kênh bán"
          placeholder="Chọn…"
          options={catalog.attribution.channels}
          value={channelId}
          error={errors.channel}
          onChange={(e) => setChannelId(e.target.value)}
        />
        <SelectField
          label="Nguồn khách"
          placeholder="Chọn…"
          options={catalog.attribution.sources}
          value={sourceId}
          error={errors.source}
          onChange={(e) => setSourceId(e.target.value)}
        />
        <CheckboxField
          label="Khách cần xuất hóa đơn"
          checked={requiresInvoice}
          onChange={setRequiresInvoice}
        />
        <TextAreaField label="Ghi chú" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Section>

      <Section title="4. Giảm giá và thanh toán">
        <TextField
          label="Giảm giá cho khách (₫)"
          inputMode="numeric"
          value={discount}
          error={errors.discount}
          hint={
            maxDiscount !== null
              ? `Tối đa ${formatVnd(maxDiscount)} (không được vượt hoa hồng của đơn).`
              : 'Thêm sản phẩm để biết mức giảm tối đa.'
          }
          onChange={(e) => setDiscount(e.target.value)}
        />
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-slate-100 p-3 text-sm">
          <dt>Giá niêm yết</dt>
          <dd className="text-right">
            <MoneyText amount={gross} />
          </dd>
          <dt>Giảm giá</dt>
          <dd className="text-right">
            <MoneyText amount={typedDiscount} />
          </dd>
          <dt className="font-semibold">Khách phải trả</dt>
          <dd className="text-right font-semibold">
            <MoneyText amount={Math.max(net, 0)} />
          </dd>
          {maxDiscount !== null ? (
            <>
              <dt className="text-slate-600">Hoa hồng bạn nhận (dự kiến)</dt>
              <dd className="text-right text-slate-600">
                <MoneyText amount={Math.max(baseCommission(pricedLines) - typedDiscount, 0)} />
              </dd>
            </>
          ) : null}
        </dl>
      </Section>

      {serverError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {serverError}{' '}
          {savedId ? (
            <Link className="underline" to={ROUTES.orderDetail(savedId)}>
              Mở đơn đã lưu
            </Link>
          ) : null}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-10 flex justify-end gap-2 border-t border-slate-200 bg-white p-3">
        <Link
          to={order ? ROUTES.orderDetail(order.id) : ROUTES.orders}
          className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 text-slate-800"
        >
          Hủy
        </Link>
        <Button type="submit" variant="secondary" loading={save.isPending}>
          Lưu nháp
        </Button>
        <Button type="button" loading={save.isPending} onClick={() => save.mutate(true)}>
          Lưu và gửi đơn
        </Button>
      </div>
    </form>
  )
}

class FormError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('Dữ liệu chưa hợp lệ')
  }
}

class SubmitAfterSaveError extends Error {
  constructor(
    readonly orderId: string,
    message: string,
  ) {
    super(message)
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}
