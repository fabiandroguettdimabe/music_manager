import { Timer, X } from 'lucide-react';

export default function SleepTimerModal({ show, sleepTimer, onActivate, onClose }) {
  if (!show) return null;
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 360 }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Timer size={18} /> Sleep Timer</h2>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ gap: 12 }}>
          <p>Pausar la reproducción automáticamente después de:</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[5, 10, 15, 30, 45, 60].map((m) => (
              <button
                key={m}
                className="action-btn"
                style={{
                  background: sleepTimer?.remaining && Math.ceil(sleepTimer.remaining / 60) <= m ? 'var(--accent-gradient)' : 'rgba(255,255,255,0.06)',
                  color: 'var(--text-primary)', boxShadow: 'none', border: '1px solid var(--panel-border)',
                }}
                onClick={() => onActivate(m)}
              >
                {m} min
              </button>
            ))}
          </div>
          {sleepTimer && (
            <div style={{ textAlign: 'center', padding: '8px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Pausa en: {Math.floor(sleepTimer.remaining / 60)}:{String(sleepTimer.remaining % 60).padStart(2, '0')}
            </div>
          )}
          {sleepTimer && (
            <button className="action-btn danger-btn" onClick={() => onActivate(0)}>Cancelar timer</button>
          )}
        </div>
      </div>
    </div>
  );
}
