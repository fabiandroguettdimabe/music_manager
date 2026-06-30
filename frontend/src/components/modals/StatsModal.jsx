import { useState } from 'react';
import { X, Music, Users, Clock, Hash } from 'lucide-react';

export default function StatsModal({ show, onClose }) {
  const [tab, setTab] = useState('tracks');
  if (!show) return null;

  let entries = [];
  try {
    entries = Object.values(JSON.parse(localStorage.getItem('rsp_stats') || '{}'));
  } catch {
    entries = [];
  }

  const totalPlays = entries.reduce((s, e) => s + (e.count || 0), 0);
  const unique = entries.length;
  const timeSec = entries.reduce((s, e) => s + (e.count || 0) * (e.duration_seconds || 210), 0);
  const fmtTime = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  };

  const byArtist = {};
  for (const e of entries) {
    const a = (e.artist || 'Desconocido').trim() || 'Desconocido';
    if (!byArtist[a]) byArtist[a] = { artist: a, count: 0, thumbnail: e.thumbnail };
    byArtist[a].count += e.count || 0;
  }
  const topArtists = Object.values(byArtist).sort((a, b) => b.count - a.count).slice(0, 20);
  const topTracks = [...entries].sort((a, b) => b.count - a.count).slice(0, 20);

  const card = (icon, label, value) => (
    <div style={{ flex: 1, minWidth: 92, padding: '10px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
      <div style={{ color: 'var(--accent)', display: 'flex', justifyContent: 'center', marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 520, width: '92vw' }}>
        <div className="modal-header">
          <h2>📊 Estadísticas de escucha</h2>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {!entries.length ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>Aún no hay canciones reproducidas.</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {card(<Hash size={16} />, 'Reproducciones', totalPlays)}
                {card(<Music size={16} />, 'Canciones', unique)}
                {card(<Clock size={16} />, 'Escuchado (aprox)', fmtTime(timeSec))}
                {card(<Users size={16} />, 'Top artista', topArtists[0]?.artist || '—')}
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button className={`nav-btn ${tab === 'tracks' ? 'active' : ''}`} style={{ fontSize: '0.78rem' }} onClick={() => setTab('tracks')}>Canciones</button>
                <button className={`nav-btn ${tab === 'artists' ? 'active' : ''}`} style={{ fontSize: '0.78rem' }} onClick={() => setTab('artists')}>Artistas</button>
              </div>

              {tab === 'tracks'
                ? topTracks.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--panel-border)' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-muted)', width: 22, textAlign: 'right' }}>{i + 1}</span>
                      <img src={s.thumbnail} alt="" style={{ width: 38, height: 38, borderRadius: 6, objectFit: 'cover' }} />
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.artist}</div>
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{s.count}×</div>
                    </div>
                  ))
                : topArtists.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--panel-border)' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-muted)', width: 22, textAlign: 'right' }}>{i + 1}</span>
                      <img src={a.thumbnail} alt="" style={{ width: 38, height: 38, borderRadius: 6, objectFit: 'cover' }} />
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.artist}</div>
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{a.count}×</div>
                    </div>
                  ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
