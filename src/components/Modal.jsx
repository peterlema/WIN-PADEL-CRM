import { useEffect, useRef } from 'react'

// Ventana emergente accesible (elemento <dialog>): Esc y clic afuera la cierran.
export default function Modal({ titulo, onCerrar, children, footer }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    return () => { if (d?.open) d.close() }
  }, [])
  return (
    <dialog ref={ref} className="modal" aria-label={titulo}
      onCancel={e => { e.preventDefault(); onCerrar() }}
      onMouseDown={e => { if (e.target === ref.current) onCerrar() }}>
      <div className="modal-caja">
        <div className="modal-cabeza">
          <h2>{titulo}</h2>
          <button type="button" className="secundario modal-x" aria-label="Cerrar ventana" onClick={onCerrar}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer&&<div className="modal-footer">{footer}</div>}
      </div>
    </dialog>
  )
}

