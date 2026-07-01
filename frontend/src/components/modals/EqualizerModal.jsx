import { Sliders, X, Power, Volume2 } from 'lucide-react';

// Etiquetas de las 5 bandas (deben ir en paralelo con EQ_FREQS de App.jsx).
const LABELS = ['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'];

const PRESETS = {
  Plano: [0, 0, 0, 0, 0],
  'Graves +': [7, 4, 1, -1, -1],
  Voces: [-2, 0, 3, 3, 1],
  'Agudos +': [-2, -1, 0, 4, 6],
  Rock: [4, 2, -1, 2, 4],
  Loudness: [6, 3, 0, 2, 5],
};

export default function EqualizerModal({ show, onClose, enabled, onToggle, bands, onBandsChange, engine, playerMode, normalizeEnabled, onToggleNormalize }) {
  if (!show) return null;

  const setBand = (i, v) => {
    const next = bands.slice();
    next[i] = v;
    onBandsChange(next);
  };
  const active = enabled && engine === 'audio';
  const presetMatch = (vals) => vals.length === bands.length && vals.every((v, i) => v === bands[i]);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 460, width: '92vw' }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Sliders size={18} /> Ecualizador</h2>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ gap: 14 }}>
          <button className={`eq-master ${enabled ? 'on' : ''}`} onClick={onToggle}>
            <Power size={16} /> {enabled ? 'Modo Hi-Fi + EQ activado' : 'Activar modo Hi-Fi + EQ'}
          </button>

          <p className="eq-note">
            El ecualizador actúa sobre el <strong>audio directo</strong> de YouTube. Al activarlo se
            fuerza ese motor (control total del sonido, ~128 kbps). No afecta a Spotify
            {playerMode === 'spotify' ? ' (ahora suena Spotify; el EQ se aplicará al pasar a una pista de YouTube).' : '.'}
          </p>

          <button className={`eq-norm-toggle ${normalizeEnabled ? 'on' : ''}`} onClick={onToggleNormalize}>
            <Volume2 size={15} />
            <span className="eq-norm-label">
              Nivelar volumen (ReplayGain)
              <small>Iguala el loudness entre canciones — ideal en shuffle</small>
            </span>
            <span className={`eq-switch ${normalizeEnabled ? 'on' : ''}`}><i /></span>
          </button>

          <div className={`eq-status ${active || (normalizeEnabled && engine === 'audio') ? 'live' : ''}`}>
            {engine === 'audio' && (enabled || normalizeEnabled)
              ? `● Activo en esta pista${enabled ? ' · EQ' : ''}${normalizeEnabled ? ' · nivelado' : ''}`
              : (enabled || normalizeEnabled)
              ? '○ Se aplicará al reproducir una pista de YouTube'
              : '○ Sin efectos activos'}
          </div>

          <div className="eq-presets">
            {Object.entries(PRESETS).map(([name, vals]) => (
              <button
                key={name}
                className={`eq-preset-btn ${presetMatch(vals) ? 'active' : ''}`}
                onClick={() => onBandsChange(vals.slice())}
                disabled={!enabled}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="eq-bands">
            {bands.map((v, i) => (
              <div className="eq-band-row" key={i}>
                <span className="eq-freq">{LABELS[i]}</span>
                <input
                  type="range" min="-12" max="12" step="1" value={v} disabled={!enabled}
                  className="eq-slider"
                  onChange={(e) => setBand(i, Number(e.target.value))}
                />
                <span className="eq-gain">{v > 0 ? '+' : ''}{v} dB</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
