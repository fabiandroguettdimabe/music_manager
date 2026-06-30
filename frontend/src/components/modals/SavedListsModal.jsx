import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Play, Plus, Save, Trash2, Pencil, RefreshCw, Download, Upload, ArrowLeft, Search } from 'lucide-react';

// Parsea una línea CSV respetando comillas (campos con comas, p.ej. géneros).
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Parsea un CSV (Exportify u similar) → [{ uri, title, artist, durationMs }].
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const find = (preds) => header.findIndex((h) => preds.some((p) => h === p || h.includes(p)));
  const ti = find(['track name', 'title', 'name']);
  const ai = find(['artist name(s)', 'artist name', 'artist', 'artists']);
  const di = find(['duration (ms)', 'duration ms', 'duration_ms', 'duration']);
  const ui = find(['track uri', 'uri', 'spotify track id']);
  if (ti < 0) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const title = (c[ti] || '').trim();
    if (!title) continue;
    rows.push({
      title,
      artist: ai >= 0 ? (c[ai] || '').trim() : '',
      durationMs: di >= 0 ? Number(c[di]) || 0 : 0,
      uri: ui >= 0 ? (c[ui] || '').trim() : '',
    });
  }
  return rows;
}

// Deriva el uid (igual que el backend) para quitar/reordenar pistas en el editor.
function uidOf(t) {
  if (t?.source === 'spotify') {
    const uri = t.uri || t.id || '';
    const pid = uri.includes(':') ? uri.split(':').pop() : uri;
    return pid ? `spotify:${pid}` : null;
  }
  const pid = t?.id || '';
  return pid ? `ytmusic:${pid}` : null;
}

