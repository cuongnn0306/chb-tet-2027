import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ROUTES } from '@/app/routes'
import { DateTimeText } from '@/components/shared/MoneyText'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoPermissionState,
} from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import {
  AUDIT_PAGE_SIZE,
  describeAuditActor,
  formatAuditPayload,
  parseAuditFilters,
  resolveAuditViewerAccess,
  type AuditFilterErrors,
  type AuditFilterInput,
} from '@/domain/audit/audit-log'
import { useAuth } from '@/features/auth/auth-context'
import { getSupabase } from '@/lib/supabase'
import type { AuditLogRow } from '@/services/audit.service'
import { createLookupService } from '@/services/lookups.service'
import { useAuditService } from '../hooks/useAuditService'

const EMPTY_FILTERS: AuditFilterInput = {
  entityType: '',
  action: '',
  actorUserId: '',
  entityId: '',
  dateFrom: '',
  dateTo: '',
}

/**
 * SEC-001: read-only Audit Log (Admin only). The viewer that owns the queries is mounted only for an
 * active user holding `view_audit_log` and is keyed by user + role, so nothing from another account
 * or role can be shown. The database (RLS) is what actually restricts the rows.
 */
export function AuditLogPage() {
  const { access } = useAuth()
  const viewer = resolveAuditViewerAccess(access)
  if (viewer.status === 'loading') return <LoadingState label="Đang kiểm tra quyền truy cập…" />
  if (viewer.status === 'denied') return <NoPermissionState />
  return <AuditLogViewer key={viewer.identity} identity={viewer.identity} />
}

/** Only an entity type that is exactly the table of an existing screen gets a link; others are plain text. */
function entityPath(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null
  if (entityType === 'orders') return ROUTES.orderDetail(entityId)
  if (entityType === 'transfers') return ROUTES.transferDetail(entityId)
  return null
}

