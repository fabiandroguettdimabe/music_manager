import { useState } from 'react';
import { X, ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, Loader2, ExternalLink, Music2, Copy, Check } from 'lucide-react';

const G = 'hsl(141, 74%, 42%)';
const REDIRECT_URI = `${window.location.origin}/`;

function SpotifyLogo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={G}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <button onClick={copy} title="Copiar" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: copied ? 'rgba(30,215,96,0.15)' : 'rgba(255,255,255,0.06)',
      border: `1px solid ${copied ? 'rgba(30,215,96,0.3)' : 'rgba(255,255,255,0.12)'}`,
      color: copied ? G : 'var(--text-secondary)',
      borderRadius: 8, padding: '5px 10px', fontSize: '0.78rem', cursor: 'pointer',
      transition: 'all 0.2s', flexShrink: 0,
    }}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

function StepBadge({ n, done }) {
  return (
    <div style={{
      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
      background: done ? 'rgba(30,215,96,0.15)' : 'rgba(255,255,255,0.08)',
      border: `1.5px solid ${done ? G : 'rgba(255,255,255,0.15)'}`,
      color: done ? G : 'var(--text-muted)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.78rem', fontWeight: 700,
    }}>
      {done ? <Check size={13} /> : n}
    </div>
  );
}

export default function SpotifyAuthWizard({ show, onClose, spotifyAuth, onLogout, onSuccess }) {
  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!show) return null;

  const clientIdValid = /^[0-9a-zA-Z]{32}$/.test(clientId.trim());
  const clientIdDirty = clientId.trim().length > 0;

  const handleConnect = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/spotify/auth-url?client_id=${encodeURIComponent(clientId.trim())}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
      );
      if (!res.ok) throw new Error('No se pudo generar la URL de autorización');
      const { url } = await res.json();
      sessionStorage.setItem('spotify_pending', JSON.stringify({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        redirect_uri: REDIRECT_URI,
      }));
      window.location.href = url;
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep(0); setClientId(''); setClientSecret(''); setError('');
    onClose();
  };

  const isConnected = spotifyAuth?.authenticated;

  // ── Shared progress bar ──────────────────────────────────────────────────
  const ProgressBar = ({ steps = 2, current }) => (
    <div style={{ display: 'flex', gap: 6, padding: '0 24px', marginTop: 4 }}>
      {Array.from({ length: steps }, (_, i) => (
        <div key={i} style={{
          flex: 1, height: 3, borderRadius: 2,
          background: i < current ? G : 'rgba(255,255,255,0.08)',
          transition: 'background 0.3s',
        }} />
      ))}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 560 }}>

        {/* Header */}
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SpotifyLogo size={22} />
            {step === 2 ? '¡Conectado!' : isConnected ? 'Cuenta de Spotify' : `Conectar Spotify — Paso ${step + 1} de 2`}
          </h2>
          <button className="close-btn" onClick={handleClose}><X size={18} /></button>
        </div>

        {!isConnected && step < 2 && <ProgressBar steps={2} current={step} />}

        <div className="modal-body">

          {/* ══════════ ALREADY CONNECTED ══════════ */}
          {isConnected && (
            <>
              <div style={{ textAlign: 'center', padding: '16px 0 4px' }}>
                {spotifyAuth.image && (
                  <img src={spotifyAuth.image} alt="" style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px', display: 'block', border: `2px solid ${G}` }} />
                )}
                <h3 style={{ fontFamily: 'Outfit,sans-serif', fontSize: '1.3rem', fontWeight: 700, marginBottom: 8 }}>
                  {spotifyAuth.user_name}
                </h3>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 14px', borderRadius: 50, background: 'rgba(30,215,96,0.1)', border: `1px solid ${G}`, fontSize: '0.8rem', color: G }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: G, display: 'inline-block' }} />
                  Conectado · {spotifyAuth.product === 'premium' ? 'Premium ✓' : 'Cuenta gratuita'}
                </div>
              </div>

              {spotifyAuth.product !== 'premium' && (
                <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.2)', fontSize: '0.83rem', color: 'hsl(48,96%,53%)', display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: '1rem' }}>⚠️</span>
                  El reproductor integrado requiere <strong>Spotify Premium</strong>. Puedes cargar playlists pero la reproducción directa no estará disponible.
                </div>
              )}
              {spotifyAuth.needs_reauth && (
                <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.2)', fontSize: '0.83rem', color: 'hsl(48,96%,53%)', display: 'flex', gap: 10 }}>
                  <span>⚠️</span>
                  Faltan permisos: {(spotifyAuth.missing_scopes || []).join(', ')}. Desconecta y vuelve a conectar.
                </div>
              )}

              <button className="action-btn danger-btn" style={{ marginTop: 20, width: '100%' }} onClick={onLogout}>
                <AlertCircle size={16} /> Desconectar Spotify
              </button>
            </>
          )}

          {/* ══════════ STEP 0: SETUP GUIDE ══════════ */}
          {!isConnected && step === 0 && (
            <>
              {/* Info banner */}
              <div style={{ display: 'flex', gap: 14, padding: '14px 16px', borderRadius: 14, background: 'rgba(30,215,96,0.06)', border: '1px solid rgba(30,215,96,0.15)', marginBottom: 20 }}>
                <SpotifyLogo size={36} />
                <div>
                  <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 3 }}>Spotify Web Playback</p>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                    Necesitas crear una <strong>app gratuita</strong> en Spotify Developer (1 vez, 2 min). <strong>Requiere cuenta Premium</strong> para reproducción.
                  </p>
                </div>
              </div>

              {/* Redirect URI — needs to go first */}
              <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', marginBottom: 20 }}>
                <p style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', marginBottom: 8 }}>
                  URI de Redirección — cópiala ahora
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, fontSize: '0.82rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{REDIRECT_URI}</code>
                  <CopyBtn text={REDIRECT_URI} />
                </div>
              </div>

              {/* Step-by-step guide */}
              <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>Cómo crear tu app de Spotify:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { n: 1, text: <>Abre el <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" style={{ color: G }}>Spotify Developer Dashboard</a> e inicia sesión.</> },
                  { n: 2, text: 'Haz clic en "Create App".' },
                  { n: 3, text: <>Llena el nombre (ej. "Real Shuffle Player") y pega la <strong>URI de Redirección</strong> que copiaste arriba en el campo "Redirect URIs".</> },
                  { n: 4, text: 'Acepta los términos y crea la app. Luego ve a "Settings" y copia el Client ID y Client Secret.' },
                ].map(s => (
                  <div key={s.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <StepBadge n={s.n} />
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0, paddingTop: 3 }}>{s.text}</p>
                  </div>
                ))}
              </div>

              <div className="modal-actions" style={{ marginTop: 24 }}>
                <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-secondary)', fontSize: '0.82rem', textDecoration: 'none' }}>
                  <ExternalLink size={13} /> Abrir Dashboard
                </a>
                <div className="flex-spacer" />
                <button className="action-btn" style={{ background: `linear-gradient(135deg,${G},hsl(141,74%,32%))`, boxShadow: '0 4px 16px rgba(30,215,96,0.3)' }} onClick={() => setStep(1)}>
                  Ya tengo mis credenciales <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}

          {/* ══════════ STEP 1: ENTER CREDENTIALS ══════════ */}
          {!isConnected && step === 1 && (
            <>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
                Encuentra el <strong>Client ID</strong> y <strong>Client Secret</strong> en <em>Settings</em> de tu app de Spotify.
              </p>

              {/* Client ID */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>Client ID</label>
                  {clientIdDirty && (
                    <span style={{ fontSize: '0.75rem', color: clientIdValid ? G : 'hsl(0,84%,65%)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {clientIdValid ? <Check size={12} /> : <AlertCircle size={12} />}
                      {clientIdValid ? '32 caracteres ✓' : `${clientId.trim().length}/32 caracteres`}
                    </span>
                  )}
                </div>
                <input type="text" placeholder="ej. 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d" value={clientId}
                  onChange={e => { setClientId(e.target.value); setError(''); }} autoFocus
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, outline: 'none', fontSize: '0.85rem', fontFamily: 'monospace',
                    border: `1px solid ${clientIdDirty ? (clientIdValid ? 'rgba(30,215,96,0.4)' : 'rgba(239,68,68,0.3)') : 'rgba(255,255,255,0.1)'}`,
                    background: 'rgba(0,0,0,0.2)', color: 'white' }} />
              </div>

              {/* Client Secret */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Client Secret</label>
                <input type="password" placeholder="ej. abc123def456abc123def456abc123de" value={clientSecret}
                  onChange={e => { setClientSecret(e.target.value); setError(''); }}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white', outline: 'none', fontSize: '0.85rem', fontFamily: 'monospace' }} />
              </div>

              {/* Redirect URI reminder */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.25)', marginBottom: 4 }}>
                <AlertCircle size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Recuerda que en tu app de Spotify debe estar registrada la URI:</span>
                <code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{REDIRECT_URI}</code>
                <CopyBtn text={REDIRECT_URI} />
              </div>

              {error && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.83rem', color: 'hsl(0,84%,65%)' }}>
                  <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: 20 }}>
                <button className="action-btn text-btn" onClick={() => { setStep(0); setError(''); }}>
                  <ArrowLeft size={14} /> Atrás
                </button>
                <div className="flex-spacer" />
                <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', fontSize: '0.82rem', textDecoration: 'none' }}>
                  <ExternalLink size={13} /> Dashboard
                </a>
                <button className="action-btn"
                  style={{ background: `linear-gradient(135deg,${G},hsl(141,74%,32%))`, boxShadow: '0 4px 16px rgba(30,215,96,0.3)', opacity: (!clientId || !clientSecret || loading) ? 0.5 : 1 }}
                  onClick={handleConnect} disabled={!clientId || !clientSecret || loading}>
                  {loading ? <Loader2 size={16} className="spin-icon" /> : <><Music2 size={14} /> Conectar con Spotify</>}
                </button>
              </div>
            </>
          )}

          {/* ══════════ STEP 2: SUCCESS ══════════ */}
          {step === 2 && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px', background: `linear-gradient(135deg,${G},hsl(141,74%,32%))`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(30,215,96,0.3)', animation: 'modalSlideUp 0.5s cubic-bezier(0.16,1,0.3,1)' }}>
                <CheckCircle2 size={36} color="white" />
              </div>
              <h3 style={{ fontFamily: 'Outfit,sans-serif', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>¡Spotify conectado!</h3>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>Ya puedes reproducir tu música de Spotify<br />directamente desde el reproductor.</p>
              <div className="modal-actions" style={{ justifyContent: 'center', marginTop: 24 }}>
                <button className="action-btn" style={{ background: `linear-gradient(135deg,${G},hsl(141,74%,32%))` }} onClick={handleClose}>
                  ¡Empezar! <Music2 size={14} />
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
