import { useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, ChevronDown, Heart, Loader2 } from 'lucide-react';

/**
 * Vista de reproducción a pantalla completa. Reutiliza los handlers del reproductor
 * principal (no duplica lógica): recibe estado + callbacks por props.
 */
export default function NowPlaying({
  show, track, isPlaying, currentTime, duration, progress, fmt,
  engineLabel, isBuffering, isFavorite, nextUp,
  volume, isMuted, VolumeIcon,
  onClose, onTogglePlay, onNext, onPrev, onToggleFav, onToggleMute,
  onSeekPointerDown, onSeekPointerMove, onVolPointerDown, onVolPointerMove,
}) {
  const touchY = useRef(null);
  if (!show || !track) return null;
  const fallbackArt = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=900&auto=format&fit=crop';

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
          <div style={{ width: 44 }} />
        </div>

        <img className="nowplaying-art" src={track.thumbnail || fallbackArt} alt="" />

        <div className="nowplaying-meta">
          <h1>{track.title}</h1>
          <p>{track.artist}</p>
        </div>

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
