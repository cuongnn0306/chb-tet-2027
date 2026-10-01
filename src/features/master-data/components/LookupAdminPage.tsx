import { normalizeCode, validateLookup } from '@/domain/master-data/validation'
import { createCrudService, type RowOf } from '@/services/crud.service'
import { getSupabase } from '@/lib/supabase'
import { useMemo } from 'react'
import { ResourceAdminPage, type FieldConfig } from './ResourceAdminPage'

type LookupTable = 'sales_channels' | 'lead_sources'
type LookupRow = RowOf<LookupTable>

const FIELDS: FieldConfig[] = [
  { name: 'code', label: 'Mã', type: 'text', hint: 'Chữ không dấu, số, - hoặc _.' },
  { name: 'name', label: 'Tên hiển thị', type: 'text' },
  {
    name: 'sort_order',
    label: 'Thứ tự hiển thị',
    type: 'text',
    inputMode: 'numeric',
    hint: 'Số nhỏ hiển thị trước.',
  },
  { name: 'is_active', label: 'Đang sử dụng', type: 'checkbox', editOnly: true },
]

interface Props {
  table: LookupTable
  title: string
  description: string
  noun: string
  deactivationWarning: string
}

/** Admin screen for simple code/name/sort-order lists (sales channels, lead sources). */
export function LookupAdminPage({ table, title, description, noun, deactivationWarning }: Props) {
  const crud = useMemo(() => createCrudService(getSupabase(), table, 'sort_order'), [table])
  return (
    <ResourceAdminPage<LookupRow>
      title={title}
      description={description}
      noun={noun}
      queryKey={table}
      load={() => crud.list() as Promise<LookupRow[]>}
      save={(id, payload) =>
        id ? crud.update(id, payload) : crud.create(payload as Parameters<typeof crud.create>[0])
      }
      fields={FIELDS}
      columns={[
        { header: 'Thứ tự', render: (r) => r.sort_order },
        { header: 'Mã', render: (r) => <span className="font-mono">{r.code}</span> },
        { header: 'Tên', render: (r) => r.name },
      ]}
      rowName={(r) => r.name}
      toFormValues={(r) => ({
        code: r?.code ?? '',
        name: r?.name ?? '',
        sort_order: String(r?.sort_order ?? 0),
        is_active: r?.is_active ?? true,
      })}
      validate={(v) =>
        validateLookup({
          code: String(v.code),
          name: String(v.name),
          sortOrder: String(v.sort_order),
        })
      }
      toPayload={(v, editing) => ({
        code: normalizeCode(String(v.code)),
        name: String(v.name).trim(),
        sort_order: Number(String(v.sort_order).trim()),
        ...(editing ? { is_active: v.is_active === true } : {}),
      })}
      deactivationWarning={() => deactivationWarning}
    />
  )
}
