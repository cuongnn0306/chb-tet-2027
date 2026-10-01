# Order detail: add the stock panel
p = "src/features/orders/pages/OrderDetailPage.tsx"
s = open(p, encoding="utf-8").read()
s = s.replace("import { OrderStatusBadge } from '../components/OrderStatusBadge'", "import { OrderStatusBadge } from '../components/OrderStatusBadge'\nimport { OrderStockPanel } from '../components/OrderStockPanel'", 1)
marker = '      <section className="rounded-lg border border-slate-200 bg-white p-4 print:hidden">\n        <h2 className="mb-3 font-semibold text-slate-900">Lịch sử đơn hàng</h2>'
assert marker in s
panel = """      <OrderStockPanel
        orderId={data.id}
        orderCode={data.order_code}
        status={data.status}
        canAllocate={isAdmin}
        onAllocated={() => {
          void queryClient.invalidateQueries({ queryKey: ['order', orderId] })
          void queryClient.invalidateQueries({ queryKey: ['order-history', orderId] })
          void queryClient.invalidateQueries({ queryKey: ['orders'] })
        }}
      />

"""
s = s.replace(marker, panel + marker, 1)
# the transition done-callback should also refresh the stock panel
s = s.replace("          void queryClient.invalidateQueries({ queryKey: ['orders'] })\n        }}\n      />\n    </article>", "          void queryClient.invalidateQueries({ queryKey: ['orders'] })\n          void queryClient.invalidateQueries({ queryKey: ['order-stock', orderId] })\n        }}\n      />\n    </article>", 1)
open(p, "w", encoding="utf-8").write(s)

# Order form: live shortage warning
p = "src/features/orders/pages/OrderFormPage.tsx"
s = open(p, encoding="utf-8").read()
s = s.replace("import { baseCommission, orderGross, type PricedLine } from '@/domain/orders/pricing'", "import { shortageMessage } from '@/domain/inventory/shortage'\nimport { baseCommission, orderGross, type PricedLine } from '@/domain/orders/pricing'", 1)
anchor = "  // Effect-free derived totals from what is typed now, using the rates of the latest quote."
assert anchor in s
stock = """  // RES-009: warn (never block) when the chosen location cannot cover the lines, and say where to get stock.
  const stockCheck = useQuery({
    queryKey: ['order-form-stock', locationId, JSON.stringify(debouncedItems)],
    enabled: debouncedItems.length > 0 && locationId !== '',
    queryFn: () => service.checkStock(locationId, debouncedItems),
    placeholderData: (previous) => previous,
  })

"""
s = s.replace(anchor, stock + anchor, 1)
warn_anchor = '        <OrderLinesEditor products={catalog.products} lines={lines} onChange={setLines} errors={errors} />\n'
assert warn_anchor in s
warn = warn_anchor + """        {(stockCheck.data ?? []).map((line) => {
          const message = shortageMessage(line)
          if (!message) return null
          const name = productById.get(line.product_id)?.name ?? 'Sản phẩm'
          return (
            <p key={line.product_id} role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <strong>{name}:</strong> {message} Bạn vẫn có thể lưu đơn.
            </p>
          )
        })}
"""
s = s.replace(warn_anchor, warn, 1)
open(p, "w", encoding="utf-8").write(s)
