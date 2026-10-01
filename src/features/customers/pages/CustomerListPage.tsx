import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { CheckboxField, SelectField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import {
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  customerDisplayName,
  type CustomerType,
} from '@/domain/customers/validation'
import { describeHistory, lastOrderDate } from '@/domain/customers/history'
import { useAuth } from '@/features/auth/auth-context'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { describeDbError } from '@/lib/db-errors'
import { CUSTOMER_PAGE_SIZE, type Customer } from '@/services/customers.service'
import { CustomerForm } from '../components/CustomerForm'
import { useCustomerHistory } from '../hooks/useCustomerHistory'
import { useCustomerService } from '../hooks/useCustomerService'

type Editor =
  | { mode: 'closed' }
  | { mode: 'form'; customer: Customer | null }
  | { mode: 'archive'; customer: Customer }

export function CustomerListPage() {
  const service = useCustomerService()
  const queryClient = useQueryClient()
  const { access } = useAuth()
  const me = access.status === 'active' ? access.user : null

  const [search, setSearch] = useState('')
  const [type, setType] = useState<'' | CustomerType>('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [page, setPage] = useState(0)
  const [editor, setEditor] = useState<Editor>({ mode: 'closed' })
  const [notice, setNotice] = useState<string | null>(null)
  const debouncedSearch = useDebouncedValue(search)

  const list = useQuery({
    queryKey: ['customers', debouncedSearch, type, includeArchived, page],
    queryFn: () =>
      service.search({
        query: debouncedSearch,
        customerType: type || null,
        includeArchived,
        // one extra row tells us whether a next page exists
        limit: CUSTOMER_PAGE_SIZE + 1,
        offset: page * CUSTOMER_PAGE_SIZE,
      }),
    placeholderData: (previous) => previous,
  })

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['customers'] })
  const close = () => setEditor({ mode: 'closed' })

  const archive = useMutation({
    mutationFn: (customer: Customer) => service.setArchived(customer.id, !customer.is_archived),
    onSuccess: (customer) => {
      setNotice(customer.is_archived ? 'Đã lưu trữ khách hàng.' : 'Đã khôi phục khách hàng.')
      close()
      refresh()
    },
  })

  const canEdit = (customer: Customer) =>
    me !== null && (me.roleCode === 'ADMIN' || customer.created_by === me.id)

  const rows = list.data ?? []
  const visible = rows.slice(0, CUSTOMER_PAGE_SIZE)
  const hasNext = rows.length > CUSTOMER_PAGE_SIZE
  const history = useCustomerHistory(visible.map((customer) => customer.id))

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Khách hàng</h1>
          <p className="text-sm text-slate-600">
            Tìm theo tên, công ty, mã số thuế, email hoặc số điện thoại.
          </p>
        </div>
        <Button onClick={() => setEditor({ mode: 'form', customer: null })}>Thêm khách hàng</Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <TextField
          label="Tìm khách hàng"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          placeholder="Ví dụ: nguyen van a, 0901…, 0100…"
        />
        <SelectField
          label="Loại khách"
          placeholder="Tất cả"
          options={CUSTOMER_TYPES.map((value) => ({ value, label: CUSTOMER_TYPE_LABELS[value] }))}
          value={type}
          onChange={(e) => {
            setType(e.target.value as '' | CustomerType)
            setPage(0)
          }}
        />
        <CheckboxField
          label="Hiện khách đã lưu trữ"
          checked={includeArchived}
          onChange={(checked) => {
            setIncludeArchived(checked)
            setPage(0)
          }}
        />
      </div>

      {notice ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      {list.isPending ? <LoadingState /> : null}
      {list.isError ? (
        <ErrorState
          title="Không tải được danh sách khách hàng"
          action={{ label: 'Thử lại', onClick: () => void list.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {list.isSuccess && visible.length === 0 ? (
        <EmptyState
          title={
            debouncedSearch || type ? 'Không tìm thấy khách hàng phù hợp' : 'Chưa có khách hàng nào'
          }
          action={{
            label: 'Thêm khách hàng',
            onClick: () => setEditor({ mode: 'form', customer: null }),
          }}
        />
      ) : null}

      {visible.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Khách hàng</th>
                <th className="px-3 py-2 font-medium">Loại</th>
                <th className="px-3 py-2 font-medium">Số điện thoại</th>
                <th className="px-3 py-2 font-medium">Địa chỉ / MST</th>
                <th className="px-3 py-2 font-medium">Lịch sử mua</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((customer) => (
                <tr key={customer.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-900">{customerDisplayName(customer)}</p>
                    {customer.customer_type === 'COMPANY' && customer.contact_name ? (
                      <p className="text-xs text-slate-500">
                        {customer.contact_name}
                        {customer.contact_title ? ` — ${customer.contact_title}` : ''}
                      </p>
                    ) : null}
                    {customer.is_archived ? (
                      <span className="mt-1 inline-block rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                        Đã lưu trữ
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {CUSTOMER_TYPE_LABELS[customer.customer_type as CustomerType] ??
                      customer.customer_type}
                  </td>
                  <td className="px-3 py-2 font-mono">{customer.phone ?? ''}</td>
                  <td className="px-3 py-2">
                    {customer.customer_type === 'COMPANY'
                      ? (customer.tax_code ?? '')
                      : (customer.address ?? '')}
                  </td>
                  <td className="px-3 py-2">
                    {describeHistory(history.get(customer.id))}
                    {lastOrderDate(history.get(customer.id)) ? (
                      <span className="block text-xs text-slate-500">
                        Gần nhất {lastOrderDate(history.get(customer.id))}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit(customer) ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => setEditor({ mode: 'form', customer })}
                        >
                          Sửa
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setEditor({ mode: 'archive', customer })}
                        >
                          {customer.is_archived ? 'Khôi phục' : 'Lưu trữ'}
                        </Button>
                      </div>
                    ) : null}
                  </td>
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

      <Dialog
        open={editor.mode === 'form'}
        title={editor.mode === 'form' && editor.customer ? 'Sửa khách hàng' : 'Thêm khách hàng'}
        onClose={close}
      >
        {editor.mode === 'form' ? (
          <CustomerForm
            key={editor.customer?.id ?? 'new'}
            customer={editor.customer}
            onCancel={close}
            onSaved={(saved) => {
              setNotice(
                editor.customer
                  ? 'Đã cập nhật khách hàng.'
                  : `Đã thêm khách hàng "${customerDisplayName(saved)}".`,
              )
              close()
              refresh()
            }}
            onOpenExisting={(existing) => setEditor({ mode: 'form', customer: existing })}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={editor.mode === 'archive'}
        title={
          editor.mode === 'archive' && editor.customer.is_archived
            ? 'Khôi phục khách hàng'
            : 'Lưu trữ khách hàng'
        }
        onClose={close}
      >
        {editor.mode === 'archive' ? (
          <div className="flex flex-col gap-4">
            <p className="text-slate-800">
              {editor.customer.is_archived
                ? `Khôi phục ${customerDisplayName(editor.customer)}? Khách sẽ hiện lại trong tìm kiếm và gợi ý khách trùng.`
                : `Lưu trữ ${customerDisplayName(editor.customer)}? Khách sẽ không còn hiện trong tìm kiếm và gợi ý mặc định. Đơn cũ vẫn giữ nguyên và thao tác được lưu Audit Log.`}
            </p>
            {archive.isError ? (
              <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                {describeDbError(archive.error as { code?: string })}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Quay lại
              </Button>
              <Button loading={archive.isPending} onClick={() => archive.mutate(editor.customer)}>
                {editor.customer.is_archived ? 'Khôi phục' : 'Lưu trữ'}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  )
}
