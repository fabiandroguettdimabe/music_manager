import { useState } from 'react';
import { Loader2, LogIn, UserPlus, Music } from 'lucide-react';
import { apiLogin, apiRegister } from './apiClient';

export default function LoginScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user =
        mode === 'login'
          ? await apiLogin(email.trim(), password)
          : await apiRegister(email.trim(), password, name.trim());
      onAuthed(user);
    } catch (err) {
      setError(err.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  const isRegister = mode === 'register';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'radial-gradient(1200px 600px at 50% -10%, rgba(139,92,246,0.18), transparent), var(--bg, #0b0b0f)',
      }}
    >
      <div className="glass-panel" style={{ width: '100%', maxWidth: 400, padding: 32, borderRadius: 20 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              margin: '0 auto 14px',
              background: 'linear-gradient(135deg,hsl(265,80%,60%),hsl(290,75%,55%))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Music size={30} color="white" />
          </div>
          <h1 style={{ fontFamily: 'Outfit,sans-serif', fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
            Real Shuffle Player
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 6 }}>
            {isRegister ? 'Crea tu cuenta' : 'Inicia sesión para continuar'}
          </p>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isRegister && (
            <input
              type="text"
              placeholder="Nombre (opcional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={inputStyle}
          />
          <input
            type="password"
            placeholder={isRegister ? 'Contraseña (mín. 8 caracteres)' : 'Contraseña'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            style={inputStyle}
          />

          {error && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: 'hsl(0,84%,70%)',
                fontSize: '0.85rem',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="action-btn"
            disabled={loading}
            style={{ justifyContent: 'center', padding: '12px', fontSize: '1rem', marginTop: 4 }}
          >
            {loading ? (
              <Loader2 size={18} className="spin-icon" />
            ) : isRegister ? (
              <>
                <UserPlus size={16} /> Crear cuenta
              </>
            ) : (
              <>
                <LogIn size={16} /> Entrar
              </>
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button
            onClick={() => {
              setMode(isRegister ? 'login' : 'register');
              setError('');
            }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            {isRegister ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(0,0,0,0.25)',
  color: 'white',
  fontSize: '0.95rem',
};
