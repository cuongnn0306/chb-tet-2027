import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { CheckboxField, SelectField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import type { FieldErrors } from '@/domain/master-data/validation'
import { describeDbError } from '@/lib/db-errors'

export type FormValues = Record<string, string | boolean>

export interface FieldConfig {
  name: string
  label: string
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date'
  options?: { value: string; label: string }[]
  /** Select: label of the empty option (omit to require a choice without an empty entry). */
  placeholder?: string
  hint?: string
  inputMode?: 'numeric' | 'decimal'
  /** Only shown when editing an existing record (e.g. the active flag). */
  editOnly?: boolean
}

export interface ColumnConfig<R> {
  header: string
  render: (row: R) => ReactNode
}

interface Props<R extends { id: string; is_active?: boolean }> {
  title: string
  description?: string
  /** Noun used in messages, e.g. "địa điểm". */
  noun: string
  queryKey: string
  load: () => Promise<R[]>
  /** Create when `id` is null, update otherwise. */
  save: (id: string | null, payload: Record<string, unknown>) => Promise<unknown>
  fields: FieldConfig[]
  columns: ColumnConfig<R>[]
  rowName: (row: R) => string
  toFormValues: (row: R | null) => FormValues
  validate: (values: FormValues, editing: R | null) => FieldErrors
  toPayload: (values: FormValues, editing: R | null) => Record<string, unknown>
  /** Consequence text shown before an active record is deactivated. */
  deactivationWarning?: (row: R) => string
}

export function ResourceAdminPage<R extends { id: string; is_active?: boolean }>(props: Props<R>) {
  const { title, description, noun, queryKey, load, columns } = props
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<R | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const list = useQuery({ queryKey: [queryKey], queryFn: load })

  const closeForm = () => {
    setEditing(null)
    setCreating(false)
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {description ? <p className="text-sm text-slate-600">{description}</p> : null}
        </div>
        <Button onClick={() => setCreating(true)}>Thêm {noun}</Button>
      </header>

      {notice ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      {list.isPending ? <LoadingState /> : null}
      {list.isError ? (
        <ErrorState
          title={`Không tải được danh sách ${noun}`}
          action={{ label: 'Thử lại', onClick: () => void list.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {list.isSuccess && list.data.length === 0 ? (
        <EmptyState
          title={`Chưa có ${noun} nào`}
          action={{ label: `Thêm ${noun} đầu tiên`, onClick: () => setCreating(true) }}
        />
      ) : null}
      {list.isSuccess && list.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {columns.map((column) => (
                  <th key={column.header} className="px-3 py-2 font-medium">
                    {column.header}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  {columns.map((column) => (
                    <td key={column.header} className="px-3 py-2">
                      {column.render(row)}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {row.is_active === false ? (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                        Ngừng dùng
                      </span>
                    ) : (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                        Đang dùng
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="secondary" onClick={() => setEditing(row)}>
                      Sửa
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Dialog
        open={creating || editing !== null}
        title={editing ? `Sửa ${noun}` : `Thêm ${noun}`}
        onClose={closeForm}
      >
        <ResourceForm
          key={editing?.id ?? 'new'}
          {...props}
          editing={editing}
          onCancel={closeForm}
          onSaved={(message) => {
            closeForm()
            setNotice(message)
            void queryClient.invalidateQueries({ queryKey: [queryKey] })
          }}
        />
      </Dialog>
    </section>
  )
}

function ResourceForm<R extends { id: string; is_active?: boolean }>({
  noun,
  fields,
  save,
  rowName,
  toFormValues,
  validate,
  toPayload,
  deactivationWarning,
  editing,
  onCancel,
  onSaved,
}: Props<R> & { editing: R | null; onCancel: () => void; onSaved: (message: string) => void }) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(editing))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false)

  const mutation = useMutation({
    mutationFn: () => save(editing?.id ?? null, toPayload(values, editing)),
    onSuccess: () => onSaved(editing ? `Đã cập nhật ${noun}.` : `Đã thêm ${noun}.`),
  })

  const deactivating = editing !== null && editing.is_active !== false && values.is_active === false
  const warning =
    deactivating && editing && deactivationWarning ? deactivationWarning(editing) : null

  function setValue(name: string, value: string | boolean) {
    setValues((current) => ({ ...current, [name]: value }))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const found = validate(values, editing)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (warning && !confirmingDeactivation) {
      setConfirmingDeactivation(true)
      return
    }
    mutation.mutate()
  }

  if (confirmingDeactivation && editing && warning) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-slate-800">
          Ngừng sử dụng <strong>{rowName(editing)}</strong>? {warning}
        </p>
        {mutation.isError ? (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            {describeDbError(mutation.error as { code?: string })}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmingDeactivation(false)}>
            Quay lại
          </Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Ngừng sử dụng
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      {fields
        .filter((field) => !field.editOnly || editing !== null)
        .map((field) => {
          const error = errors[field.name]
          const value = values[field.name]
          if (field.type === 'checkbox') {
            return (
              <CheckboxField
                key={field.name}
                label={field.label}
                checked={value === true}
                onChange={(checked) => setValue(field.name, checked)}
              />
            )
          }
          if (field.type === 'select') {
            return (
              <SelectField
                key={field.name}
                label={field.label}
                options={field.options ?? []}
                placeholder={field.placeholder}
                error={error}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => setValue(field.name, e.target.value)}
              />
            )
          }
          return (
            <TextField
              key={field.name}
              label={field.label}
              hint={field.hint}
              error={error}
              type={field.type === 'date' ? 'date' : 'text'}
              inputMode={field.inputMode}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => setValue(field.name, e.target.value)}
            />
          )
        })}
      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as { code?: string })}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Lưu
        </Button>
      </div>
    </form>
  )
}
