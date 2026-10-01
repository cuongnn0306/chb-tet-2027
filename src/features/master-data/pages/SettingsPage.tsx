import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SelectField, TextAreaField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import {
  SETTING_DEFINITIONS,
  formatSettingValue,
  parseSettingInput,
  settingToInputText,
  type SettingDefinition,
} from '@/domain/settings/definitions'
import { describeDbError } from '@/lib/db-errors'
import type { RowOf } from '@/services/crud.service'
import { useCrud } from '../hooks/useCrud'

type Setting = RowOf<'app_settings'>

export function SettingsPage() {
  const crud = useCrud('app_settings', 'key')
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: ['app_settings'], queryFn: crud.list })
  const [editing, setEditing] = useState<SettingDefinition | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (list.isPending) return <LoadingState />
  if (list.isError) {
    return (
      <ErrorState
        title="Không tải được cấu hình"
        action={{ label: 'Thử lại', onClick: () => void list.refetch() }}
      >
        Vui lòng kiểm tra kết nối mạng rồi thử lại.
      </ErrorState>
    )
  }

  const byKey = new Map<string, Setting>(list.data.map((row) => [row.key, row]))
  const depositType = byKey.get('default_deposit_type')?.value

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Cấu hình hệ thống</h1>
        <p className="text-sm text-slate-600">
          Các thông số vận hành. Thay đổi được lưu Audit Log và áp dụng cho thao tác mới.
        </p>
      </header>

      {notice ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {SETTING_DEFINITIONS.map((definition) => {
          const row = byKey.get(definition.key)
          return (
            <li
              key={definition.key}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{definition.label}</p>
                <p className="text-sm text-slate-600">{definition.description}</p>
                <p className="mt-1 break-words text-sm">
                  {row ? (
                    <span className="font-mono text-slate-800">
                      {formatSettingValue(definition, row.value)}
                    </span>
                  ) : (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                      Chưa cấu hình
                    </span>
                  )}
                </p>
              </div>
              <Button variant="secondary" onClick={() => setEditing(definition)}>
                {row ? 'Sửa' : 'Thiết lập'}
              </Button>
            </li>
          )
        })}
      </ul>

      <Dialog
        open={editing !== null}
        title={editing ? editing.label : ''}
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <SettingForm
            key={editing.key}
            definition={editing}
            row={byKey.get(editing.key) ?? null}
            depositType={depositType}
            save={(row, value) =>
              row
                ? crud.update(row.id, { value } as never)
                : crud.create({
                    key: editing.key,
                    value,
                    description: editing.description,
                  } as never)
            }
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setNotice(`Đã lưu "${editing.label}".`)
              setEditing(null)
              void queryClient.invalidateQueries({ queryKey: ['app_settings'] })
            }}
          />
        ) : null}
      </Dialog>
    </section>
  )
}

interface FormProps {
  definition: SettingDefinition
  row: Setting | null
  depositType: unknown
  save: (row: Setting | null, value: unknown) => Promise<unknown>
  onCancel: () => void
  onSaved: () => void
}

function SettingForm({ definition, row, depositType, save, onCancel, onSaved }: FormProps) {
  const [text, setText] = useState(settingToInputText(definition, row?.value))
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (value: unknown) => save(row, value),
    onSuccess: onSaved,
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseSettingInput(definition, text)
    if (parsed.error) return setError(parsed.error)
    if (
      definition.key === 'default_deposit_value' &&
      depositType === 'PERCENT' &&
      Number(parsed.value) > 100
    ) {
      return setError('Với kiểu phần trăm, giá trị tối đa là 100.')
    }
    setError(null)
    mutation.mutate(parsed.value)
  }

  const hint = definition.unit ? `Đơn vị: ${definition.unit}.` : undefined

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <p className="text-sm text-slate-600">{definition.description}</p>
      {definition.kind === 'enum' ? (
        <SelectField
          label="Giá trị"
          options={definition.options ?? []}
          placeholder="Chọn…"
          error={error ?? undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : definition.kind === 'json' ? (
        <TextAreaField
          label="Nội dung (JSON)"
          error={error ?? undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <TextField
          label="Giá trị"
          hint={hint}
          error={error ?? undefined}
          inputMode={definition.kind === 'integer' ? 'numeric' : undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
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
