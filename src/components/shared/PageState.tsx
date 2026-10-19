import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

/** Standard loading / empty / error / no-permission states (AGENTS §8). */
export function LoadingState({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 p-8 text-slate-600"
    >
      <span
        className="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-green-700"
        aria-hidden
      />
      {label}
    </div>
  )
}

interface MessageProps {
  title: string
  children?: ReactNode
  action?: { label: string; onClick: () => void }
}

function MessageState({ title, children, action, tone }: MessageProps & { tone: string }) {
  return (
    <div
      className={`mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg p-6 text-center ${tone}`}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {children ? <p className="text-sm">{children}</p> : null}
      {action ? (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

export function EmptyState(props: MessageProps) {
  return <MessageState {...props} tone="text-slate-600" />
}

export function ErrorState(props: MessageProps) {
  return <MessageState {...props} tone="bg-red-50 text-red-800" />
}

export function NoPermissionState(props: Partial<MessageProps>) {
  return (
    <MessageState
      title={props.title ?? 'Bạn chưa có quyền truy cập'}
      action={props.action}
      tone="bg-amber-50 text-amber-900"
    >
      {props.children ?? 'Vui lòng liên hệ quản trị viên nếu bạn cần dùng chức năng này.'}
    </MessageState>
  )
}
