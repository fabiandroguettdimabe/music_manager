import { useRef, useState, useEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, ChevronDown, Heart, Loader2, Mic2, Maximize2, Minimize2 } from 'lucide-react';
import Visualizer from './Visualizer';

/**
 * Vista de reproducción a pantalla completa. Reutiliza los handlers del reproductor
 * principal (no duplica lógica): recibe estado + callbacks por props.
 * Incluye letra (lrclib sincronizada + respaldo lyrics.ovh) vía /api/lyrics.
 */
export default function NowPlaying({
  show, track, isPlaying, currentTime, duration, progress, fmt,
  engineLabel, isBuffering, isFavorite, nextUp,
  volume, isMuted, VolumeIcon,
  onClose, onTogglePlay, onNext, onPrev, onToggleFav, onToggleMute,
  onSeekPointerDown, onSeekPointerMove, onVolPointerDown, onVolPointerMove,
}) {
  const touchY = useRef(null);
  const activeLineRef = useRef(null);
  const karaokeLineRef = useRef(null);
  const [showLyrics, setShowLyrics] = useState(false);
  const [karaoke, setKaraoke] = useState(false); // vista karaoke a pantalla completa
  const [lyrics, setLyrics] = useState(null); // { source, synced, plain } | null
  const [lyricsState, setLyricsState] = useState('idle'); // 'idle' | 'loading' | 'done'

  // Salir de karaoke al cerrar la vista o cambiar de pista.
  useEffect(() => { if (!show) setKaraoke(false); }, [show]);

  // Buscar letra al cambiar de pista (solo con la vista abierta).
  useEffect(() => {
    if (!show || !track) return;
    let cancelled = false;
    setLyrics(null);
    setLyricsState('loading');
    const p = new URLSearchParams({ title: track.title || '', artist: track.artist || '' });
    if (track.duration_seconds) p.set('duration', String(track.duration_seconds));
    fetch(`/api/lyrics?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setLyrics(d); setLyricsState('done'); } })
      .catch(() => { if (!cancelled) { setLyrics(null); setLyricsState('done'); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, track?.id]);

  // Línea activa de la letra sincronizada según el tiempo de reproducción.
  const synced = lyrics?.synced;
  let activeIdx = -1;
  if (synced && synced.length) {
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].t <= currentTime + 0.25) activeIdx = i; else break;
    }
  }
  // Auto-scroll de la línea activa al centro (panel normal y vista karaoke).
  useEffect(() => {
    if (karaoke && karaokeLineRef.current) {
      karaokeLineRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (showLyrics && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeIdx, showLyrics, karaoke]);

  if (!show || !track) return null;
  const fallbackArt = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=900&auto=format&fit=crop';
  const hasSynced = !!(synced && synced.length);

  // ── Vista Karaoke: letras sincronizadas a pantalla completa ──
  if (karaoke && hasSynced) {
    return (
      <div className="nowplaying-overlay karaoke-overlay"
        onTouchStart={(e) => { touchY.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => { if (touchY.current != null && e.changedTouches[0].clientY - touchY.current > 80) onClose(); touchY.current = null; }}>
        <div className="nowplaying-bg karaoke-bg" style={{ backgroundImage: `url('${track.thumbnail || fallbackArt}')` }} />
        <div className="karaoke-content">
          <div className="karaoke-top">
            <button className="np-icon-btn" onClick={() => setKaraoke(false)} title="Salir de karaoke"><Minimize2 size={22} /></button>
            <div className="karaoke-title"><strong>{track.title}</strong><span>{track.artist}</span></div>
            <button className="np-icon-btn" onClick={onClose} title="Cerrar"><ChevronDown size={24} /></button>
          </div>

          <div className="karaoke-lines">
            {synced.map((l, i) => {
              const d = Math.abs(i - activeIdx);
              const cls = i === activeIdx ? 'active' : d === 1 ? 'near' : d === 2 ? 'far' : 'dim';
              return (
                <p key={i} ref={i === activeIdx ? karaokeLineRef : null} className={`karaoke-line ${cls}`}>
                  {l.text || '♪'}
                </p>
              );
            })}
          </div>

          <div className="karaoke-bottom">
            <div className="nowplaying-progress karaoke-progress">
              <span>{fmt(currentTime)}</span>
              <div className="progress-bar-container" onPointerDown={onSeekPointerDown} onPointerMove={onSeekPointerMove}
                style={{ touchAction: 'none', flex: 1 }}>
                <div className="progress-bar-bg" />
                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                <div className="progress-knob" style={{ left: `${progress}%` }} />
              </div>
              <span>{fmt(duration)}</span>
            </div>
            <div className="karaoke-controls">
              <button className="control-btn secondary" onClick={onPrev}><SkipBack size={26} /></button>
              <button className={`control-btn play-btn ${isPlaying ? 'playing' : ''}`} onClick={onTogglePlay}>
                {isBuffering
                  ? <Loader2 size={28} className="spin-icon" />
                  : isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" style={{ marginLeft: 4 }} />}
              </button>
              <button className="control-btn secondary" onClick={onNext}><SkipForward size={26} /></button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const lyricsPanel = (
    <div className="nowplaying-lyrics" style={{
      width: 'min(520px, 86vw)', maxHeight: '46vh', overflowY: 'auto', textAlign: 'center',
      lineHeight: 1.7, padding: '8px 4px',
      maskImage: 'linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent)',
    }}>
      {lyricsState === 'loading' ? (
        <p style={{ color: 'rgba(255,255,255,0.6)' }}><Loader2 size={16} className="spin-icon" /> Buscando letra…</p>
      ) : synced && synced.length ? (
        synced.map((l, i) => (
          <p key={i} ref={i === activeIdx ? activeLineRef : null} style={{
            margin: '3px 0',
            fontSize: i === activeIdx ? '1.06rem' : '0.95rem',
            color: i === activeIdx ? 'var(--accent)' : 'rgba(255,255,255,0.5)',
            fontWeight: i === activeIdx ? 700 : 400,
            transition: 'color .2s, font-size .2s',
          }}>{l.text || '♪'}</p>
        ))
      ) : lyrics?.plain ? (
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.95rem', color: 'rgba(255,255,255,0.75)', margin: 0 }}>{lyrics.plain}</pre>
      ) : (
        <p style={{ color: 'rgba(255,255,255,0.5)' }}>No se encontró la letra de esta canción.</p>
      )}
      {lyrics?.source && (synced?.length || lyrics?.plain) && (
        <div style={{ marginTop: 14, fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)' }}>letra vía {lyrics.source}</div>
      )}
    </div>
  );

  return (
    <div className="nowplaying-overlay"
      onTouchStart={(e) => { touchY.current = e.touches[0].clientY; }}
      onTouchEnd={(e) => { if (touchY.current != null && e.changedTouches[0].clientY - touchY.current > 80) onClose(); touchY.current = null; }}>
      <div className="nowplaying-bg" style={{ backgroundImage: `url('${track.thumbnail || fallbackArt}')` }} />
      <div className="nowplaying-content">
        <div className="nowplaying-top">
          <button className="np-icon-btn" onClick={onClose} title="Cerrar">
            <ChevronDown size={26} />
          </button>
          {isBuffering ? (
            <span className="np-engine-chip"><Loader2 size={12} className="spin-icon" /> Cargando</span>
          ) : engineLabel ? (
            <span className="np-engine-chip">{engineLabel}</span>
          ) : <span />}
          <div style={{ display: 'flex', gap: 4 }}>
            {hasSynced && (
              <button className="np-icon-btn" onClick={() => setKaraoke(true)} title="Modo karaoke (pantalla completa)">
                <Maximize2 size={20} />
              </button>
            )}
            <button className="np-icon-btn" onClick={() => setShowLyrics((s) => !s)} title="Letra"
              style={{ color: showLyrics ? 'var(--accent)' : undefined }}>
              <Mic2 size={22} />
            </button>
          </div>
        </div>

        {showLyrics
          ? lyricsPanel
          : <img key={track.thumbnail} className="nowplaying-art art-fade" src={track.thumbnail || fallbackArt} alt="" />}

        <div className="nowplaying-meta">
          <h1>{track.title}</h1>
          <p>{track.artist}</p>
        </div>

        <Visualizer active={isPlaying && !isBuffering} bars={48} style={{ width: '100%', height: 40, opacity: 0.9 }} />

        <div className="nowplaying-progress">
          <span>{fmt(currentTime)}</span>
          <div className="progress-bar-container" onPointerDown={onSeekPointerDown} onPointerMove={onSeekPointerMove}
            style={{ touchAction: 'none', flex: 1 }}>
            <div className="progress-bar-bg" />
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            <div className="progress-knob" style={{ left: `${progress}%` }} />
          </div>
          <span>{fmt(duration)}</span>
        </div>

        <div className="nowplaying-controls">
          <button className="np-icon-btn" onClick={onToggleFav} title="Favorito">
            <Heart size={22} fill={isFavorite ? 'var(--accent)' : 'none'} />
          </button>
          <button className="control-btn secondary" onClick={onPrev}><SkipBack size={28} /></button>
          <button className={`control-btn play-btn ${isPlaying ? 'playing' : ''}`} onClick={onTogglePlay}>
            {isBuffering
              ? <Loader2 size={30} className="spin-icon" />
              : isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" style={{ marginLeft: 4 }} />}
          </button>
          <button className="control-btn secondary" onClick={onNext}><SkipForward size={28} /></button>
          <div style={{ width: 44 }} />
        </div>

        {/* Volumen */}
        <div className="np-volume">
          <button className="volume-btn" onClick={onToggleMute}><VolumeIcon size={18} /></button>
          <div className="volume-slider-container" onPointerDown={onVolPointerDown} onPointerMove={onVolPointerMove}
            style={{ touchAction: 'none', flex: 1 }}>
            <div className="volume-slider-bg" />
            <div className="volume-slider-fill" style={{ width: `${isMuted ? 0 : volume}%` }} />
            <div className="volume-knob" style={{ left: `${isMuted ? 0 : volume}%` }} />
          </div>
        </div>

        {/* Vistazo a la siguiente */}
        {nextUp && (
          <div className="np-next">
            <span className="np-next-label">Siguiente</span>
            {nextUp.thumbnail && <img src={nextUp.thumbnail} alt="" />}
            <div className="np-next-meta">
              <strong>{nextUp.title}</strong>
              <span>{nextUp.artist}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
