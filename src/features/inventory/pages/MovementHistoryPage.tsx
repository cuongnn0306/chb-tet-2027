import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { DateTimeText } from '@/components/shared/MoneyText'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/fields'
import {
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS,
  type MovementType,
} from '@/domain/inventory/movements'
import { getSupabase } from '@/lib/supabase'
import { MOVEMENT_PAGE_SIZE } from '@/services/inventory.service'
import { createLookupService } from '@/services/lookups.service'
import { useInventoryService } from '../hooks/useInventoryService'

/** INV-009: the inventory ledger, newest first (Admin and Warehouse). Rows are immutable. */
export function MovementHistoryPage() {
  const inventory = useInventoryService()
  const lookups = useMemo(() => createLookupService(getSupabase()), [])
  const [productId, setProductId] = useState('')
  const [type, setType] = useState<'' | MovementType>('')
  const [page, setPage] = useState(0)

  const products = useQuery({ queryKey: ['inventory-products'], queryFn: () => lookups.products() })
  const list = useQuery({
    queryKey: ['inventory-movements', productId, type, page],
    queryFn: () => inventory.listMovements({ productId: productId || undefined, type, page }),
    placeholderData: (previous) => previous,
  })

  const rows = list.data ?? []
  const visible = rows.slice(0, MOVEMENT_PAGE_SIZE)
  const hasNext = rows.length > MOVEMENT_PAGE_SIZE

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Lịch sử xuất nhập kho</h1>
        <p className="text-sm text-slate-600">
          Sổ kho là nguồn sự thật của tồn kho: mỗi thay đổi tồn đều có một dòng ở đây và không
          sửa/xóa được.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Sản phẩm"
          placeholder="Tất cả sản phẩm"
          options={products.data ?? []}
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value)
            setPage(0)
          }}
        />
        <SelectField
          label="Loại"
          placeholder="Tất cả loại"
          options={MOVEMENT_TYPES.map((value) => ({ value, label: MOVEMENT_TYPE_LABELS[value] }))}
          value={type}
          onChange={(e) => {
            setType(e.target.value as '' | MovementType)
            setPage(0)
          }}
        />
      </div>

      {list.isPending ? <LoadingState /> : null}
      {list.isError ? (
        <ErrorState
          title="Không tải được lịch sử kho"
          action={{ label: 'Thử lại', onClick: () => void list.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {list.isSuccess && visible.length === 0 ? <EmptyState title="Chưa có phát sinh nào" /> : null}

      {visible.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Thời gian</th>
                <th className="px-3 py-2 font-medium">Loại</th>
                <th className="px-3 py-2 font-medium">Sản phẩm / Lô</th>
                <th className="px-3 py-2 text-right font-medium">SL</th>
                <th className="px-3 py-2 font-medium">Từ → Đến</th>
                <th className="px-3 py-2 font-medium">Người thực hiện</th>
                <th className="px-3 py-2 font-medium">Lý do</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <DateTimeText value={m.created_at} />
                  </td>
                  <td className="px-3 py-2">
                    {MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type}
                  </td>
                  <td className="px-3 py-2">
                    {m.products?.name}
                    <span className="block font-mono text-xs text-slate-500">
                      {m.products?.sku} · {m.product_batches?.batch_code}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.quantity}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {m.from_location?.code ?? '—'} → {m.to_location?.code ?? '—'}
                  </td>
                  <td className="px-3 py-2">{m.creator?.full_name ?? 'Hệ thống'}</td>
                  <td className="px-3 py-2">{m.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {page > 0 || hasNext ? (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Trang trước
          </Button>
          <span className="text-sm text-slate-600">Trang {page + 1}</span>
          <Button variant="secondary" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
            Trang sau
          </Button>
        </div>
      ) : null}
    </section>
  )
}
