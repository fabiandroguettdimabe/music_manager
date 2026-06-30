import { useEffect, useRef } from 'react';

/**
 * Visualizador animado por canvas, teñido con la variable CSS --accent (que cambia
 * con la carátula). Reacciona a play/pausa vía `active`.
 *
 * Nota: no usa Web Audio. Los motores principales (IFrame de YouTube y SDK de
 * Spotify) no exponen el audio crudo, y reenrutar el <audio> de respaldo por un
 * AudioContext arriesga el auto-avance. Esta animación funciona en los 3 motores.
 */
export default function Visualizer({ active = false, bars = 32, className, style }) {
  const ref = useRef(null);
  const raf = useRef(0);
  const phase = useRef(0);
  const levels = useRef(new Array(bars).fill(0.05));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (levels.current.length !== bars) levels.current = new Array(bars).fill(0.05);

    const draw = () => {
      raf.current = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = (canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr)));
      const h = (canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr)));
      ctx.clearRect(0, 0, w, h);
      const accent =
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1ed760';
      phase.current += active ? 0.09 : 0.015;
      const gap = 2 * dpr;
      const bw = (w - gap * (bars - 1)) / bars;
      ctx.fillStyle = accent;
      for (let i = 0; i < bars; i++) {
        const target = active
          ? 0.22 + 0.62 * Math.abs(Math.sin(phase.current + i * 0.55) * Math.cos(phase.current * 0.5 + i * 0.2))
          : 0.045;
        levels.current[i] += (target - levels.current[i]) * 0.25; // lerp suave
        const v = levels.current[i];
        const bh = Math.max(2 * dpr, v * h);
        const x = i * (bw + gap);
        const y = h - bh;
        const r = Math.min(bw / 2, 3 * dpr);
        ctx.globalAlpha = active ? 0.45 + 0.55 * v : 0.2;
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.lineTo(x + bw - r, y);
        ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
        ctx.lineTo(x + bw, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    draw();
    return () => cancelAnimationFrame(raf.current);
  }, [active, bars]);

  return <canvas ref={ref} className={className} style={style} aria-hidden="true" />;
}
