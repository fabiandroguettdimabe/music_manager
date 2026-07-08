import { HttpException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';

// Pista opaca: guardamos el objeto tal cual lo manda el cliente. Solo necesitamos
// poder identificarla para el anti-repetición y para no duplicar.
type Track = Record<string, any>;

type Mode = 'bag' | 'reorden';

interface Session {
  id: string;
  userId: string;
  mode: Mode;
  avoidWindow: number; // ventana anti-repetición (modo reorden)
  all: Track[]; // universo completo
  bag: Track[]; // pendientes por sonar (modo bolsa); el frente [0] es la siguiente
  history: Track[]; // ya sonadas (la última es la más reciente)
  current: Track | null;
  priority: Track[]; // "reproducir a continuación" (tiene prioridad sobre bolsa/reorden)
  peek: Track | null; // siguiente comprometida en modo reorden ("espiar la siguiente")
  reshuffles: number;
  createdAt: number;
  updatedAt: number;
}

export interface QueueSnapshot {
  sessionId: string;
  mode: Mode;
  avoidWindow: number;
  current: Track | null;
  upNext: Track | null; // qué sonará al pulsar "siguiente" (sin consumirla)
  remaining: number; // pistas que quedan por sonar antes de rebarajar
  historyCount: number;
  total: number;
  priorityCount: number;
  reshuffles: number;
}

/**
 * Cola de reproducción con "real shuffle" gestionada EN EL SERVIDOR, para que la
 * app Android (y la web) sean delgadas y compartan exactamente la misma lógica:
 *
 *  - Modo "bolsa" (bag): Fisher-Yates; no repite ninguna pista hasta agotar todas,
 *    y al vaciarse rebaraja el conjunto entero.
 *  - Modo "reorden" continuo: rebaraja en cada avance, evitando las últimas N
 *    reproducidas (ventana anti-repetición configurable).
 *  - "Espiar la siguiente": se compromete la próxima pista para que coincida con
 *    lo que se muestra; se puede volver a rifar ("otra sorpresa") sin cortar la
 *    reproducción actual.
 *  - Cola de prioridad ("reproducir a continuación").
 *
 * Las sesiones viven en memoria (un reproductor por dispositivo). Se limpian por
 * antigüedad para no crecer sin límite.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private sessions = new Map<string, Session>();
  private static readonly MAX_SESSIONS = 500;
  private static readonly TTL_MS = 12 * 60 * 60 * 1000; // 12 h
  private static readonly SWEEP_MS = 30 * 60 * 1000; // barrido cada 30 min
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  // Barrido periódico: un reproductor que nunca vuelve a llamar a /start ya no
  // deja sus sesiones colgadas ocupando memoria hasta el siguiente arranque de cola.
  onModuleInit(): void {
    this.sweepTimer = setInterval(() => this.sweep(), QueueService.SWEEP_MS);
    this.sweepTimer.unref?.(); // no impedir que el proceso termine
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  // ───────────────────────── API pública ─────────────────────────

  /**
   * Crea una sesión de cola. body: { tracks, mode?, avoidWindow?, startId? }.
   * Devuelve el snapshot con la primera pista ya seleccionada como `current`.
   */
  start(userId: string, body: any): QueueSnapshot {
    const tracks = this.cleanTracks(body?.tracks);
    if (!tracks.length) throw new HttpException({ detail: 'La cola necesita al menos una pista.' }, 422);

    this.sweep();

    const mode: Mode = body?.mode === 'reorden' ? 'reorden' : 'bag';
    const avoidWindow = this.clamp(Number(body?.avoidWindow ?? 8), 0, 50);

    const shuffled = this.fisherYates(tracks);
    // Si piden empezar por una pista concreta, la sacamos al frente.
    let current: Track | null = null;
    const startId = body?.startId != null ? String(body.startId) : null;
    if (startId) {
      const i = shuffled.findIndex((t) => this.id(t) === startId);
      if (i >= 0) current = shuffled.splice(i, 1)[0];
    }
    if (!current) current = shuffled.shift() ?? null;

    const now = this.now();
    const session: Session = {
      id: randomUUID(),
      userId,
      mode,
      avoidWindow,
      all: tracks,
      bag: shuffled,
      history: [],
      current,
      priority: [],
      peek: null,
      reshuffles: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (mode === 'reorden') this.computePeek(session);
    this.sessions.set(session.id, session);
    return this.snapshot(session);
  }

  /** Avanza a la siguiente pista y devuelve el nuevo estado. */
  next(userId: string, sessionId: string): QueueSnapshot {
    const s = this.require(userId, sessionId);
    const nextT = this.pickNext(s);
    if (s.current) s.history.push(s.current);
    s.current = nextT;
    s.peek = null;
    if (s.mode === 'reorden') this.computePeek(s);
    return this.touch(s);
  }

  /** Vuelve a la pista anterior (si la hay). */
  prev(userId: string, sessionId: string): QueueSnapshot {
    const s = this.require(userId, sessionId);
    if (s.history.length) {
      const prevT = s.history.pop()!;
      // La actual vuelve al frente de la bolsa para que pueda volver a sonar.
      if (s.current) s.bag.unshift(s.current);
      s.current = prevT;
      s.peek = null;
      if (s.mode === 'reorden') this.computePeek(s);
    }
    return this.touch(s);
  }

  /**
   * "Espiar la siguiente" / "otra sorpresa" (solo reorden). reroll=true recalcula
   * la próxima pista comprometida sin cortar la reproducción actual.
   */
  peek(userId: string, sessionId: string, reroll = false): QueueSnapshot {
    const s = this.require(userId, sessionId);
    if (s.mode === 'reorden' && (reroll || !s.peek)) this.computePeek(s);
    return this.touch(s);
  }

  /** Encola una pista como "reproducir a continuación". */
  addNext(userId: string, sessionId: string, track: Track): QueueSnapshot {
    const s = this.require(userId, sessionId);
    if (!track || !this.id(track)) throw new HttpException({ detail: 'Falta la pista.' }, 422);
    const id = this.id(track);
    if (s.current && this.id(s.current) === id) return this.touch(s);
    if (s.priority.some((t) => this.id(t) === id)) return this.touch(s);
    s.priority.push(track);
    return this.touch(s);
  }

  /** Añade pistas nuevas al universo y a la bolsa (radio infinita / descubrir). */
  append(userId: string, sessionId: string, tracks: Track[]): QueueSnapshot {
    const s = this.require(userId, sessionId);
    const known = new Set(s.all.map((t) => this.id(t)));
    const fresh = this.cleanTracks(tracks).filter((t) => !known.has(this.id(t)));
    if (fresh.length) {
      s.all.push(...fresh);
      // Intercalar en la bolsa manteniendo aleatoriedad.
      s.bag = this.fisherYates([...s.bag, ...fresh]);
    }
    return this.touch(s);
  }

  /** Cambia de modo (bag ⇄ reorden) conservando la pista actual. */
  setMode(userId: string, sessionId: string, mode: Mode, avoidWindow?: number): QueueSnapshot {
    const s = this.require(userId, sessionId);
    s.mode = mode === 'reorden' ? 'reorden' : 'bag';
    if (avoidWindow != null) s.avoidWindow = this.clamp(Number(avoidWindow), 0, 50);
    s.peek = null;
    if (s.mode === 'reorden') this.computePeek(s);
    else {
      // Al volver a bolsa, conserva el contrato de shuffle real: primero lo que no
      // sono en esta vuelta; si ya esta agotado, reabre todo salvo la actual.
      const unavailable = new Set(s.history.map((t) => this.id(t)));
      if (s.current) unavailable.add(this.id(s.current));
      const remaining = s.all.filter((t) => !unavailable.has(this.id(t)));
      const fallback = s.all.filter((t) => !s.current || this.id(t) !== this.id(s.current));
      s.bag = this.fisherYates(remaining.length ? remaining : fallback);
    }
    return this.touch(s);
  }

  get(userId: string, sessionId: string): QueueSnapshot {
    return this.snapshot(this.require(userId, sessionId));
  }

  end(userId: string, sessionId: string): { ok: true } {
    const s = this.sessions.get(sessionId);
    if (s && s.userId === userId) this.sessions.delete(sessionId);
    return { ok: true };
  }

  // ───────────────────────── lógica de selección ─────────────────────────

  private pickNext(s: Session): Track | null {
    if (s.priority.length) return s.priority.shift()!;

    if (s.mode === 'reorden') {
      if (s.peek) return s.peek;
      return this.pickReorden(s);
    }

    // modo bolsa
    if (!s.bag.length) {
      // Rebarajar todo el conjunto (evitando repetir de inmediato la actual si se puede).
      const pool = s.all.filter((t) => this.id(t) !== this.id(s.current));
      s.bag = this.fisherYates(pool.length ? pool : s.all);
      s.reshuffles++;
    }
    return s.bag.shift() ?? null;
  }

  /** Elige una pista al azar evitando las últimas N reproducidas + la actual. */
  private pickReorden(s: Session): Track | null {
    if (!s.all.length) return null;
    const avoid = this.avoidIds(s);
    const shuffled = this.fisherYates(s.all);
    const pick = shuffled.find((t) => !avoid.has(this.id(t)));
    if (pick) return pick;
    // Pool demasiado pequeño: al menos evita repetir la actual.
    const notCurrent = shuffled.find((t) => this.id(t) !== this.id(s.current));
    return notCurrent ?? shuffled[0] ?? null;
  }

  private computePeek(s: Session): void {
    // La siguiente comprometida respeta la cola de prioridad si la hay.
    s.peek = s.priority.length ? s.priority[0] : this.pickReorden(s);
  }

  private avoidIds(s: Session): Set<string> {
    const ids = new Set<string>();
    if (s.current) ids.add(this.id(s.current));
    const n = s.avoidWindow;
    for (let i = s.history.length - 1; i >= 0 && ids.size <= n; i--) {
      ids.add(this.id(s.history[i]));
    }
    return ids;
  }

  // ───────────────────────── utilidades ─────────────────────────

  private snapshot(s: Session): QueueSnapshot {
    let upNext: Track | null;
    if (s.priority.length) upNext = s.priority[0];
    else if (s.mode === 'reorden') upNext = s.peek ?? null;
    else upNext = s.bag[0] ?? null;
    return {
      sessionId: s.id,
      mode: s.mode,
      avoidWindow: s.avoidWindow,
      current: s.current,
      upNext,
      remaining: s.bag.length,
      historyCount: s.history.length,
      total: s.all.length,
      priorityCount: s.priority.length,
      reshuffles: s.reshuffles,
    };
  }

  private touch(s: Session): QueueSnapshot {
    s.updatedAt = this.now();
    return this.snapshot(s);
  }

  private require(userId: string, sessionId: string): Session {
    const s = this.sessions.get(sessionId);
    if (!s || s.userId !== userId) {
      throw new HttpException({ detail: 'Sesión de cola no encontrada (reinicia la cola).' }, 404);
    }
    return s;
  }

  /** Identidad estable de una pista para dedupe/anti-repetición. */
  private id(t: Track | null): string {
    if (!t) return '';
    return String(
      t.id ?? t.videoId ?? t.uid ?? t.uri ?? (t.source && t.providerId ? `${t.source}:${t.providerId}` : ''),
    );
  }

  private cleanTracks(input: unknown): Track[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const item of input) {
      if (!item || typeof item !== 'object') continue;
      const track = item as Track;
      const id = this.id(track);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(track);
    }
    return out;
  }

  /** Fisher-Yates puro (no muta el array de entrada). */
  private fisherYates<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private clamp(n: number, lo: number, hi: number): number {
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, Math.floor(n)));
  }

  private now(): number {
    return Date.now();
  }

  /** Elimina sesiones caducadas y, si hay demasiadas, las más antiguas. */
  private sweep(): void {
    const now = this.now();
    for (const [id, s] of this.sessions) {
      if (now - s.updatedAt > QueueService.TTL_MS) this.sessions.delete(id);
    }
    if (this.sessions.size > QueueService.MAX_SESSIONS) {
      const sorted = [...this.sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt);
      const excess = this.sessions.size - QueueService.MAX_SESSIONS;
      for (let i = 0; i < excess; i++) this.sessions.delete(sorted[i].id);
    }
  }
}
