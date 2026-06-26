import { useRef } from 'react';
import { Heart, X, Download, Upload, Trash2, Play } from 'lucide-react';

export default function FavoritesModal({ show, favorites, onClose, onRemove, onPlay, onExport, onImport, onClear }) {
  const fileRef = useRef(null);
  if (!show) return null;
  const list = Object.values(favorites || {});

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Heart size={18} fill="var(--accent)" /> Mis favoritas ({list.length})
          </h2>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 24px 12px', flexWrap: 'wrap' }}>
          <button className="action-btn" style={{ fontSize: '0.8rem' }} onClick={onExport} disabled={!list.length}>
            <Download size={14} /> Exportar
          </button>
          <button className="action-btn" style={{ fontSize: '0.8rem' }} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Importar
          </button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
          <button className="action-btn danger-btn" style={{ fontSize: '0.8rem', marginLeft: 'auto' }} onClick={onClear} disabled={!list.length}>
            <Trash2 size={14} /> Vaciar
          </button>
        </div>

        <div className="modal-body" style={{ gap: 2 }}>
          {!list.length ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
              Aún no tienes favoritas. Pulsa el ♥ en una canción.
            </p>
          ) : (
            list.map((t) => (
              <div key={t.id} className="fav-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--panel-border)' }}>
                {t.thumbnail ? <img src={t.thumbnail} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} /> : <div style={{ width: 36 }} />}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.artist}</div>
                </div>
                {t.source && <span className={`track-source-badge ${t.source}`}>{t.source === 'spotify' ? 'SP' : 'YT'}</span>}
                <button className="icon-btn" title="Reproducir" onClick={() => onPlay(t)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><Play size={15} /></button>
                <button className="icon-btn" title="Quitar" onClick={() => onRemove(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={15} /></button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
