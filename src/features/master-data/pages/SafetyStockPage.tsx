import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ErrorState, LoadingState } from '@/components/shared/PageState'
import { parseInteger, validateSafetyStock } from '@/domain/master-data/validation'
import { getSupabase } from '@/lib/supabase'
import type { RowOf } from '@/services/crud.service'
import { createLookupService, type Option } from '@/services/lookups.service'
import { ResourceAdminPage, type FieldConfig } from '../components/ResourceAdminPage'
import { useCrud } from '../hooks/useCrud'

type Rule = RowOf<'safety_stock_rules'>

const labelOf = (options: Option[], id: string) =>
  options.find((option) => option.value === id)?.label ?? ''

export function SafetyStockPage() {
  const crud = useCrud('safety_stock_rules', 'updated_at')
  const lookups = useMemo(() => createLookupService(getSupabase()), [])
  const lists = useQuery({
    queryKey: ['safety-stock-options'],
    queryFn: async () => {
      const [locations, products] = await Promise.all([lookups.locations(), lookups.products()])
      return { locations, products }
    },
  })

  if (lists.isPending) return <LoadingState />
  if (lists.isError) {
    return (
      <ErrorState
        title="Không tải được dữ liệu tồn an toàn"
        action={{ label: 'Thử lại', onClick: () => void lists.refetch() }}
      >
        Vui lòng kiểm tra kết nối mạng rồi thử lại.
      </ErrorState>
    )
  }
  const { locations, products } = lists.data

  const fields: FieldConfig[] = [
    {
      name: 'location_id',
      label: 'Địa điểm',
      type: 'select',
      options: locations,
      placeholder: 'Chọn địa điểm…',
      lockedOnEdit: true,
    },
    {
      name: 'product_id',
      label: 'Sản phẩm',
      type: 'select',
      options: products,
      placeholder: 'Chọn sản phẩm…',
      lockedOnEdit: true,
    },
    {
      name: 'minimum_qty',
      label: 'Tồn an toàn tối thiểu (cái)',
      type: 'text',
      inputMode: 'numeric',
      hint: 'Hàng có thể bán = hàng sẵn có − hàng đang giữ − tồn an toàn. Nhập 0 nếu không cần giữ tồn an toàn.',
    },
  ]

  return (
    <ResourceAdminPage<Rule>
      title="Tồn an toàn"
      description="Mức tồn tối thiểu cần giữ lại theo từng địa điểm và sản phẩm."
      noun="mức tồn an toàn"
      queryKey="safety_stock_rules"
      load={async () => {
        const rows = await crud.list()
        const key = (r: Rule) =>
          `${labelOf(locations, r.location_id)}|${labelOf(products, r.product_id)}`
        return [...rows].sort((a, b) => key(a).localeCompare(key(b)))
      }}
      save={(id, payload) =>
        id ? crud.update(id, payload) : crud.create(payload as Parameters<typeof crud.create>[0])
      }
      fields={fields}
      columns={[
        { header: 'Địa điểm', render: (r) => labelOf(locations, r.location_id) },
        { header: 'Sản phẩm', render: (r) => labelOf(products, r.product_id) },
        { header: 'Tồn an toàn', render: (r) => r.minimum_qty.toLocaleString('vi-VN') },
      ]}
      rowName={(r) => `${labelOf(locations, r.location_id)} × ${labelOf(products, r.product_id)}`}
      toFormValues={(r) => ({
        location_id: r?.location_id ?? '',
        product_id: r?.product_id ?? '',
        minimum_qty: r ? String(r.minimum_qty) : '',
      })}
      validate={(v) =>
        validateSafetyStock({
          locationId: String(v.location_id),
          productId: String(v.product_id),
          minimumQty: String(v.minimum_qty),
        })
      }
      toPayload={(v, editing) => ({
        ...(editing
          ? {}
          : { location_id: String(v.location_id), product_id: String(v.product_id) }),
        minimum_qty: parseInteger(String(v.minimum_qty)).value as number,
      })}
    />
  )
}
