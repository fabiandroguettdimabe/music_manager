import { Sliders, X, Power, Volume2, Zap, Waves, Repeat } from 'lucide-react';
import Modal from '../ui/Modal';

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

export default function EqualizerModal({
  show, onClose, enabled, onToggle, bands, onBandsChange, engine, playerMode,
  normalizeEnabled, onToggleNormalize,
  preferDirect, onTogglePreferDirect, djFilter, onDjFilterChange, djEcho, onToggleDjEcho,
}) {
  return (
    <Modal show={show} onClose={onClose} maxWidth={460} style={{ width: '92vw' }}>
      {() => {
        const setBand = (i, v) => {
          const next = bands.slice();
          next[i] = v;
          onBandsChange(next);
        };
        const active = enabled && engine === 'audio';
        const presetMatch = (vals) => vals.length === bands.length && vals.every((v, i) => v === bands[i]);
        // Los efectos DJ y el EQ solo se oyen con el motor directo (grafo Web Audio).
        const directLive = engine === 'audio';
        const filterLabel = djFilter === 0 ? 'Neutro' : djFilter < 0 ? `Graves ${Math.round(-djFilter)}%` : `Agudos ${Math.round(djFilter)}%`;

        return (
          <>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Sliders size={18} /> Audio &amp; DJ</h2>
              <button className="close-btn" onClick={onClose}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{ gap: 14 }}>
              {/* ── Motor de audio ─────────────────────────────────────────── */}
              <button className={`eq-norm-toggle ${preferDirect ? 'on' : ''}`} onClick={onTogglePreferDirect}>
                <Zap size={15} />
                <span className="eq-norm-label">
                  Motor directo · alta calidad
                  <small>AAC 128 kbps solo audio + EQ y efectos DJ. Al ver vídeo usa el reproductor de YouTube.</small>
                </span>
                <span className={`eq-switch ${preferDirect ? 'on' : ''}`}><i /></span>
              </button>

              <button className={`eq-master ${enabled ? 'on' : ''}`} onClick={onToggle}>
                <Power size={16} /> {enabled ? 'Ecualizador activado' : 'Activar ecualizador'}
              </button>

              <p className="eq-note">
                El ecualizador y los efectos DJ actúan sobre el <strong>audio directo</strong> de YouTube
                (AAC 128 kbps, solo audio). No afectan a Spotify
                {playerMode === 'spotify' ? ' (ahora suena Spotify; se aplicarán al pasar a una pista de YouTube).' : '.'}
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
                {engine === 'audio'
                  ? `● Motor directo activo${enabled ? ' · EQ' : ''}${normalizeEnabled ? ' · nivelado' : ''}${djEcho ? ' · eco' : ''}${djFilter !== 0 ? ' · filtro' : ''}`
                  : '○ Se aplicará al reproducir una pista de YouTube'}
              </div>

              {/* ── Efectos DJ ─────────────────────────────────────────────── */}
              <div className={`dj-fx ${directLive ? '' : 'dj-fx-idle'}`}>
                <div className="dj-fx-head"><Waves size={14} /> Efectos DJ</div>
                <div className="dj-filter-row">
                  <span className="dj-filter-name">Filtro</span>
                  <input
                    type="range" min="-100" max="100" step="1" value={djFilter}
                    className="dj-filter-slider"
                    onChange={(e) => onDjFilterChange(Number(e.target.value))}
                    onDoubleClick={() => onDjFilterChange(0)}
                    title="Arrastra: izquierda tapa agudos, derecha tapa graves. Doble clic = neutro."
                  />
                  <span className="dj-filter-val">{filterLabel}</span>
                </div>
                <button className={`dj-echo-btn ${djEcho ? 'on' : ''}`} onClick={onToggleDjEcho}>
                  <Repeat size={15} /> Eco {djEcho ? 'ON' : 'OFF'}
                </button>
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
          </>
        );
      }}
    </Modal>
  );
}
