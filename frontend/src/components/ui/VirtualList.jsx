import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * Lista virtualizada sin dependencias. Solo renderiza las filas visibles (+overscan),
 * así una bolsa de 5000 pistas no crea 5000 nodos del DOM → scroll fluido.
 *
 * Es su propio contenedor de scroll. Cada fila se envuelve en un alto FIJO
 * (`itemHeight`) para que el cálculo de scroll no dependa del CSS de la tarjeta
 * (robusto ante modo compacto / cambios de estilo).
 */
export default function VirtualList({
  items,
  itemHeight = 60,
  overscan = 8,
  renderItem,
  getKey,
  className = '',
  emptyContent = null,
  resetKey,
}) {
  const ref = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setViewport(el.clientHeight || 600);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Al cambiar de lista (p.ej. nueva playlist), volver arriba.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  const onScroll = useCallback((e) => setScrollTop(e.currentTarget.scrollTop), []);

  if (!items.length) {
    return (
      <div ref={ref} className={className}>
        {emptyContent}
      </div>
    );
  }

  const total = items.length;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(viewport / itemHeight) + overscan * 2;
  const end = Math.min(total, start + visibleCount);
  const slice = items.slice(start, end);

  return (
    <div ref={ref} className={className} onScroll={onScroll}>
      <div style={{ height: start * itemHeight }} />
      {slice.map((item, i) => {
        const index = start + i;
        return (
          <div key={getKey ? getKey(item, index) : index} style={{ height: itemHeight, overflow: 'hidden' }}>
            {renderItem(item, index)}
          </div>
        );
      })}
      <div style={{ height: (total - end) * itemHeight }} />
    </div>
  );
}
