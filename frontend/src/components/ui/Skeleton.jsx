/**
 * Placeholders animados (shimmer) para estados de carga. Sustituyen al texto
 * "Cargando…" plano y hacen que la app se sienta fluida mientras llegan los datos.
 */
export function SkeletonRows({ count = 6 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton-thumb" />
          <div className="skeleton-lines">
            <div className="skeleton-line" style={{ width: '70%' }} />
            <div className="skeleton-line" style={{ width: '45%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, children }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <p>{children}</p>
    </div>
  );
}
