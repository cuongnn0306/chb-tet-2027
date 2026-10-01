import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-green-700 text-white hover:bg-green-800 disabled:bg-green-300',
  secondary:
    'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-60',
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-base font-medium transition-colors focus:outline-2 focus:outline-offset-2 focus:outline-green-700 ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </button>
  )
}
