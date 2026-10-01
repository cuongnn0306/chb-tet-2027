import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/** Modal built on the native <dialog> element (focus trap and Esc handled by the browser). */
export function Dialog({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg p-0 shadow-xl backdrop:bg-black/40"
    >
      {open ? (
        <div className="flex flex-col gap-4 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  )
}
