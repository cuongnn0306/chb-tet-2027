import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  normalizeCode,
  validateLocation,
} from '@/domain/master-data/validation'
import type { RowOf } from '@/services/crud.service'
import { ResourceAdminPage, type FieldConfig } from '../components/ResourceAdminPage'
import { useCrud } from '../hooks/useCrud'

type Location = RowOf<'locations'>

const FIELDS: FieldConfig[] = [
  {
    name: 'code',
    label: 'Mã địa điểm',
    type: 'text',
    hint: 'Ví dụ: HN-VP. Chữ không dấu, số, - hoặc _.',
  },
  { name: 'name', label: 'Tên địa điểm', type: 'text' },
  {
    name: 'location_type',
    label: 'Loại',
    type: 'select',
    placeholder: 'Chọn loại…',
    options: LOCATION_TYPES.map((value) => ({ value, label: LOCATION_TYPE_LABELS[value] })),
  },
  { name: 'region', label: 'Khu vực', type: 'text', hint: 'Ví dụ: HN, HCM' },
  { name: 'address', label: 'Địa chỉ', type: 'text' },
  { name: 'phone', label: 'Số điện thoại', type: 'text', inputMode: 'numeric' },
  { name: 'is_active', label: 'Đang sử dụng', type: 'checkbox', editOnly: true },
]

const optional = (value: string | boolean | undefined) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? null : text
}

export function LocationsPage() {
  const crud = useCrud('locations', 'code')
  return (
    <ResourceAdminPage<Location>
      title="Địa điểm"
      description="Bếp tổng, văn phòng, cửa hàng CHB và cơ sở nhượng quyền."
      noun="địa điểm"
      queryKey="locations"
      load={crud.list}
      save={(id, payload) =>
        id ? crud.update(id, payload) : crud.create(payload as Parameters<typeof crud.create>[0])
      }
      fields={FIELDS}
      columns={[
        { header: 'Mã', render: (r) => <span className="font-mono">{r.code}</span> },
        { header: 'Tên', render: (r) => r.name },
        {
          header: 'Loại',
          render: (r) =>
            LOCATION_TYPE_LABELS[r.location_type as keyof typeof LOCATION_TYPE_LABELS] ??
            r.location_type,
        },
        { header: 'Khu vực', render: (r) => r.region ?? '' },
      ]}
      rowName={(r) => `${r.code} — ${r.name}`}
      toFormValues={(r) => ({
        code: r?.code ?? '',
        name: r?.name ?? '',
        location_type: r?.location_type ?? '',
        region: r?.region ?? '',
        address: r?.address ?? '',
        phone: r?.phone ?? '',
        is_active: r?.is_active ?? true,
      })}
      validate={(v) =>
        validateLocation({
          code: String(v.code),
          name: String(v.name),
          locationType: String(v.location_type),
        })
      }
      toPayload={(v, editing) => ({
        code: normalizeCode(String(v.code)),
        name: String(v.name).trim(),
        location_type: String(v.location_type),
        region: optional(v.region),
        address: optional(v.address),
        phone: optional(v.phone),
        ...(editing ? { is_active: v.is_active === true } : {}),
      })}
      deactivationWarning={() =>
        'Địa điểm sẽ không còn được chọn khi tạo đơn mới. Dữ liệu cũ vẫn được giữ và thao tác được lưu Audit Log.'
      }
    />
  )
}
