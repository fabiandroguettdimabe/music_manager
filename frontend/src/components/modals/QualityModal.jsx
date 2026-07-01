import { useEffect, useState } from 'react';
import { X, BarChart3, Play } from 'lucide-react';

const QUALITY_LABEL = {
  AUDIO_QUALITY_LOW: 'Baja',
  AUDIO_QUALITY_MEDIUM: 'Media',
  AUDIO_QUALITY_HIGH: 'Alta',
  AUDIO_QUALITY_ULTRALOW: 'Muy baja',
};

const kbps = (b) => (b ? Math.round(b / 1000) : '?');

export default function QualityModal({ show, onClose, ctx, onPlayVia, spotifyAuthed }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const ytId = ctx?.ytId;

  useEffect(() => {
    if (!show || !ytId) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setErr(false); setData(null);
    fetch(`/api/stream-quality/${ytId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setErr(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [show, ytId]);

  if (!show) return null;
  const best = data?.formats?.[0];

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 520, width: '92vw' }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BarChart3 size={18} /> Calidad de audio · A/B</h2>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ gap: 14 }}>
          <div className="q-track">
            <strong>{ctx?.title || '—'}</strong>{ctx?.artist ? <span> — {ctx.artist}</span> : null}
          </div>

          <div className="q-cols">
            {/* ── YouTube (datos reales) ── */}
            <div className="q-col yt">
              <div className="q-col-head">YouTube Music</div>
              {loading && <div className="q-muted">Analizando stream…</div>}
              {err && <div className="q-muted">No se pudo leer la calidad.</div>}
              {!loading && !err && !ytId && <div className="q-muted">Sin equivalente en YouTube.</div>}
              {best && (
                <>
                  <div className="q-big">{kbps(best.bitrate)}<small> kbps</small></div>
                  <div className="q-line">Códec: <b>{best.codec || best.container || '—'}</b></div>
                  <div className="q-line">Muestreo: <b>{best.sampleRate ? `${(best.sampleRate / 1000).toFixed(1)} kHz` : '—'}</b></div>
                  <div className="q-line">Calidad: <b>{QUALITY_LABEL[best.audioQuality] || '—'}</b></div>
                  {best.loudnessDb != null && <div className="q-line">Loudness: <b>{best.loudnessDb.toFixed(1)} dB</b></div>}
                </>
              )}
              <button className="q-play yt" onClick={() => onPlayVia('youtube')} disabled={!ytId}>
                <Play size={13} /> Escuchar aquí
              </button>
            </div>

            {/* ── Spotify (dato genérico: la API no expone el bitrate por pista) ── */}
            <div className="q-col sp">
              <div className="q-col-head">Spotify</div>
              <div className="q-big">≤ 320<small> kbps</small></div>
              <div className="q-line">Códec: <b>Ogg Vorbis</b></div>
              <div className="q-line q-muted">Premium 320 · Free 160 · Móvil 96</div>
              <div className="q-note-inline">El bitrate real por pista no lo expone la API (DRM); es orientativo.</div>
              <button className="q-play sp" onClick={() => onPlayVia('spotify')} disabled={!spotifyAuthed}>
                <Play size={13} /> Escuchar aquí
              </button>
            </div>
          </div>

          {data?.formats?.length > 1 && (
            <details className="q-details">
              <summary>Ver todos los formatos de YouTube ({data.formats.length})</summary>
              <div className="q-fmt-table">
                {data.formats.map((f, i) => (
                  <div key={i} className={`q-fmt-row ${i === 0 ? 'best' : ''}`}>
                    <span>{kbps(f.bitrate)} kbps</span>
                    <span>{f.codec || f.container || '—'}</span>
                    <span>{f.sampleRate ? `${(f.sampleRate / 1000).toFixed(1)} kHz` : '—'}</span>
                    <span>{QUALITY_LABEL[f.audioQuality] || ''}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="eq-note">
            A/B: cambia la fuente de la misma canción para comparar. En Spotify, el audio nativo
            requiere Premium y que el smart-play (Spotify vía YouTube) esté desactivado.
          </p>
        </div>
      </div>
    </div>
  );
}
