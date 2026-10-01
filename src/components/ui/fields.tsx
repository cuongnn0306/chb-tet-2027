import { useId, type SelectHTMLAttributes } from 'react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: { value: string; label: string }[]
  placeholder?: string
  error?: string
}

export function SelectField({
  label,
  options,
  placeholder,
  error,
  className = '',
  ...rest
}: SelectProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        {...rest}
        className={`min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-base ${className}`}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <FieldError message={error} /> : null}
    </div>
  )
}

export function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 accent-green-700"
      />
      <label htmlFor={id} className="text-base text-slate-800">
        {label}
      </label>
    </div>
  )
}

export function FieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-red-700">
      {message}
    </p>
  )
}