function AuditLogViewer({ identity }: { identity: string }) {
  const audit = useAuditService()
  const lookups = useMemo(() => createLookupService(getSupabase()), [])
  const [draft, setDraft] = useState<AuditFilterInput>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<AuditFilterInput>(EMPTY_FILTERS)
  const [errors, setErrors] = useState<AuditFilterErrors>({})
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  const actors = useQuery({
    queryKey: ['audit-actors', identity],
    queryFn: () => lookups.profiles(),
  })
  const list = useQuery({
    queryKey: ['audit-logs', identity, applied, page],
    queryFn: ({ signal }) => audit.listLogs({ filters: applied, page }, { signal }),
  })

  const setField = (key: keyof AuditFilterInput) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const apply = (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseAuditFilters(draft)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    setApplied({ ...draft })
    setPage(0)
    setOpenId(null)
  }

  const clear = () => {
    setDraft(EMPTY_FILTERS)
    setApplied(EMPTY_FILTERS)
    setErrors({})
    setPage(0)
    setOpenId(null)
  }

  const rows = list.data?.rows ?? []
  const hasNext = list.data?.hasNext ?? false

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-600">
          Nhật ký các thay đổi trong hệ thống, chỉ để xem. Dòng nhật ký được ghi tự động và không
          sửa hoặc xóa được.
        </p>
      </header>

      <form
        onSubmit={apply}
        className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Người thực hiện"
            placeholder="Tất cả"
            options={actors.data ?? []}
            value={draft.actorUserId ?? ''}
            error={errors.actorUserId}
            onChange={(e) => setField('actorUserId')(e.target.value)}
          />
          <TextField
            label="Loại đối tượng"
            placeholder="Ví dụ: orders"
            value={draft.entityType ?? ''}
            error={errors.entityType}
            maxLength={64}
            onChange={(e) => setField('entityType')(e.target.value)}
          />
          <TextField
            label="Hành động"
            placeholder="Ví dụ: update"
            value={draft.action ?? ''}
            error={errors.action}
            maxLength={64}
            onChange={(e) => setField('action')(e.target.value)}
          />
          <TextField
            label="Mã bản ghi"
            placeholder="UUID của đơn, kho, người dùng…"
            value={draft.entityId ?? ''}
            error={errors.entityId}
            maxLength={36}
            onChange={(e) => setField('entityId')(e.target.value)}
          />
          <TextField
            label="Từ ngày"
            type="date"
            value={draft.dateFrom ?? ''}
            error={errors.dateFrom}
            onChange={(e) => setField('dateFrom')(e.target.value)}
          />
          <TextField
            label="Đến ngày"
            type="date"
            value={draft.dateTo ?? ''}
            error={errors.dateTo}
            onChange={(e) => setField('dateTo')(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Áp dụng bộ lọc</Button>
          <Button type="button" variant="secondary" onClick={clear}>
            Xóa bộ lọc
          </Button>
        </div>
      </form>

      {actors.isError ? (
        <p role="status" className="text-sm text-amber-800">
          Không tải được danh sách người thực hiện nên chưa lọc theo người được.
        </p>
      ) : null}

      {list.isPending ? <LoadingState /> : null}
      {list.isError ? (
        <ErrorState
          title="Không tải được Audit Log"
          action={{ label: 'Thử lại', onClick: () => void list.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {list.isSuccess && rows.length === 0 ? (
        <EmptyState title={page > 0 ? 'Không còn dòng nào' : 'Không có dòng nhật ký phù hợp'}>
          {page > 0
            ? 'Hãy quay lại trang trước.'
            : 'Thử bỏ bớt bộ lọc hoặc chọn khoảng ngày rộng hơn.'}
        </EmptyState>
      ) : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Danh sách nhật ký">
          {rows.map((row) => (
            <AuditEntry
              key={row.id}
              row={row}
              identity={identity}
              open={openId === row.id}
              onToggle={() => setOpenId((current) => (current === row.id ? null : row.id))}
            />
          ))}
        </ul>
      ) : null}

      {page > 0 || hasNext ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={page === 0}
            onClick={() => {
              setPage((p) => p - 1)
              setOpenId(null)
            }}
          >
            Trang trước
          </Button>
          <span className="text-sm text-slate-600">
            Trang {page + 1} · {AUDIT_PAGE_SIZE} dòng/trang
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={!hasNext}
            onClick={() => {
              setPage((p) => p + 1)
              setOpenId(null)
            }}
          >
            Trang sau
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function AuditEntry({
  row,
  identity,
  open,
  onToggle,
}: {
  row: AuditLogRow
  identity: string
  open: boolean
  onToggle: () => void
}) {
  const actor = describeAuditActor(row.actor_user_id, row.actor?.full_name ?? null)
  const link = entityPath(row.entity_type, row.entity_id)
  const detailId = `audit-detail-${row.id}`

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 text-sm break-words">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-slate-900">
          <DateTimeText value={row.created_at} />
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800">
          {row.action}
        </span>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Người thực hiện</dt>
          <dd className={actor.kind === 'person' ? 'text-slate-900' : 'text-slate-600 italic'}>
            {actor.label}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Đối tượng</dt>
          <dd>
            <span className="font-mono text-xs">{row.entity_type}</span>
            {row.entity_id ? (
              <span className="block font-mono text-xs break-all text-slate-600">
                {row.entity_id}
              </span>
            ) : (
              <span className="block text-xs text-slate-500">Không có mã bản ghi</span>
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-slate-500">Lý do</dt>
          <dd className={row.reason ? 'text-slate-900' : 'text-slate-500'}>
            {row.reason ?? 'Không ghi lý do'}
          </dd>
        </div>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={onToggle}
        >
          {open ? 'Ẩn dữ liệu trước/sau' : 'Xem dữ liệu trước/sau'}
        </Button>
        {link ? (
          <Link to={link} className="text-sm text-green-800 underline">
            Mở bản ghi liên quan
          </Link>
        ) : null}
      </div>
      {open ? (
        <div id={detailId} className="mt-3">
          <AuditDetail id={row.id} identity={identity} />
        </div>
      ) : null}
    </li>
  )
}

function AuditDetail({ id, identity }: { id: string; identity: string }) {
  const audit = useAuditService()
  const detail = useQuery({
    queryKey: ['audit-log-detail', identity, id],
    queryFn: ({ signal }) => audit.getDetail(id, { signal }),
  })

  if (detail.isPending) return <LoadingState label="Đang tải chi tiết…" />
  if (detail.isError) {
    return (
      <ErrorState
        title="Không tải được chi tiết"
        action={{ label: 'Thử lại', onClick: () => void detail.refetch() }}
      >
        Vui lòng kiểm tra kết nối mạng rồi thử lại.
      </ErrorState>
    )
  }
  if (!detail.data) return <EmptyState title="Không tìm thấy chi tiết của dòng nhật ký này" />

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Payload title="Trước thay đổi" value={detail.data.before_data} />
      <Payload title="Sau thay đổi" value={detail.data.after_data} />
    </div>
  )
}

function Payload({ title, value }: { title: string; value: unknown }) {
  const formatted = formatAuditPayload(value)
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-xs font-semibold text-slate-600 uppercase">{title}</h3>
      {formatted.text === null ? (
        <p className="text-sm text-slate-500">Không có dữ liệu</p>
      ) : (
        <>
          <pre className="max-h-80 overflow-auto rounded-md bg-slate-50 p-2 text-xs break-words whitespace-pre-wrap">
            {formatted.text}
          </pre>
          {formatted.truncated ? (
            <p className="mt-1 text-xs text-amber-800">Dữ liệu dài nên chỉ hiển thị phần đầu.</p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">
            Các trường có tên giống khóa bí mật được ẩn khi hiển thị.
          </p>
        </>
      )}
    </div>
  )
}
