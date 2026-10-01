import { useId, type InputHTMLAttributes } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

export function TextField({ label, className = '', ...rest }: Props) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        className={`min-h-11 rounded-md border border-slate-300 px-3 py-2 text-base focus:outline-2 focus:outline-offset-1 focus:outline-green-700 ${className}`}
      />
    </div>
  )
}
