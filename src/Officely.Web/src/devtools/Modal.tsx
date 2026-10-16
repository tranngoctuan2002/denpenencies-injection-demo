import { useEffect, useRef, type ReactNode } from 'react'

/** Native <dialog>: focus trapping, Esc to close and an inert background come from the browser. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)

  // No cleanup: removing the element ends the modal state. Calling close() there would fire onClose
  // asynchronously and, under StrictMode's mount-unmount-mount, close the dialog right after it opened.
  useEffect(() => {
    if (!ref.current!.open) ref.current!.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="modal-title"
      className="m-auto w-[min(76rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-900/60"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <h2 id="modal-title" className="text-xl font-bold">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="rounded-lg px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500"
        >
          Close ✕
        </button>
      </div>
      <div className="px-6 py-5">{children}</div>
    </dialog>
  )
}
