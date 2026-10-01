import {
  normalizeCode,
  parsePercent,
  parseInteger,
  validateProduct,
} from '@/domain/master-data/validation'
import { formatVnd, parseVnd } from '@/lib/money'
import type { RowOf } from '@/services/crud.service'
import { ResourceAdminPage, type FieldConfig } from '../components/ResourceAdminPage'
import { useCrud } from '../hooks/useCrud'

type Product = RowOf<'products'>

const FIELDS: FieldConfig[] = [
  {
    name: 'sku',
    label: 'Mã SKU',
    type: 'text',
    hint: 'Ví dụ: TT-1200. Chữ không dấu, số, - hoặc _.',
  },
  { name: 'name', label: 'Tên sản phẩm', type: 'text' },
  { name: 'category', label: 'Nhóm', type: 'text', hint: 'Ví dụ: Bánh truyền thống, Hộp quà' },
  {
    name: 'weight_gram',
    label: 'Khối lượng (gram)',
    type: 'text',
    inputMode: 'numeric',
    hint: 'Có thể để trống.',
  },
  {
    name: 'list_price',
    label: 'Giá niêm yết (₫)',
    type: 'text',
    inputMode: 'numeric',
    hint: 'Là cơ sở tính doanh số và hoa hồng, không phải số tiền khách thực trả.',
  },
  {
    name: 'default_commission_rate',
    label: '% hoa hồng mặc định',
    type: 'text',
    inputMode: 'decimal',
    hint: 'Nhập 0 nếu sản phẩm không có hoa hồng mặc định.',
  },
  { name: 'is_active', label: 'Đang bán', type: 'checkbox', editOnly: true },
]

export function ProductsPage() {
  const crud = useCrud('products', 'sku')
  return (
    <ResourceAdminPage<Product>
      title="Sản phẩm"
      description="Danh sách SKU, giá niêm yết và % hoa hồng mặc định."
      noun="sản phẩm"
      queryKey="products"
      load={crud.list}
      save={(id, payload) =>
        id ? crud.update(id, payload) : crud.create(payload as Parameters<typeof crud.create>[0])
      }
      fields={FIELDS}
      columns={[
        { header: 'SKU', render: (r) => <span className="font-mono">{r.sku}</span> },
        { header: 'Tên', render: (r) => r.name },
        { header: 'Nhóm', render: (r) => r.category ?? '' },
        {
          header: 'Khối lượng',
          render: (r) => (r.weight_gram ? `${r.weight_gram.toLocaleString('vi-VN')} g` : ''),
        },
        { header: 'Giá niêm yết', render: (r) => formatVnd(r.list_price) },
        { header: 'Hoa hồng', render: (r) => `${r.default_commission_rate}%` },
      ]}
      rowName={(r) => `${r.sku} — ${r.name}`}
      toFormValues={(r) => ({
        sku: r?.sku ?? '',
        name: r?.name ?? '',
        category: r?.category ?? '',
        weight_gram: r?.weight_gram?.toString() ?? '',
        list_price: r ? String(r.list_price) : '',
        default_commission_rate: r ? String(r.default_commission_rate) : '0',
        is_active: r?.is_active ?? true,
      })}
      validate={(v) =>
        validateProduct({
          sku: String(v.sku),
          name: String(v.name),
          weightGram: String(v.weight_gram),
          listPrice: String(v.list_price),
          commissionRate: String(v.default_commission_rate),
        })
      }
      toPayload={(v, editing) => {
        const weight = String(v.weight_gram).trim()
        const category = String(v.category).trim()
        return {
          sku: normalizeCode(String(v.sku)),
          name: String(v.name).trim(),
          category: category === '' ? null : category,
          weight_gram: weight === '' ? null : (parseInteger(weight).value as number),
          list_price: parseVnd(String(v.list_price)).value as number,
          default_commission_rate: parsePercent(String(v.default_commission_rate)).value as number,
          ...(editing ? { is_active: v.is_active === true } : {}),
        }
      }}
      deactivationWarning={() =>
        'Sản phẩm sẽ không còn được chọn khi tạo đơn mới. Đơn và tồn kho cũ vẫn được giữ, thao tác được lưu Audit Log.'
      }
    />
  )
}
