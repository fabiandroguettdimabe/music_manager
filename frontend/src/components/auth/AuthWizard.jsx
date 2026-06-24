import { useState, useEffect } from 'react';
import {
  X, CheckCircle2, AlertCircle, Loader2, ArrowRight, ArrowLeft,
  ExternalLink, Music, ShieldCheck, RefreshCw
} from 'lucide-react';

const BROWSERS = [
  { id: 'chrome',   label: 'Chrome',   icon: '🌐' },
  { id: 'edge',     label: 'Edge',     icon: '🔷' },
  { id: 'firefox',  label: 'Firefox',  icon: '🦊' },
  { id: 'brave',    label: 'Brave',    icon: '🦁' },
];

export default function AuthWizard({ show, onClose, authStatus, onLogout, onSuccess }) {
  // 'auto' = browser-capture flow  |  'manual' = headers/oauth flow
  // Auto-capture needs yt-dlp/Python and isn't available on the Node backend,
  // so the manual flow (paste headers or OAuth) is the default.
  const [mode, setMode] = useState('manual');

  // --- AUTO mode ---
  const [selectedBrowser, setSelectedBrowser] = useState('firefox');
  const [capturing, setCapturing] = useState(false);
  const [captureResult, setCaptureResult] = useState(null); // {ok, message}

  // --- MANUAL mode ---
  const [authStep, setAuthStep] = useState(0);
  const [authMethod, setAuthMethod] = useState('');
  const [authBrowser, setAuthBrowser] = useState('firefox');
  const [authInput, setAuthInput] = useState('');

  // OAuth manual
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [brandAccountId, setBrandAccountId] = useState('');
  const [oauthCodeData, setOauthCodeData] = useState(null);
  const [oauthPolling, setOauthPolling] = useState(false);

  const [authSaving, setAuthSaving] = useState(false);
  const [authResult, setAuthResult] = useState(null);

  // Auto-poll OAuth device code every 5 s
  useEffect(() => {
    if (!oauthCodeData || authStep !== 2 || authMethod !== 'oauth') return;
    const iv = setInterval(handleOauthVerify, 5000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthCodeData, authStep, authMethod]);

  if (!show) return null;

  // ── Auto-capture ──────────────────────────────────────────────────────────
  const handleBrowserCapture = async () => {
    setCapturing(true);
    setCaptureResult(null);
    try {
      const res = await fetch('/api/auth/browser-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browser: selectedBrowser }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error desconocido');
      setCaptureResult({ ok: true, message: data.message });
      onSuccess();
    } catch (e) {
      setCaptureResult({ ok: false, message: e.message });
    } finally {
      setCapturing(false);
    }
  };

  // ── Manual helpers ─────────────────────────────────────────────────────────
  const authInputPreview = () => {
    const txt = authInput.trim();
    if (!txt) return null;
    const hasCookie = /cookie:/i.test(txt);
    const hasUA = /user-agent:/i.test(txt);
    const isJson = txt.startsWith('{');
    const lines = txt.split('\n').length;
    if (isJson) return { valid: true, label: 'JSON detectado' };
    if (hasCookie && hasUA) return { valid: true, label: `${lines} cabeceras · Cookie ✓ · User-Agent ✓` };
    if (hasCookie) return { valid: true, label: `${lines} cabeceras · Cookie ✓` };
    if (lines > 3) return { valid: false, label: `${lines} líneas (verifica que incluya Cookie)` };
    return { valid: false, label: 'Formato no reconocido' };
  };

  const handleSaveAuth = async () => {
    if (!authInput.trim()) return;
    setAuthSaving(true); setAuthResult(null);
    try {
      const res = await fetch('/api/save-auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: authInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error desconocido');
      setAuthResult({ ok: true });
      setAuthStep(3);
      setAuthInput('');
      onSuccess();
    } catch (e) {
      setAuthResult({ ok: false, message: e.message });
    } finally {
      setAuthSaving(false);
    }
  };

  const handleOauthInit = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setAuthSaving(true); setAuthResult(null);
    try {
      const res = await fetch('/api/oauth/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId.trim(), client_secret: clientSecret.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error desconocido');
      setOauthCodeData(data);
      setAuthStep(2);
    } catch (e) {
      setAuthResult({ ok: false, message: e.message });
    } finally {
      setAuthSaving(false);
    }
  };

  const handleOauthVerify = async () => {
    if (!oauthCodeData || oauthPolling) return;
    setOauthPolling(true); setAuthResult(null);
    try {
      const res = await fetch('/api/oauth/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId.trim(), client_secret: clientSecret.trim(),
          device_code: oauthCodeData.device_code, brand_account: brandAccountId.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.detail === 'authorization_pending') { setOauthPolling(false); return; }
        throw new Error(data.detail || 'Error desconocido');
      }
      setAuthStep(3);
      onSuccess();
    } catch (e) {
      setAuthResult({ ok: false, message: e.message });
    } finally {
      setOauthPolling(false);
    }
  };

  const handleClose = () => {
    setMode('manual'); setCapturing(false); setCaptureResult(null);
    setAuthStep(0); setAuthMethod(''); setAuthInput(''); setAuthResult(null);
    setOauthCodeData(null); setOauthPolling(false);
    onClose();
  };

  // ─────────────────────────────── RENDER ───────────────────────────────────

  const isSuccess = (mode === 'auto' && captureResult?.ok) || (mode === 'manual' && authStep === 3);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <h2>{isSuccess ? '¡Listo!' : 'Conectar YouTube Music'}</h2>
          <button className="close-btn" onClick={handleClose}><X size={18} /></button>
        </div>

        <div className="modal-body">

          {/* ═══════════════ SUCCESS ═══════════════ */}
          {isSuccess && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px',
                background: 'linear-gradient(135deg,hsl(142,70%,45%),hsl(160,70%,40%))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(34,197,94,0.3)',
                animation: 'modalSlideUp 0.5s cubic-bezier(0.16,1,0.3,1)',
              }}>
                <CheckCircle2 size={36} color="white" />
              </div>
              <h3 style={{ fontFamily: 'Outfit,sans-serif', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>
                ¡Autenticación exitosa!
              </h3>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Tu biblioteca de YouTube Music está lista.<br />
                Ahora puedes acceder a tus playlists y canciones favoritas.
              </p>
              <div className="modal-actions" style={{ justifyContent: 'center', marginTop: 24 }}>
                <button className="action-btn" onClick={handleClose}>¡Empezar a escuchar! <Music size={14} /></button>
              </div>
            </div>
          )}

          {/* ═══════════════ AUTO MODE ═══════════════ */}
          {!isSuccess && mode === 'auto' && (
            <>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
                Selecciona el navegador donde ya estás logueado en YouTube Music.
                La sesión se captura automáticamente — sin copiar nada.
              </p>

              {/* Browser selector */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                {BROWSERS.map(b => (
                  <button key={b.id}
                    onClick={() => setSelectedBrowser(b.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '14px 18px', borderRadius: 14, textAlign: 'left',
                      background: selectedBrowser === b.id ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${selectedBrowser === b.id ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}`,
                      color: 'var(--text-primary)', cursor: 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ fontSize: '1.4rem' }}>{b.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{b.label}</span>
                    {selectedBrowser === b.id && (
                      <CheckCircle2 size={14} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />
                    )}
                  </button>
                ))}
              </div>

              {/* Capture button */}
              <button
                className="action-btn"
                style={{ width: '100%', justifyContent: 'center', fontSize: '1rem', padding: '14px' }}
                onClick={handleBrowserCapture}
                disabled={capturing}
              >
                {capturing
                  ? <><Loader2 size={18} className="spin-icon" /> Capturando sesión...</>
                  : <><RefreshCw size={16} /> Detectar desde {BROWSERS.find(b => b.id === selectedBrowser)?.label}</>
                }
              </button>

              {/* Result banner */}
              {captureResult && !captureResult.ok && (
                <div style={{
                  marginTop: 14, padding: '12px 16px', borderRadius: 10,
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                  fontSize: '0.85rem', color: 'hsl(0,84%,65%)',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong>No se pudo capturar:</strong> {captureResult.message}
                    <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Asegúrate de estar logueado en YouTube Music en ese navegador.
                    </div>
                  </div>
                </div>
              )}

              {/* Logout if session exists */}
              {authStatus?.oauth_exists && (
                <button className="action-btn danger-btn" style={{ marginTop: 16, width: '100%' }} onClick={onLogout}>
                  <AlertCircle size={16} /> Eliminar sesión actual
                </button>
              )}

              {/* Manual fallback link */}
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button
                  onClick={() => { setMode('manual'); setAuthStep(0); setCaptureResult(null); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline' }}
                >
                  Usar método manual (copiar cabeceras u OAuth)
                </button>
              </div>
            </>
          )}

          {/* ═══════════════ MANUAL MODE ═══════════════ */}
          {!isSuccess && mode === 'manual' && (
            <>
              {/* Step indicator */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    flex: 1, height: 3, borderRadius: 2,
                    background: i <= authStep ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                    transition: 'background 0.3s',
                  }} />
                ))}
              </div>

              {/* ── Manual Step 0: method choice ── */}
              {authStep === 0 && (
                <>
                  <p style={{ fontSize: '0.95rem', fontWeight: 500, marginBottom: 16 }}>¿Cómo deseas conectar?</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      { id: 'headers', icon: '🌐', title: 'Cabeceras de Navegador', desc: 'Copia las cabeceras desde DevTools de Firefox o Chrome.' },
                    ].map(m => (
                      <button key={m.id}
                        onClick={() => { setAuthMethod(m.id); setAuthStep(1); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 16, padding: '18px',
                          borderRadius: 14, textAlign: 'left',
                          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                          color: 'var(--text-primary)', cursor: 'pointer', transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor='var(--accent)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'; }}
                      >
                        <span style={{ fontSize: '1.8rem' }}>{m.icon}</span>
                        <div>
                          <h4 style={{ margin: '0 0 3px', fontSize: '1rem' }}>{m.title}</h4>
                          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{m.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div style={{ textAlign: 'center', marginTop: 16 }}>
                    <button
                      onClick={() => { setMode('auto'); setAuthStep(0); setAuthResult(null); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline' }}
                    >
                      ← Volver a captura automática
                    </button>
                  </div>
                </>
              )}

              {/* ── Manual Step 1: Headers browser select ── */}
              {authStep === 1 && authMethod === 'headers' && (
                <>
                  <p style={{ fontSize: '0.95rem', fontWeight: 500, marginBottom: 16 }}>Selecciona tu navegador</p>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {[{id:'firefox',label:'Firefox',icon:'🦊'},{id:'chrome',label:'Chrome / Edge',icon:'🌐'}].map(b => (
                      <button key={b.id} onClick={() => { setAuthBrowser(b.id); setAuthStep(2); }}
                        style={{
                          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                          gap: 10, padding: '22px 16px', borderRadius: 14, fontSize: '1.4rem',
                          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                          color: 'var(--text-primary)', cursor: 'pointer', transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor='var(--accent)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'; }}
                      >
                        {b.icon}<span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{b.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="modal-actions" style={{ marginTop: 20 }}>
                    <button className="action-btn text-btn" onClick={() => setAuthStep(0)}><ArrowLeft size={14} /> Atrás</button>
                  </div>
                </>
              )}

              {/* ── Manual Step 1: OAuth credentials ── */}
              {authStep === 1 && authMethod === 'oauth' && (
                <>
                  <p style={{ fontSize: '0.95rem', fontWeight: 500, marginBottom: 4 }}>Credenciales de Google Cloud Console</p>
                  <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
                    Crea un proyecto en <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>console.cloud.google.com</a>, activa YouTube Data API v3 y crea credenciales OAuth de tipo "Aplicación de escritorio".
                  </p>
                  {[
                    { label: 'Client ID', type: 'text', val: clientId, set: setClientId, ph: 'ej. 12345-abcde.apps.googleusercontent.com' },
                    { label: 'Client Secret', type: 'password', val: clientSecret, set: setClientSecret, ph: 'ej. GOCSPX-12345…' },
                    { label: 'ID de Brand Account (Opcional)', type: 'text', val: brandAccountId, set: setBrandAccountId, ph: '21 dígitos (solo si usas canal secundario)' },
                  ].map(f => (
                    <div key={f.label} className="form-group" style={{ marginBottom: 14 }}>
                      <label>{f.label}</label>
                      <input type={f.type} placeholder={f.ph} value={f.val} onChange={e => f.set(e.target.value)}
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white' }} />
                    </div>
                  ))}
                  {authResult?.ok === false && (
                    <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.83rem', color: 'hsl(0,84%,65%)' }}>{authResult.message}</div>
                  )}
                  <div className="modal-actions" style={{ marginTop: 20 }}>
                    <button className="action-btn text-btn" onClick={() => setAuthStep(0)}><ArrowLeft size={14} /> Atrás</button>
                    <div className="flex-spacer" />
                    <button className="action-btn" onClick={handleOauthInit} disabled={authSaving || !clientId || !clientSecret}>
                      {authSaving ? <Loader2 size={16} className="spin-icon" /> : 'Generar Código'} <ArrowRight size={14} />
                    </button>
                  </div>
                </>
              )}

              {/* ── Manual Step 2: paste headers ── */}
              {authStep === 2 && authMethod === 'headers' && (
                <>
                  <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                    <h4 style={{ marginBottom: 10 }}>{authBrowser === 'firefox' ? '🦊' : '🌐'} Instrucciones para {authBrowser === 'firefox' ? 'Firefox' : 'Chrome / Edge'}</h4>
                    <ol style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.84rem' }}>
                      <li>Abre <a href="https://music.youtube.com" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>music.youtube.com</a></li>
                      <li>Presiona F12 → pestaña "Red" / "Network"</li>
                      <li>Filtra por <code>browse</code> y navega en la web</li>
                      <li>Clic derecho en la solicitud → Copiar cabeceras de solicitud</li>
                    </ol>
                  </div>
                  <textarea value={authInput} onChange={e => { setAuthInput(e.target.value); setAuthResult(null); }}
                    placeholder="Pega las cabeceras aquí..."
                    style={{ height: 110, width: '100%', fontSize: '0.78rem', background: 'rgba(0,0,0,0.2)', color: 'white', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }} autoFocus />
                  {authInput.trim() && (() => {
                    const p = authInputPreview();
                    if (!p) return null;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, marginTop: 6, background: p.valid ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: p.valid ? 'hsl(142,70%,55%)' : 'hsl(0,84%,65%)', fontSize: '0.8rem' }}>
                        {p.valid ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />} {p.label}
                      </div>
                    );
                  })()}
                  {authResult?.ok === false && (
                    <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.83rem', color: 'hsl(0,84%,65%)' }}>{authResult.message}</div>
                  )}
                  <div className="modal-actions" style={{ marginTop: 20 }}>
                    <button className="action-btn text-btn" onClick={() => { setAuthStep(1); setAuthResult(null); }}><ArrowLeft size={14} /> Atrás</button>
                    <div className="flex-spacer" />
                    <button className="action-btn" onClick={handleSaveAuth} disabled={authSaving || !authInput.trim()}>
                      {authSaving ? <Loader2 size={16} className="spin-icon" /> : 'Guardar y verificar'}
                    </button>
                  </div>
                </>
              )}

              {/* ── Manual Step 2: OAuth device code ── */}
              {authStep === 2 && authMethod === 'oauth' && oauthCodeData && (
                <>
                  <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                    <p style={{ marginBottom: 16, fontSize: '0.95rem' }}>Autoriza la aplicación siguiendo estos pasos:</p>
                    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '20px', borderRadius: 14, marginBottom: 20 }}>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Código de dispositivo</p>
                      <div style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: 4, fontFamily: 'monospace', color: 'var(--accent)' }}>
                        {oauthCodeData.user_code}
                      </div>
                    </div>
                    <a href={oauthCodeData.verification_url} target="_blank" rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: 'white', color: 'black', borderRadius: 30, textDecoration: 'none', fontWeight: 600 }}
                      onClick={() => navigator.clipboard.writeText(oauthCodeData.user_code).catch(()=>null)}
                    >
                      <ExternalLink size={16} /> Abrir página de Google
                    </a>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 10 }}>(El código se copia al portapapeles automáticamente)</p>
                    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      <Loader2 size={14} className="spin-icon" /> Esperando autorización automáticamente…
                    </div>
                  </div>
                  {authResult?.ok === false && (
                    <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.83rem', color: 'hsl(0,84%,65%)', display: 'flex', gap: 8 }}>
                      <AlertCircle size={15} style={{ flexShrink: 0 }} /> {authResult.message}
                    </div>
                  )}
                  <div className="modal-actions" style={{ marginTop: 20 }}>
                    <button className="action-btn text-btn" onClick={() => { setAuthStep(1); setOauthCodeData(null); setAuthResult(null); }}><ArrowLeft size={14} /> Atrás</button>
                    <div className="flex-spacer" />
                    <button className="action-btn" onClick={handleOauthVerify} disabled={oauthPolling}
                      style={{ opacity: oauthPolling ? 0.5 : 1, background: 'var(--accent)', color: 'black' }}>
                      {oauthPolling ? <Loader2 size={16} className="spin-icon" /> : <ShieldCheck size={16} />} Ya autoricé
                    </button>
                  </div>
                </>
              )}

            </>
          )}

        </div>
      </div>
    </div>
  );
}
