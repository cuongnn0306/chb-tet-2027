import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/fields'
import { businessDate, expiryStatus } from '@/domain/inventory/movements'
import { useAuth } from '@/features/auth/auth-context'
import { formatDate } from '@/lib/date'
import { describeDbError } from '@/lib/db-errors'
import { getSupabase } from '@/lib/supabase'
import type { BalanceMismatch, BalanceRow } from '@/services/inventory.service'
import { createLookupService } from '@/services/lookups.service'
import { BatchFormDialog } from '../components/BatchFormDialog'
import {
  StockMoveDialog,
  type StockMoveMode,
  type StockMovePreset,
} from '../components/StockMoveDialog'
import { useInventoryService } from '../hooks/useInventoryService'

/** INV-008: stock per batch, with the Admin/Warehouse actions (INV-001, 005, 010, 011). */
export function BatchStockPage() {
  const inventory = useInventoryService()
  const lookups = useMemo(() => createLookupService(getSupabase()), [])
  const queryClient = useQueryClient()
  const { access } = useAuth()
  const role = access.status === 'active' ? access.user.roleCode : null
  const isAdmin = role === 'ADMIN'
  const canWrite = role === 'ADMIN' || role === 'WAREHOUSE'

  const [locationId, setLocationId] = useState('')
  const [productId, setProductId] = useState('')
  const [creatingBatch, setCreatingBatch] = useState(false)
  const [move, setMove] = useState<{ mode: StockMoveMode; preset: StockMovePreset | null } | null>(
    null,
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [reconciliation, setReconciliation] = useState<
    { mismatches: BalanceMismatch[] } | { error: string } | null
  >(null)

  const catalog = useQuery({
    queryKey: ['inventory-batch-catalog'],
    queryFn: async () => {
      const [locations, products, batches] = await Promise.all([
        lookups.locations(),
        lookups.products(),
        inventory.listBatches(),
      ])
      return { locations, products, batches }
    },
  })
  const balances = useQuery({
    queryKey: ['inventory-balances', locationId, productId],
    queryFn: () =>
      inventory.listBalances({
        locationId: locationId || undefined,
        productId: productId || undefined,
      }),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory-balances'] })
    void queryClient.invalidateQueries({ queryKey: ['inventory-batch-catalog'] })
    void queryClient.invalidateQueries({ queryKey: ['inventory-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['inventory-movements'] })
  }

  async function reconcile() {
    try {
      setReconciliation({ mismatches: await inventory.verifyBalances() })
    } catch (error) {
      setReconciliation({ error: describeDbError(error as { code?: string; message?: string }) })
    }
  }

  if (catalog.isPending) return <LoadingState />
  if (catalog.isError) {
    return (
      <ErrorState
        title="Không tải được dữ liệu kho"
        action={{ label: 'Thử lại', onClick: () => void catalog.refetch() }}
      >
        Vui lòng kiểm tra kết nối mạng rồi thử lại.
      </ErrorState>
    )
  }
  const today = businessDate()
  const presetFor = (row: BalanceRow): StockMovePreset => ({
    locationId: row.location_id,
    productId: row.product_id,
    batchId: row.batch_id,
    label: `${row.products?.sku ?? ''} · Lô ${row.product_batches?.batch_code ?? ''} · ${row.locations?.code ?? ''} · đang có ${row.available_qty - row.reserved_qty} khả dụng`,
  })

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Tồn kho theo lô</h1>
          <p className="text-sm text-slate-600">
            Mỗi dòng là một lô tại một địa điểm. Hàng gần hết hạn được xuất trước (FEFO).
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setCreatingBatch(true)}>
              Tạo lô
            </Button>
            {isAdmin ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setMove({ mode: 'opening', preset: null })}
                >
                  Nhập tồn đầu kỳ
                </Button>
                <Button variant="secondary" onClick={() => void reconcile()}>
                  Đối chiếu sổ kho
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </header>

      {notice ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      ) : null}
      {reconciliation && 'error' in reconciliation ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {reconciliation.error}
        </p>
      ) : null}
      {reconciliation && 'mismatches' in reconciliation ? (
        reconciliation.mismatches.length === 0 ? (
          <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
            Đối chiếu xong: tồn kho khớp hoàn toàn với sổ kho.
          </p>
        ) : (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            Phát hiện {reconciliation.mismatches.length} dòng lệch giữa tồn kho và sổ kho. Hãy báo
            kỹ thuật kiểm tra ngay.
          </p>
        )
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Địa điểm"
          placeholder="Tất cả địa điểm"
          options={catalog.data.locations}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        />
        <SelectField
          label="Sản phẩm"
          placeholder="Tất cả sản phẩm"
          options={catalog.data.products}
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        />
      </div>

      {balances.isPending ? <LoadingState /> : null}
      {balances.isError ? (
        <ErrorState
          title="Không tải được tồn theo lô"
          action={{ label: 'Thử lại', onClick: () => void balances.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {balances.isSuccess && balances.data.length === 0 ? (
        <EmptyState title="Chưa có tồn kho nào" />
      ) : null}

      {balances.isSuccess && balances.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Sản phẩm</th>
                <th className="px-3 py-2 font-medium">Lô</th>
                <th className="px-3 py-2 font-medium">Địa điểm</th>
                <th className="px-3 py-2 font-medium">Hạn sử dụng</th>
                <th className="px-3 py-2 text-right font-medium">Sẵn có</th>
                <th className="px-3 py-2 text-right font-medium">Đang giữ</th>
                <th className="px-3 py-2 text-right font-medium">Đang chuyển</th>
                <th className="px-3 py-2 text-right font-medium">Chờ kiểm tra</th>
                <th className="px-3 py-2 text-right font-medium">Hỏng</th>
                <th className="px-3 py-2 text-right font-medium">Mẫu / Biếu</th>
                {canWrite ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {balances.data.map((row) => {
                const status = row.product_batches
                  ? expiryStatus(row.product_batches.expiry_date, today)
                  : 'OK'
                return (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      {row.products?.name}
                      <span className="block font-mono text-xs text-slate-500">
                        {row.products?.sku}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {row.product_batches?.batch_code}
                      {row.product_batches?.status === 'INACTIVE' ? (
                        <span className="block text-xs text-slate-500">Ngừng dùng</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{row.locations?.code}</td>
                    <td className="px-3 py-2">
                      {row.product_batches ? formatDate(row.product_batches.expiry_date) : ''}
                      {status === 'EXPIRED' ? (
                        <span className="ml-1">
                          <StatusBadge label="Hết hạn" tone="danger" />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.available_qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.reserved_qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.in_transfer_qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.pending_inspection_qty}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.damaged_qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.sample_qty} / {row.gift_qty}
                    </td>
                    {canWrite ? (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          {isAdmin ? (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  setMove({ mode: 'adjust_in', preset: presetFor(row) })
                                }
                              >
                                + Điều chỉnh
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  setMove({ mode: 'adjust_out', preset: presetFor(row) })
                                }
                              >
                                − Điều chỉnh
                              </Button>
                            </>
                          ) : null}
                          <Button
                            variant="secondary"
                            onClick={() => setMove({ mode: 'SAMPLE_OUT', preset: presetFor(row) })}
                          >
                            Mẫu
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setMove({ mode: 'GIFT_OUT', preset: presetFor(row) })}
                          >
                            Biếu
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setMove({ mode: 'DAMAGE_OUT', preset: presetFor(row) })}
                          >
                            Hỏng
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <BatchFormDialog
        open={creatingBatch}
        products={catalog.data.products}
        onClose={() => setCreatingBatch(false)}
        onCreated={() => {
          setCreatingBatch(false)
          setNotice('Đã tạo lô hàng.')
          refresh()
        }}
      />
      <StockMoveDialog
        mode={move?.mode ?? null}
        preset={move?.preset ?? null}
        locations={catalog.data.locations}
        products={catalog.data.products}
        batches={catalog.data.batches}
        onClose={() => setMove(null)}
        onDone={(message) => {
          setMove(null)
          setNotice(message)
          refresh()
        }}
      />
    </section>
  )
}
