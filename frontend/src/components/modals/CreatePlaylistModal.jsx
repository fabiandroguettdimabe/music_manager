import { useEffect, useMemo, useState } from 'react';
import { X, ListPlus, Loader2, ExternalLink, Music } from 'lucide-react';
import Modal from '../ui/Modal';

// De un track del reproductor a su id de video de YouTube (11 chars) o su URI de Spotify.
const ytIdOf = (t) =>
  t && t.source !== 'spotify' && typeof t.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(t.id)
    ? t.id
    : null;
const spUriOf = (t) => {
  if (typeof t?.uri === 'string' && t.uri.startsWith('spotify:track:')) return t.uri;
  if (t?.source === 'spotify' && typeof t?.id === 'string' && t.id.startsWith('spotify:track:')) return t.id;
  return null;
};

export default function CreatePlaylistModal({
  show,
  onClose,
  tracks,
  defaultName,
  ytAuthed,
  spotifyAuthed,
  spotifyCanModify,
  onReconnectSpotify,
  showToast,
}) {
  const [name, setName] = useState('');
  const [dest, setDest] = useState('ytmusic');
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(null); // { url, count, dest }

  // Para cada destino: cuántas pistas son nativas (id/uri directo) y cuántas se resolverán
  // buscando su equivalente (las de otro origen que tengan título).
  const forYt = useMemo(() => {
    let direct = 0, search = 0;
    for (const t of tracks || []) {
      if (ytIdOf(t)) direct++;
      else if (t?.title) search++;
    }
    return { direct, search, total: direct + search };
  }, [tracks]);
  const forSp = useMemo(() => {
    let direct = 0, search = 0;
    for (const t of tracks || []) {
      if (spUriOf(t)) direct++;
      else if (t?.title) search++;
    }
    return { direct, search, total: direct + search };
  }, [tracks]);

  useEffect(() => {
    if (show) {
      setName(defaultName || '');
      setDone(null);
      setLoading(false);
      setDest(ytAuthed ? 'ytmusic' : 'spotify');
    }
  }, [show, defaultName, ytAuthed]);

  return (
    <Modal show={show} onClose={onClose} maxWidth={460} style={{ width: '92vw' }}>
      {() => {
  const isYt = dest === 'ytmusic';
  const sel = isYt ? forYt : forSp;
  const count = sel.total;
  const spotifyBlocked = dest === 'spotify' && spotifyAuthed && !spotifyCanModify;

  const trim = (t) => ({ id: t.id, uri: t.uri, title: t.title, artist: t.artist, source: t.source });

  const create = async () => {
    const nm = name.trim();
    if (!nm) return showToast('Ponle un nombre a la playlist.', true);
    if (!count) {
      return showToast('No hay canciones para subir.', true);
    }
    setLoading(true);
    try {
      const path = isYt ? '/api/create-playlist' : '/api/spotify/create-playlist';
      // Pistas elegibles en su orden original: nativas + las que tienen título (se buscan).
      const payloadTracks = (tracks || [])
        .filter((t) => (isYt ? ytIdOf(t) || t?.title : spUriOf(t) || t?.title))
        .map(trim);
      const payload = isYt
        ? { name: nm, tracks: payloadTracks }
        : { name: nm, tracks: payloadTracks, public: isPublic };
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
      setDone({ url: data.url || '', count: data.count, matched: data.matched || 0, skipped: data.skipped || 0, dest });
      showToast(`✅ "${nm}" creada en ${isYt ? 'YT Music' : 'Spotify'} (${data.count} canciones).`);
    } catch (e) {
      showToast(e.message || 'No se pudo crear la playlist.', true);
    } finally {
      setLoading(false);
    }
  };

  const destBtn = (key, label, icon, ok, n) => (
    <button
      className={`action-btn ${dest === key ? 'active' : ''}`}
      style={{ flex: 1, justifyContent: 'center', opacity: ok ? 1 : 0.5 }}
      disabled={!ok}
      onClick={() => setDest(key)}
      title={ok ? '' : 'Conéctate primero a este servicio'}
    >
      {icon} {label} <span style={{ opacity: 0.7, fontSize: '0.74rem' }}>({n})</span>
    </button>
  );

  return (
        <>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ListPlus size={20} /> Crear playlist
          </h2>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {done ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>✅</div>
              <p style={{ fontSize: '0.9rem', marginBottom: 6 }}>
                Playlist creada en {done.dest === 'ytmusic' ? 'YouTube Music' : 'Spotify'} con{' '}
                <strong>{done.count}</strong> canciones.
              </p>
              {done.matched > 0 && (
                <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  {done.matched} encontradas buscando su equivalente.
                </p>
              )}
              {done.skipped > 0 && (
                <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                  {done.skipped} no se pudieron encontrar y se omitieron.
                </p>
              )}
              {done.url && (
                <a
                  className="action-btn"
                  href={done.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-flex' }}
                >
                  <ExternalLink size={14} /> Abrir en Spotify
                </a>
              )}
              {done.dest === 'ytmusic' && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 10 }}>
                  Aparecerá en tu biblioteca de YouTube Music (puede tardar unos segundos en refrescar).
                </p>
              )}
            </div>
          ) : (
            <>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Nombre
              </label>
              <input
                className="text-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mi mezcla"
                autoFocus
                style={{
                  width: '100%', padding: '10px 12px', marginBottom: 16, borderRadius: 10,
                  background: 'rgba(0,0,0,0.25)', border: '1px solid var(--panel-border)',
                  color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none',
                }}
              />

              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Subir a
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {destBtn('ytmusic', 'YT Music', <Music size={14} />, ytAuthed, forYt.total)}
                {destBtn('spotify', 'Spotify', <Music size={14} />, spotifyAuthed, forSp.total)}
              </div>

              {spotifyBlocked ? (
                <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,180,0,0.12)', fontSize: '0.8rem', marginBottom: 12 }}>
                  ⚠️ Para crear playlists en Spotify hay que reconectar la cuenta y aceptar el permiso de
                  edición de playlists.
                  {onReconnectSpotify && (
                    <div style={{ marginTop: 8 }}>
                      <button className="action-btn" onClick={onReconnectSpotify}>Reconectar Spotify</button>
                    </div>
                  )}
                </div>
              ) : (
                dest === 'spotify' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', marginBottom: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                    Playlist pública
                  </label>
                )
              )}

              <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 14 }}>
                Se subirán <strong>{count}</strong> canciones
                {sel.search > 0 && (
                  <> — {sel.direct} directas + {sel.search} buscando su equivalente en{' '}
                  {isYt ? 'YT Music' : 'Spotify'} (puede tardar un poco)</>
                )}.
              </p>

              <button
                className="action-btn"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={create}
                disabled={loading || spotifyBlocked || !count}
              >
                {loading ? <Loader2 size={15} className="spin-icon" /> : <ListPlus size={15} />}{' '}
                {loading
                  ? sel.search > 0 ? 'Buscando y creando…' : 'Creando…'
                  : `Crear en ${isYt ? 'YT Music' : 'Spotify'}`}
              </button>
            </>
          )}
        </div>
        </>
        );
      }}
    </Modal>
  );
}
