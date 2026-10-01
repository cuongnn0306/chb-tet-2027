import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ErrorState, LoadingState } from '@/components/shared/PageState'
import { parsePercent, validateCommissionRule } from '@/domain/master-data/validation'
import { formatDate } from '@/lib/date'
import { getSupabase } from '@/lib/supabase'
import type { RowOf } from '@/services/crud.service'
import { createLookupService, type Option } from '@/services/lookups.service'
import { ResourceAdminPage, type FieldConfig } from '../components/ResourceAdminPage'
import { useCrud } from '../hooks/useCrud'

type Rule = RowOf<'commission_rules'>

const labelOf = (options: Option[], id: string | null) =>
  options.find((option) => option.value === id)?.label ?? ''

export function CommissionRulesPage() {
  const crud = useCrud('commission_rules', 'effective_from')
  const lookups = useMemo(() => createLookupService(getSupabase()), [])
  const lists = useQuery({
    queryKey: ['commission-rule-options'],
    queryFn: async () => {
      const [profiles, roles, products] = await Promise.all([
        lookups.profiles(),
        lookups.roles(),
        lookups.products(),
      ])
      return { profiles, roles, products }
    },
  })

  if (lists.isPending) return <LoadingState />
  if (lists.isError) {
    return (
      <ErrorState
        title="Không tải được dữ liệu cho quy tắc hoa hồng"
        action={{ label: 'Thử lại', onClick: () => void lists.refetch() }}
      >
        Vui lòng kiểm tra kết nối mạng rồi thử lại.
      </ErrorState>
    )
  }
  const { profiles, roles, products } = lists.data

  const fields: FieldConfig[] = [
    {
      name: 'user_id',
      label: 'Áp dụng cho nhân viên',
      type: 'select',
      options: profiles,
      placeholder: '— Không chọn (dùng vai trò) —',
      hint: 'Chọn một nhân viên hoặc một vai trò, không chọn cả hai.',
    },
    {
      name: 'role_id',
      label: 'Áp dụng cho vai trò',
      type: 'select',
      options: roles,
      placeholder: '— Không chọn (dùng nhân viên) —',
    },
    {
      name: 'product_id',
      label: 'Sản phẩm',
      type: 'select',
      options: products,
      placeholder: 'Tất cả sản phẩm',
    },
    { name: 'rate_percent', label: '% hoa hồng', type: 'text', inputMode: 'decimal' },
    { name: 'effective_from', label: 'Hiệu lực từ ngày', type: 'date' },
    {
      name: 'effective_to',
      label: 'Hiệu lực đến ngày',
      type: 'date',
      hint: 'Để trống nếu chưa có ngày kết thúc.',
    },
    { name: 'is_active', label: 'Đang áp dụng', type: 'checkbox', editOnly: true },
  ]

  return (
    <ResourceAdminPage<Rule>
      title="Quy tắc hoa hồng"
      description="Thứ tự ưu tiên: nhân viên + sản phẩm, nhân viên, vai trò + sản phẩm, vai trò, % mặc định của sản phẩm."
      noun="quy tắc hoa hồng"
      queryKey="commission_rules"
      load={crud.list}
      save={(id, payload) =>
        id ? crud.update(id, payload) : crud.create(payload as Parameters<typeof crud.create>[0])
      }
      fields={fields}
      columns={[
        {
          header: 'Áp dụng cho',
          render: (r) =>
            r.user_id
              ? `Nhân viên: ${labelOf(profiles, r.user_id)}`
              : `Vai trò: ${labelOf(roles, r.role_id)}`,
        },
        {
          header: 'Sản phẩm',
          render: (r) => (r.product_id ? labelOf(products, r.product_id) : 'Tất cả sản phẩm'),
        },
        { header: 'Hoa hồng', render: (r) => `${r.rate_percent}%` },
        {
          header: 'Hiệu lực',
          render: (r) =>
            `${formatDate(r.effective_from)} → ${r.effective_to ? formatDate(r.effective_to) : 'chưa kết thúc'}`,
        },
      ]}
      rowName={(r) =>
        `${r.user_id ? labelOf(profiles, r.user_id) : labelOf(roles, r.role_id)} · ${r.rate_percent}%`
      }
      toFormValues={(r) => ({
        user_id: r?.user_id ?? '',
        role_id: r?.role_id ?? '',
        product_id: r?.product_id ?? '',
        rate_percent: r ? String(r.rate_percent) : '',
        effective_from: r?.effective_from ?? '',
        effective_to: r?.effective_to ?? '',
        is_active: r?.is_active ?? true,
      })}
      validate={(v) =>
        validateCommissionRule({
          userId: String(v.user_id),
          roleId: String(v.role_id),
          rate: String(v.rate_percent),
          effectiveFrom: String(v.effective_from),
          effectiveTo: String(v.effective_to),
        })
      }
      toPayload={(v, editing) => ({
        user_id: v.user_id === '' ? null : String(v.user_id),
        role_id: v.role_id === '' ? null : String(v.role_id),
        product_id: v.product_id === '' ? null : String(v.product_id),
        rate_percent: parsePercent(String(v.rate_percent)).value as number,
        effective_from: String(v.effective_from),
        effective_to: v.effective_to === '' ? null : String(v.effective_to),
        ...(editing ? { is_active: v.is_active === true } : {}),
      })}
      deactivationWarning={() =>
        'Quy tắc sẽ không còn được dùng để tính hoa hồng cho đơn mới. Thao tác được lưu Audit Log.'
      }
    />
  )
}
