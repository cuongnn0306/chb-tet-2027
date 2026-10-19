import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import { getSupabase } from '@/lib/supabase'
import { createProfileDefaultsService, type ProfileDefaults } from '@/services/profiles.service'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SelectField } from '@/components/ui/fields'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoPermissionState,
} from '@/components/shared/PageState'

export function ProfileDefaultsPage() {
  const { access } = useAuth()
  if (access.status !== 'active' || access.user.roleCode !== 'ADMIN') return <NoPermissionState />
  return <ProfileDefaultsEditor owner={access.user.id} />
}
function ProfileDefaultsEditor({ owner }: { owner: string }) {
  const client = useMemo(() => getSupabase(), [])
  const service = useMemo(() => createProfileDefaultsService(client), [client])
  const cache = useQueryClient()
  const key = ['profile-defaults', owner]
  const [selected, setSelected] = useState<string | null>(null)
  const [values, setValues] = useState<ProfileDefaults>({
    default_location_id: null,
    default_sales_channel_id: null,
    default_lead_source_id: null,
  })
  const [saved, setSaved] = useState(false)
  const profiles = useQuery({ queryKey: key, queryFn: service.list })
  const options = useQuery({
    queryKey: ['profile-default-options', owner],
    queryFn: async () => {
      const [locations, channels, sources] = await Promise.all([
        client.from('locations').select('id,name,is_active').order('name'),
        client.from('sales_channels').select('id,name,is_active').order('name'),
        client.from('lead_sources').select('id,name,is_active').order('name'),
      ])
      for (const result of [locations, channels, sources]) if (result.error) throw result.error
      return [locations.data ?? [], channels.data ?? [], sources.data ?? []]
    },
  })
  const mutation = useMutation({
    mutationFn: () => service.save(selected!, values),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: key })
      setSelected(null)
      setSaved(true)
    },
  })
  if (profiles.isPending || options.isPending) return <LoadingState />
  if (profiles.isError || options.isError)
    return (
      <ErrorState
        title="Không tải được hồ sơ"
        action={{
          label: 'Thử lại',
          onClick: () => {
            void profiles.refetch()
            void options.refetch()
          },
        }}
      />
    )
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Mặc định người dùng</h1>
      <p>
        Cấu hình điền sẵn khi tạo đơn mới. Thao tác không sửa đơn đã có, vai trò hay trạng thái tài
        khoản.
      </p>
      {saved && <p role="status">Đã lưu mặc định người dùng.</p>}
      {profiles.data.length === 0 ? (
        <EmptyState title="Chưa có hồ sơ người dùng" />
      ) : (
        profiles.data.map((row) => (
          <article
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border bg-white p-3"
          >
            <span className="break-words">{row.full_name}</span>
            <Button
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => {
                setSelected(row.id)
                setValues({
                  default_location_id: row.default_location_id,
                  default_sales_channel_id: row.default_sales_channel_id,
                  default_lead_source_id: row.default_lead_source_id,
                })
                mutation.reset()
                setSaved(false)
              }}
            >
              Sửa mặc định
            </Button>
          </article>
        ))
      )}
      <Dialog
        open={selected !== null}
        title="Mặc định tạo đơn"
        onClose={() => {
          if (!mutation.isPending) setSelected(null)
        }}
      >
        {(
          ['default_location_id', 'default_sales_channel_id', 'default_lead_source_id'] as const
        ).map((field, index) => (
          <SelectField
            key={field}
            label={['Điểm tạo đơn', 'Kênh bán', 'Nguồn khách'][index] ?? 'Mặc định'}
            placeholder="Không đặt mặc định"
            value={values[field] ?? ''}
            disabled={mutation.isPending}
            options={(options.data[index] ?? [])
              .filter((row) => row.is_active || row.id === values[field])
              .map((row) => ({
                value: row.id,
                label: row.name + (row.is_active ? '' : ' (ngừng sử dụng)'),
              }))}
            onChange={(event) =>
              setValues((previous) => ({ ...previous, [field]: event.target.value || null }))
            }
          />
        ))}
        {mutation.isError && (
          <p role="alert">
            Không lưu được mặc định. Kiểm tra quyền truy cập và các giá trị đã chọn rồi thử lại.
          </p>
        )}
        <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Lưu mặc định
        </Button>
        <Button variant="secondary" disabled={mutation.isPending} onClick={() => setSelected(null)}>
          Quay lại
        </Button>
      </Dialog>
    </section>
  )
}
