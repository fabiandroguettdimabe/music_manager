import { AnimatePresence, motion } from 'motion/react';

// Primitivo de modal animado (entrada/salida con física de resorte + fundido del fondo).
// Mantiene el look Noir: usa las mismas clases `modal-overlay` / `modal-card glass-panel`,
// así que la paleta y el glassmorphism no cambian; solo se añade el movimiento.
// Reemplaza el patrón antiguo `if (!show) return null` + `.animate-in`.
export default function Modal({ show, onClose, children, maxWidth = 480, style, className = '' }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && onClose?.()}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className={`modal-card glass-panel ${className}`}
            style={{ maxWidth, ...style }}
            initial={{ opacity: 0, scale: 0.94, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          >
            {/* children puede ser función: se invoca solo cuando el modal está visible,
                así el contenido pesado no se reconstruye en cada render con el modal cerrado. */}
            {typeof children === 'function' ? children() : children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
