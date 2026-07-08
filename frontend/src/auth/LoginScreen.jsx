import { useState } from 'react';
import { Loader2, LogIn, UserPlus, Mail, Lock, User, AlertCircle } from 'lucide-react';
import { apiLogin, apiRegister } from './apiClient';
import Logo from '../components/ui/Logo';

export default function LoginScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isRegister = mode === 'register';

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

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setError('');
  };

  return (
    <div className="login-screen">
      <div className="glass-panel login-card">
        <div className="login-brand">
          <div className="login-logo">
            <Logo size={60} />
          </div>
          <h1 className="login-title">Noir</h1>
          <div className="login-eyebrow">Real Shuffle Player</div>
          <p className="login-sub">
            {isRegister ? 'Crea tu cuenta para empezar' : 'Inicia sesión para continuar'}
          </p>
        </div>

        <div className="login-toggle" role="tablist" aria-label="Acceso">
          <button
            type="button"
            role="tab"
            aria-selected={!isRegister}
            className={!isRegister ? 'active' : ''}
            onClick={() => switchMode('login')}
          >
            <LogIn size={15} /> Entrar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isRegister}
            className={isRegister ? 'active' : ''}
            onClick={() => switchMode('register')}
          >
            <UserPlus size={15} /> Crear cuenta
          </button>
        </div>

        <form onSubmit={submit} className="login-form">
          {isRegister && (
            <div className="login-field">
              <User size={17} aria-hidden="true" />
              <input
                type="text"
                placeholder="Nombre (opcional)"
                aria-label="Nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          <div className="login-field">
            <Mail size={17} aria-hidden="true" />
            <input
              type="email"
              placeholder="Email"
              aria-label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="login-field">
            <Lock size={17} aria-hidden="true" />
            <input
              type="password"
              placeholder={isRegister ? 'Contraseña (mín. 8 caracteres)' : 'Contraseña'}
              aria-label="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </div>

          {error && (
            <div role="alert" className="login-error">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="action-btn login-submit" disabled={loading}>
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

        <p className="login-hint">
          {isRegister
            ? 'Al crear tu cuenta guardas tus listas y favoritos en la nube.'
            : 'Tu sesión se mantiene en este dispositivo.'}
        </p>
      </div>
    </div>
  );
}
