import { X } from 'lucide-react';

export default function StatsModal({ show, onClose }) {
  if (!show) return null;

  let sorted = [];
  let error = false;
  try {
    const stats = JSON.parse(localStorage.getItem('rsp_stats') || '{}');
    sorted = Object.values(stats).sort((a, b) => b.count - a.count).slice(0, 20);
  } catch {
    error = true;
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h2>Estadísticas de escucha</h2>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {error ? (
            <p>Error cargando estadísticas.</p>
          ) : !sorted.length ? (
            <p>Aún no hay canciones reproducidas.</p>
          ) : (
            sorted.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--panel-border)' }}>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)', width: 24, textAlign: 'right' }}>{i + 1}</span>
                <img src={s.thumbnail} alt="" style={{ width: 38, height: 38, borderRadius: 6, objectFit: 'cover' }} />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{s.artist}</div>
                </div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{s.count}×</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
