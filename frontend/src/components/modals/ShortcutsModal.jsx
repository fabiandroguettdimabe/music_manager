import { Keyboard, X } from 'lucide-react';

const SHORTCUTS = [
  ['Espacio', 'Play / Pausa'],
  ['→', 'Siguiente canción'],
  ['←', 'Canción anterior'],
  ['↑ / ↓', 'Subir / bajar volumen'],
  ['M', 'Silenciar'],
  ['R', 'Repetir la canción actual'],
  ['?', 'Mostrar / ocultar esta ayuda'],
];

export default function ShortcutsModal({ show, onClose }) {
  if (!show) return null;
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card glass-panel animate-in" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Keyboard size={18} /> Atajos de teclado</h2>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ gap: 4 }}>
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--panel-border)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>{desc}</span>
              <kbd style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--panel-border)',
                borderRadius: 6, padding: '3px 10px', fontSize: '0.8rem', fontFamily: 'monospace',
                color: 'var(--text-primary)', minWidth: 36, textAlign: 'center',
              }}>{key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