async function api(path, opts) {
  const res = await fetch(`/api/library/${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
  return data;
}

// Tiempo relativo legible ("hace 2 h") para la última sincronización.
function timeAgo(iso) {
  if (!iso) return null;
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

// Cuenta cuántas pistas hay de cada servicio para mostrar un resumen al guardar.
function summarize(tracks) {
  let sp = 0;
  let yt = 0;
  for (const t of tracks || []) {
    if (t?.source === 'spotify') sp++;
    else yt++;
  }
  const parts = [];
  if (yt) parts.push(`${yt} YouTube`);
  if (sp) parts.push(`${sp} Spotify`);
  return parts.join(' · ');
}

export default function SavedListsModal({ show, onClose, currentTracks, currentTitle, onPlayTracks, onMixTracks, showToast }) {
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [synced, setSynced] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [editing, setEditing] = useState(null); // { id, name, tracks } | null
  const [editName, setEditName] = useState('');
  const [replacing, setReplacing] = useState(null); // { uid, index, query, results, loading } | null
  const dragTrackIdx = useRef(null);
  const importInputRef = useRef(null);
  const [importJob, setImportJob] = useState(null); // { jobId, name, total, done, matched, failed, status }
  const importTimer = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    api('playlists')
      .then(setSaved)
      .catch((e) => showToast(e.message, true))
      .finally(() => setLoading(false));
  }, [showToast]);

  // Listas sincronizadas automáticamente desde los servicios (PlaylistCache).
  const loadSynced = useCallback(() => {
    api('synced').then(setSynced).catch(() => {});
    api('sync/status').then(setSyncStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!show) return;
    load();
    loadSynced();
    // Sugiere el título de lo que está sonando como nombre por defecto.
    const base = (currentTitle || '').split(' ✚ ')[0].trim();
    setName(base && !/^(Ninguna|Cargando)/i.test(base) ? base : '');
  }, [show, currentTitle, load, loadSynced]);

  // Limpia el polling del import al desmontar.
  useEffect(() => () => clearInterval(importTimer.current), []);

  if (!show) return null;

  const canSave = (currentTracks?.length || 0) > 0;

  const saveCurrent = async () => {
    if (!canSave) return showToast('No hay una lista cargada para guardar.', true);
    const nm = name.trim();
    if (!nm) return showToast('Ponle un nombre a la lista.', true);
    setSaving(true);
    try {
      const r = await api('playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm, tracks: currentTracks }),
      });
      showToast(`Lista "${r.name}" guardada (${r.count} canciones)`);
      load();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      setSaving(false);
    }
  };

  const play = async (id, nm) => {
    try {
      const r = await api(`playlists/${id}`);
      if (!r.tracks?.length) return showToast('La lista está vacía.', true);
      onPlayTracks(r.tracks, nm);
      onClose();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  // Mezcla la copia guardada (desde la DB) con la bolsa actual, sin volver a
  // pedirla al servicio de origen. Esto permite mezclar contenido de Spotify
  // que su API no entrega en vivo (p.ej. una playlist guardada antes).
  const mix = async (id, nm) => {
    try {
      const r = await api(`playlists/${id}`);
      if (!r.tracks?.length) return showToast('La lista está vacía.', true);
      onMixTracks(r.tracks, nm);
      onClose();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const remove = async (id, nm) => {
    if (!window.confirm(`¿Eliminar la lista "${nm}"?`)) return;
    try {
      await api(`playlists/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  // Lanza una sincronización inmediata de tus listas (YT Music + Spotify propias).
  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api('sync', { method: 'POST' });
      showToast(`Sincronizado: ${r.playlists} listas · ${r.tracks} canciones`);
      loadSynced();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      setSyncing(false);
    }
  };

  // Reproduce o mezcla una lista sincronizada leyendo sus pistas de la DB.
  const openSynced = async (s, mixIt) => {
    try {
      const r = await api(`synced/${s.provider}/${encodeURIComponent(s.providerId)}`);
      if (!r.tracks?.length) return showToast('Esa lista sincronizada está vacía.', true);
      (mixIt ? onMixTracks : onPlayTracks)(r.tracks, s.title);
      onClose();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  // ───────── Editor de una lista guardada (renombrar / quitar / reordenar) ─────────
  const openEditor = async (p) => {
    try {
      const r = await api(`playlists/${p.id}`);
      setEditing({ id: p.id, name: p.name, tracks: r.tracks || [] });
      setEditName(p.name);
    } catch (e) { showToast(e.message, true); }
  };
  const closeEditor = () => { setEditing(null); load(); };

  const saveEditorName = async () => {
    const nm = editName.trim();
    if (!editing || !nm || nm === editing.name) return;
    try {
      await api(`playlists/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm }) });
      setEditing((e) => ({ ...e, name: nm }));
      showToast('Nombre actualizado');
    } catch (e) { showToast(e.message, true); }
  };

  const removeTrackEditor = async (t) => {
    const uid = uidOf(t);
    if (!uid || !editing) return;
    try {
      await api(`playlists/${editing.id}/tracks/${encodeURIComponent(uid)}`, { method: 'DELETE' });
      setEditing((e) => ({ ...e, tracks: e.tracks.filter((x) => uidOf(x) !== uid) }));
    } catch (e) { showToast(e.message, true); }
  };

  const reorderEditor = async (from, to) => {
    if (from == null || to == null || from === to || !editing) return;
    const next = [...editing.tracks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setEditing((e) => ({ ...e, tracks: next }));
    try {
      await api(`playlists/${editing.id}/order`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uids: next.map(uidOf).filter(Boolean) }) });
    } catch (e) { showToast(e.message, true); }
  };

  // ───────── Corregir un match: buscar en YouTube y reemplazar ─────────
  const openReplace = (t, idx) => {
    const q = `${t.title || ''} ${t.artist || ''}`.trim();
    setReplacing({ uid: uidOf(t), index: idx, query: q, results: [], loading: true });
    runReplaceSearch(q);
  };
  const runReplaceSearch = async (q) => {
    if (!q.trim()) return;
    setReplacing((r) => (r ? { ...r, loading: true } : r));
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const d = await res.json().catch(() => ({}));
      setReplacing((r) => (r ? { ...r, results: (d.tracks || []).slice(0, 6), loading: false } : r));
    } catch {
      setReplacing((r) => (r ? { ...r, results: [], loading: false } : r));
    }
  };
  const applyReplace = async (yt) => {
    if (!editing || !replacing) return;
    const track = { ...yt, source: 'youtube' };
    try {
      await api(`playlists/${editing.id}/replace`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldUid: replacing.uid, track }),
      });
      const i = replacing.index;
      setEditing((e) => { const tr = [...e.tracks]; tr[i] = track; return { ...e, tracks: tr }; });
      setReplacing(null);
      showToast('Pista reemplazada');
    } catch (e) { showToast(e.message, true); }
  };

  // ───────── Export / Import (JSON) ─────────
  const downloadJson = (name, tracks) => {
    const blob = new Blob([JSON.stringify({ name, tracks }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(name || 'lista').replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportList = async (id, nm) => {
    try {
      const r = await api(`playlists/${id}`);
      downloadJson(nm, r.tracks || []);
    } catch (e) { showToast(e.message, true); }
  };
  const handleImport = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const tracks = Array.isArray(data) ? data : data.tracks;
      const nm = (data.name || file.name.replace(/\.json$/i, '') || 'Lista importada').trim();
      if (!Array.isArray(tracks) || !tracks.length) return showToast('El archivo no tiene canciones válidas.', true);
      const r = await api('playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm, tracks }) });
      showToast(`Importada "${r.name}" (${r.count} canciones)`);
      load();
    } catch (e) { showToast('No se pudo importar: ' + e.message, true); }
  };

  // Importa un CSV (Exportify): empareja cada pista con YouTube en segundo plano + progreso.
  const importCsv = async (file) => {
    const rows = parseCsv(await file.text());
    if (!rows.length) return showToast('No se encontraron canciones en el CSV (¿formato correcto?).', true);
    const name = (file.name.replace(/\.csv$/i, '').replace(/_/g, ' ').trim()) || 'Importada';
    try {
      const r = await api('import-csv', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, rows }),
      });
      showToast(`Importando "${name}" (${r.total} canciones) — emparejando con YouTube…`);
      setImportJob({ jobId: r.jobId, name, total: r.total, done: 0, matched: 0, failed: 0, status: 'running' });
      clearInterval(importTimer.current);
      importTimer.current = setInterval(async () => {
        try {
          const p = await api(`import-csv/${r.jobId}`);
          setImportJob({ jobId: r.jobId, name, total: p.total ?? r.total, done: p.done ?? 0, matched: p.matched ?? 0, duplicates: p.duplicates ?? 0, failed: p.failed ?? 0, status: p.status });
          if (p.status === 'done' || p.status === 'error' || p.status === 'unknown') {
            clearInterval(importTimer.current);
            load();
            if (p.status === 'done') showToast(`"${name}" lista: ${p.matched} emparejadas${p.failed ? `, ${p.failed} no encontradas` : ''}.`);
            setTimeout(() => setImportJob(null), 5000);
          }
        } catch { /* reintentar en el próximo tick */ }
      }, 2000);
    } catch (e) { showToast('No se pudo importar el CSV: ' + e.message, true); }
  };

  // Despacha por extensión: .csv → emparejado con YouTube; .json → importación directa.
  const handleFile = (file) => {
    if (!file) return;
    if (/\.csv$/i.test(file.name)) importCsv(file);
    else handleImport(file);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 560, width: '92vw' }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>🗂️ Mis Listas</h2>
          {!editing && (
            <button className="action-btn" style={{ fontSize: '0.74rem', marginLeft: 'auto', marginRight: 8 }} onClick={() => importInputRef.current?.click()} title="Importar lista: JSON, o CSV de Spotify (Exportify) → se empareja con YouTube">
              <Upload size={14} /> Importar
            </button>
          )}
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <input ref={importInputRef} type="file" accept="application/json,.json,text/csv,.csv" style={{ display: 'none' }}
          onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />

        <div className="modal-body">
          {importJob && (
            <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'rgba(30,215,96,0.08)', border: '1px solid var(--panel-border)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                {importJob.status === 'running' ? '🔗 Emparejando con YouTube' : importJob.status === 'done' ? '✅ Importación completa' : '⚠️ Importación detenida'}: <strong>{importJob.name}</strong>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${importJob.total ? Math.round((importJob.done / importJob.total) * 100) : 0}%`, background: 'var(--accent)', transition: 'width .3s' }} />
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                {importJob.done} / {importJob.total} · {importJob.matched} emparejadas{importJob.duplicates ? ` · ${importJob.duplicates} duplicadas` : ''}{importJob.failed ? ` · ${importJob.failed} no encontradas` : ''}
              </div>
            </div>
          )}
          {editing ? (
            <div>
              {/* Editor de lista: renombrar, quitar, reordenar, exportar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={closeEditor} title="Volver">
                  <ArrowLeft size={14} /> Volver
                </button>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={saveEditorName}
                  onKeyDown={(e) => e.key === 'Enter' && saveEditorName()}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.2)', color: 'inherit', fontSize: '0.9rem' }} />
                <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={() => downloadJson(editing.name, editing.tracks)} title="Exportar a JSON">
                  <Download size={14} /> Exportar
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                {editing.tracks.length} canciones · arrastra ⠿ para reordenar
              </div>
              <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                {editing.tracks.map((t, idx) => (
                  <div key={`${uidOf(t)}-${idx}`}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: replacing?.index === idx ? 'none' : '1px solid var(--panel-border)' }}
                      draggable
                      onDragStart={(e) => { dragTrackIdx.current = idx; e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); reorderEditor(dragTrackIdx.current, idx); dragTrackIdx.current = null; }}
                      onDragEnd={() => { dragTrackIdx.current = null; }}>
                      <span title="Arrastra para reordenar" style={{ cursor: 'grab', color: 'var(--text-muted)', flexShrink: 0 }}>⠿</span>
                      <img src={t.thumbnail} alt="" loading="lazy" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.artist}</div>
                      </div>
                      <span className={`track-source-badge ${t.source === 'spotify' ? 'spotify' : 'ytmusic'}`} style={{ flexShrink: 0 }}>{t.source === 'spotify' ? 'SP' : 'YT'}</span>
                      <button className="action-btn" style={{ fontSize: '0.72rem', color: replacing?.index === idx ? 'var(--accent)' : undefined }} onClick={() => (replacing?.index === idx ? setReplacing(null) : openReplace(t, idx))} title="Reemplazar (buscar otra versión en YouTube)">
                        <Search size={13} />
                      </button>
                      <button className="action-btn danger-btn" style={{ fontSize: '0.72rem' }} onClick={() => removeTrackEditor(t)} title="Quitar de la lista">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {replacing?.index === idx && (
                      <div style={{ padding: '8px 0 12px 44px', borderBottom: '1px solid var(--panel-border)' }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <input value={replacing.query} onChange={(e) => setReplacing((r) => r && { ...r, query: e.target.value })}
                            onKeyDown={(e) => e.key === 'Enter' && runReplaceSearch(replacing.query)} placeholder="Buscar en YouTube…"
                            style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.2)', color: 'inherit', fontSize: '0.8rem' }} />
                          <button className="action-btn" style={{ fontSize: '0.72rem' }} onClick={() => runReplaceSearch(replacing.query)}><Search size={13} /></button>
                        </div>
                        {replacing.loading ? (
                          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0 }}>Buscando…</p>
                        ) : !replacing.results.length ? (
                          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0 }}>Sin resultados.</p>
                        ) : replacing.results.map((r) => (
                          <div key={r.id} onClick={() => applyReplace(r)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, cursor: 'pointer' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                            <img src={r.thumbnail} alt="" style={{ width: 30, height: 30, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.artist}</div>
                            </div>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>{r.duration}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {!editing.tracks.length && (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px 0' }}>La lista quedó vacía.</p>
                )}
              </div>
            </div>
          ) : (
          <>
          {/* Guardar la lista en reproducción */}
          <div style={{ marginBottom: 18, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--panel-border)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
              {canSave ? (
                <>Guardar la lista en reproducción · <span style={{ color: 'var(--text-muted)' }}>{summarize(currentTracks)}</span></>
              ) : (
                'Carga una playlist (YT Music, YouTube o Spotify) para poder guardarla.'
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={canSave ? 'Nombre de la lista' : 'Sin lista cargada'}
                disabled={!canSave || saving}
                onKeyDown={(e) => e.key === 'Enter' && saveCurrent()}
                style={{
                  flex: 1, padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.2)',
                  color: 'inherit', fontSize: '0.85rem',
                }}
              />
              <button className="action-btn" onClick={saveCurrent} disabled={!canSave || saving}>
                <Save size={14} /> {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>

          {/* Listas guardadas */}
          {loading ? (
            <div>
              {[0, 1, 2].map((k) => (
                <div key={k} className="skeleton-row">
                  <div className="skeleton" style={{ width: 40, height: 40 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ width: '55%', height: 12, marginBottom: 6 }} />
                    <div className="skeleton" style={{ width: '28%', height: 10 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : !saved.length ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px 0' }}>
              Aún no tienes listas guardadas. Carga una playlist y pulsa 💾 Guardar.
            </p>
          ) : (
            saved.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--panel-border)' }}>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.count} canciones</div>
                </div>
                <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={() => play(p.id, p.name)} title="Reproducir desde la copia guardada">
                  <Play size={13} /> Reproducir
                </button>
                <button className="action-btn" style={{ fontSize: '0.74rem', borderColor: 'rgba(30,215,96,0.3)', color: 'hsl(141,74%,42%)' }} onClick={() => mix(p.id, p.name)} title="Mezclar con la bolsa actual (desde la copia guardada)">
                  <Plus size={13} /> Mezclar
                </button>
                <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={() => openEditor(p)} title="Editar (renombrar, quitar, reordenar)">
                  <Pencil size={13} />
                </button>
                <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={() => exportList(p.id, p.name)} title="Exportar a JSON">
                  <Download size={13} />
                </button>
                <button className="action-btn danger-btn" style={{ fontSize: '0.74rem' }} onClick={() => remove(p.id, p.name)} title="Eliminar">
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}

          {/* Sincronizadas automáticamente (YT Music + Spotify propias) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 8px' }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              🔄 Sincronizadas <span style={{ color: 'var(--text-muted)' }}>({synced.length})</span>
              {syncStatus?.lastRun?.at && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>· última: {timeAgo(syncStatus.lastRun.at)}</span>
              )}
            </div>
            <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={syncNow} disabled={syncing} title="Sincronizar ahora tus listas (YT Music + Spotify propias)">
              <RefreshCw size={13} className={syncing ? 'spin-icon' : undefined} /> {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
          </div>

          {!synced.length ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px 0', fontSize: '0.8rem' }}>
              Nada sincronizado aún. Pulsa "Sincronizar ahora" o espera al sync automático.
            </p>
          ) : (
            synced.map((s) => (
              <div key={`${s.provider}:${s.providerId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--panel-border)' }}>
                <span className={`track-source-badge ${s.provider === 'spotify' ? 'spotify' : 'ytmusic'}`} style={{ flexShrink: 0 }}>{s.provider === 'spotify' ? 'SP' : 'YT'}</span>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{s.count} canciones</div>
                </div>
                <button className="action-btn" style={{ fontSize: '0.74rem' }} onClick={() => openSynced(s, false)} title="Reproducir desde la copia sincronizada">
                  <Play size={13} /> Reproducir
                </button>
                <button className="action-btn" style={{ fontSize: '0.74rem', borderColor: 'rgba(30,215,96,0.3)', color: 'hsl(141,74%,42%)' }} onClick={() => openSynced(s, true)} title="Mezclar con la bolsa actual">
                  <Plus size={13} /> Mezclar
                </button>
              </div>
            ))
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
