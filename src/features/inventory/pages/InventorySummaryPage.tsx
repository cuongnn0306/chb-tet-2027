import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { SelectField } from '@/components/ui/fields'
import { BATCH_VIEW_ROLES } from '@/domain/inventory/movements'
import { useAuth } from '@/features/auth/auth-context'
import { getSupabase } from '@/lib/supabase'
import { createLookupService } from '@/services/lookups.service'
import { useInventoryService } from '../hooks/useInventoryService'

/**
 * INV-007: stock per location and SKU. Sales users see only what they can sell; Admin, Warehouse
 * and Production also see the technical counters (PRD B2.1: progressive disclosure).
 */
export function InventorySummaryPage() {
  const inventory = useInventoryService()
  const lookups = useMemo(() => createLookupService(getSupabase()), [])
  const { access } = useAuth()
  const user = access.status === 'active' ? access.user : null
  const detailed = user !== null && (BATCH_VIEW_ROLES as readonly string[]).includes(user.roleCode)

  const [locationId, setLocationId] = useState(user?.defaultLocationId ?? '')

  const catalog = useQuery({
    queryKey: ['inventory-catalog'],
    queryFn: async () => {
      const [locations, products] = await Promise.all([
        lookups.locations(),
        lookups.activeProducts(),
      ])
      return { locations, products }
    },
  })

  const summary = useQuery({
    queryKey: ['inventory-summary', locationId],
    queryFn: () => inventory.summary(locationId),
    enabled: locationId !== '',
  })

  if (catalog.isPending) return <LoadingState />
  if (catalog.isError) {
    return (
      <ErrorState
        title="Không tải được danh sách kho"
        action={{ label: 'Thử lại', onClick: () => void catalog.refetch() }}
      >
        Vui lòng kiểm tra kết nối mạng rồi thử lại.
      </ErrorState>
    )
  }

  const byProduct = new Map((summary.data ?? []).map((row) => [row.product_id, row]))

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Tồn kho</h1>
        <p className="text-sm text-slate-600">
          “Có thể bán” đã trừ hàng đang giữ cho đơn và mức tồn an toàn.
        </p>
      </header>

      <SelectField
        label="Địa điểm"
        placeholder="Chọn địa điểm…"
        options={catalog.data.locations}
        value={locationId}
        onChange={(e) => setLocationId(e.target.value)}
      />

      {locationId === '' ? <EmptyState title="Chọn một địa điểm để xem tồn kho" /> : null}
      {locationId !== '' && summary.isPending ? <LoadingState /> : null}
      {summary.isError ? (
        <ErrorState
          title="Không tải được tồn kho"
          action={{ label: 'Thử lại', onClick: () => void summary.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}

      {summary.isSuccess ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Sản phẩm</th>
                <th className="px-3 py-2 text-right font-medium">Có thể bán</th>
                {detailed ? (
                  <>
                    <th className="px-3 py-2 text-right font-medium">Sẵn có</th>
                    <th className="px-3 py-2 text-right font-medium">Đang giữ</th>
                    <th className="px-3 py-2 text-right font-medium">Tồn an toàn</th>
                    <th className="px-3 py-2 text-right font-medium">Hết hạn</th>
                    <th className="px-3 py-2 text-right font-medium">Đang chuyển</th>
                    <th className="px-3 py-2 text-right font-medium">Chờ kiểm tra</th>
                    <th className="px-3 py-2 text-right font-medium">Hỏng</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {catalog.data.products.map((product) => {
                const row = byProduct.get(product.id)
                const sellable = row?.sellable_qty ?? 0
                return (
                  <tr key={product.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      {product.name}
                      <span className="block font-mono text-xs text-slate-500">{product.sku}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {sellable > 0 ? (
                        <span className="font-semibold text-green-800">
                          {sellable.toLocaleString('vi-VN')}
                        </span>
                      ) : (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          Hết hàng
                        </span>
                      )}
                    </td>
                    {detailed ? (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row?.available_qty ?? 0}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row?.reserved_qty ?? 0}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row?.safety_stock_qty ?? 0}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row?.expired_qty ?? 0}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row?.in_transfer_qty ?? 0}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row?.pending_inspection_qty ?? 0}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row?.damaged_qty ?? 0}
                        </td>
                      </>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
