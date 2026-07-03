import { useEffect, useRef } from 'react';

/**
 * Visualizador animado por canvas, teñido con la variable CSS --accent (que cambia
 * con la carátula). Reacciona a play/pausa vía `active`.
 *
 * Si se le pasa `analyserRef` (AnalyserNode del grafo Web Audio del motor directo) y
 * `real` es true (ese motor está sonando), dibuja el ESPECTRO REAL del audio. En los
 * demás motores (IFrame de YouTube, SDK de Spotify) no hay audio crudo, así que cae a
 * una animación simulada — que también funciona mientras el analizador no existe.
 */
export default function Visualizer({ active = false, bars = 32, className, style, analyserRef, real = false }) {
  const ref = useRef(null);
  const raf = useRef(0);
  const phase = useRef(0);
  const levels = useRef(new Array(bars).fill(0.05));
  const freqData = useRef(null);

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

      // ¿Hay espectro real disponible? (motor directo sonando + analizador creado)
      const an = real && active && analyserRef && analyserRef.current;
      let data = null;
      if (an) {
        const bins = an.frequencyBinCount;
        if (!freqData.current || freqData.current.length !== bins) freqData.current = new Uint8Array(bins);
        data = freqData.current;
        an.getByteFrequencyData(data);
      }

      phase.current += active ? 0.09 : 0.015;
      const gap = 2 * dpr;
      const bw = (w - gap * (bars - 1)) / bars;
      ctx.fillStyle = accent;
      // Con datos reales usamos ~70% inferior del espectro (donde vive la música).
      const usable = data ? Math.floor(data.length * 0.7) : 0;
      for (let i = 0; i < bars; i++) {
        let target;
        if (data) {
          // Media de la banda i para suavizar (curva ligeramente logarítmica).
          const frac = i / bars;
          const lo = Math.floor(Math.pow(frac, 1.3) * usable);
          const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / bars, 1.3) * usable));
          let sum = 0;
          for (let k = lo; k < hi; k++) sum += data[k];
          target = Math.min(1, (sum / (hi - lo) / 255) * 1.25);
        } else {
          target = active
            ? 0.22 + 0.62 * Math.abs(Math.sin(phase.current + i * 0.55) * Math.cos(phase.current * 0.5 + i * 0.2))
            : 0.045;
        }
        // Con datos reales el ataque es más rápido para sentir el ritmo.
        levels.current[i] += (target - levels.current[i]) * (data ? 0.45 : 0.25);
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
  }, [active, bars, real, analyserRef]);

  return <canvas ref={ref} className={className} style={style} aria-hidden="true" />;
}
