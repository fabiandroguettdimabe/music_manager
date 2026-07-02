import { useEffect, useState, useCallback } from 'react';
import { X, Play } from 'lucide-react';
import Modal from '../ui/Modal';

const TASKS = [
  { key: 'recommend', label: '✨ Recomendar canciones' },
  { key: 'organize', label: '🗂️ Reorganizar' },
  { key: 'themed', label: '🎯 Listas temáticas' },
  { key: 'dedupe', label: '🧹 Duplicados / limpiar' },
];

async function api(path, opts) {
  const res = await fetch(`/api/assistant/${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
  return data;
}

function TrackRow({ t, onAddNext }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--panel-border)' }}>
      {t.thumbnail ? (
        <img src={t.thumbnail} alt="" style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover' }} />
      ) : (
        <div style={{ width: 34 }} />
      )}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.artist}
        </div>
        {t.reason && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{t.reason}</div>}
      </div>
      {onAddNext && (
        <button className="action-btn" style={{ fontSize: '0.7rem', padding: '3px 8px' }} title="Reproducir a continuación" onClick={() => onAddNext(t)}>
          +cola
        </button>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: '0 0 8px' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function GroupActions({ tracks, label, onPlayTracks, onAddToBag, onSave }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={() => onPlayTracks(tracks, label)}>
        <Play size={13} /> Reproducir
      </button>
      <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={() => onAddToBag(tracks, label)}>
        ✚ A la bolsa
      </button>
      {onSave && (
        <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={onSave}>
          💾 Guardar
        </button>
      )}
    </div>
  );
}

export default function AssistantModal({ show, source, onClose, onPlayTracks, onAddToBag, onAddNext, showToast }) {
  const [tab, setTab] = useState('analyze');
  const [status, setStatus] = useState(null); // { configured, model }
  const [tasks, setTasks] = useState({ recommend: true, organize: true, themed: true, dedupe: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState([]);

  useEffect(() => {
    if (!show) return;
    setError(null);
    api('status').then(setStatus).catch(() => setStatus({ configured: false }));
  }, [show]);

  useEffect(() => {
    if (!show) {
      setResult(null);
      setError(null);
      setTab('analyze');
    }
  }, [show]);

  const loadSaved = useCallback(() => {
    api('playlists').then(setSaved).catch((e) => showToast(e.message, true));
  }, [showToast]);

  useEffect(() => {
    if (show && tab === 'saved') loadSaved();
  }, [show, tab, loadSaved]);

  const selectedTasks = Object.keys(tasks).filter((k) => tasks[k]);

  const analyze = async () => {
    if (!selectedTasks.length) {
      showToast('Selecciona al menos una tarea.', true);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api('analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { kind: source.kind, id: source.id }, tasks: selectedTasks }),
      });
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const saveThemed = async (name, tracks) => {
    try {
      const r = await api('save-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tracks }),
      });
      showToast(`Lista "${r.name}" guardada (${r.count})`);
      if (tab === 'saved') loadSaved();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const playSaved = async (id, name) => {
    try {
      const r = await api(`playlists/${id}`);
      if (!r.tracks?.length) return showToast('La lista está vacía.', true);
      onPlayTracks(r.tracks, name);
      onClose();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const deleteSaved = async (id) => {
    try {
      await api(`playlists/${id}`, { method: 'DELETE' });
      loadSaved();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  return (
    <Modal show={show} onClose={onClose} maxWidth={640} style={{ width: '92vw' }}>
      {() => (
        <>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            ✨ Asistente IA
            {source?.title && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 400 }}>· {source.title}</span>}
          </h2>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '0 24px 10px' }}>
          <button className={`action-btn ${tab === 'analyze' ? 'active' : ''}`} style={{ fontSize: '0.78rem' }} onClick={() => setTab('analyze')}>
            Analizar
          </button>
          <button className={`action-btn ${tab === 'saved' ? 'active' : ''}`} style={{ fontSize: '0.78rem' }} onClick={() => setTab('saved')}>
            Mis listas IA
          </button>
        </div>

        <div className="modal-body">
          {status && !status.configured && (
            <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,180,0,0.12)', fontSize: '0.8rem', marginBottom: 12 }}>
              ⚠️ Falta la API key de Gemini. Consíguela gratis en{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                aistudio.google.com/apikey
              </a>{' '}
              y ponla en <code>backend-node/.env</code> (GEMINI_API_KEY), luego reinicia el backend de dev.
            </div>
          )}

          {tab === 'analyze' && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {TASKS.map((t) => (
                  <label key={t.key} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={tasks[t.key]} onChange={(e) => setTasks((s) => ({ ...s, [t.key]: e.target.checked }))} />
                    {t.label}
                  </label>
                ))}
              </div>

              <button className="action-btn" style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }} onClick={analyze} disabled={loading || (status && !status.configured)}>
                {loading ? 'Analizando con Gemini…' : '✨ Analizar playlist'}
              </button>

              {error && <div style={{ color: 'var(--accent)', fontSize: '0.8rem', marginBottom: 12 }}>⚠️ {error}</div>}

              {result && (
                <div>
                  {result.summary && <p style={{ fontSize: '0.85rem', marginBottom: 16 }}>{result.summary}</p>}
                  {result.truncated && (
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                      Analizadas las primeras {result.analyzed} de {result.trackCount} canciones.
                    </p>
                  )}

                  {result.recommendations?.length > 0 && (
                    <Section title={`Recomendadas (${result.recommendations.length})`}>
                      {result.recommendations.map((t) => (
                        <TrackRow key={t.id} t={t} onAddNext={onAddNext} />
                      ))}
                      <GroupActions tracks={result.recommendations} label="Recomendadas IA" onPlayTracks={onPlayTracks} onAddToBag={onAddToBag} />
                    </Section>
                  )}

                  {result.organization?.length > 0 && (
                    <Section title="Organización propuesta">
                      {result.organization.map((g, i) => (
                        <div key={i} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                            {g.group} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({g.tracks.length})</span>
                          </div>
                          {g.reason && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{g.reason}</div>}
                          <GroupActions tracks={g.tracks} label={g.group} onPlayTracks={onPlayTracks} onAddToBag={onAddToBag} />
                        </div>
                      ))}
                    </Section>
                  )}

                  {result.themed?.length > 0 && (
                    <Section title="Listas temáticas">
                      {result.themed.map((p, i) => (
                        <div key={i} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                            {p.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({p.tracks.length})</span>
                          </div>
                          {p.description && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.description}</div>}
                          <GroupActions
                            tracks={p.tracks}
                            label={p.name}
                            onPlayTracks={onPlayTracks}
                            onAddToBag={onAddToBag}
                            onSave={() => saveThemed(p.name, p.tracks)}
                          />
                        </div>
                      ))}
                    </Section>
                  )}

                  {result.duplicates?.length > 0 && (
                    <Section title="Posibles duplicados">
                      {result.duplicates.map((d, i) => (
                        <div key={i} style={{ marginBottom: 10, fontSize: '0.8rem' }}>
                          {d.reason && <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{d.reason}</div>}
                          {d.tracks.map((t) => `${t.title} — ${t.artist}`).join('  /  ')}
                        </div>
                      ))}
                    </Section>
                  )}

                  {result.outliers?.length > 0 && (
                    <Section title="Se salen del estilo">
                      {result.outliers.map((o, i) => (
                        <div key={i} style={{ marginBottom: 8, fontSize: '0.8rem' }}>
                          <span style={{ fontWeight: 500 }}>{o.track.title}</span> — {o.track.artist}
                          {o.reason && <span style={{ color: 'var(--text-muted)' }}> · {o.reason}</span>}
                        </div>
                      ))}
                    </Section>
                  )}
                </div>
              )}
            </>
          )}

          {tab === 'saved' && (
            <div>
              {!saved.length ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
                  Aún no has guardado listas del asistente. Genera listas temáticas y pulsa 💾 Guardar.
                </p>
              ) : (
                saved.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--panel-border)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.86rem' }}>{p.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.count} canciones</div>
                    </div>
                    <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={() => playSaved(p.id, p.name)}>
                      <Play size={13} /> Reproducir
                    </button>
                    <button className="action-btn danger-btn" style={{ fontSize: '0.74rem' }} onClick={() => deleteSaved(p.id)} title="Eliminar">
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        </>
      )}
    </Modal>
  );
}
