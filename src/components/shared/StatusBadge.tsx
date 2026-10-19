export type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'muted'

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-800',
  info: 'bg-blue-100 text-blue-800',
  warning: 'bg-amber-100 text-amber-900',
  success: 'bg-green-100 text-green-800',
  danger: 'bg-red-100 text-red-800',
  muted: 'bg-slate-200 text-slate-600',
}

/** Small coloured label for any status. Colour is never the only signal: the text always says it. */
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  )
}
