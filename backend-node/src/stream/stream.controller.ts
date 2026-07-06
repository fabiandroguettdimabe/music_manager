import { Controller, Get, Headers, HttpException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { YtmusicService } from '../ytmusic/ytmusic.service';

// Modo híbrido: si STREAM_BACKEND_URL está definido (p.ej. http://100.x.x.x:8000 vía
// Tailscale), este backend NO resuelve el audio él mismo (útil cuando corre en un VPS
// cuya IP de datacenter YouTube bloquea), sino que reenvía las peticiones de streaming
// a otro backend con IP residencial (tu PC). El resto de la API se sirve normal.
const STREAM_BACKEND = (process.env.STREAM_BACKEND_URL || '').trim().replace(/\/+$/, '');

@Controller()
export class StreamController {
  constructor(private readonly yt: YtmusicService) {}

  /**
   * Calienta la caché de URL de audio para una pista (best-effort). El frontend
   * lo llama para la *siguiente* canción de la bolsa, de modo que si esta termina
   * cayendo al audio directo, la URL ya esté resuelta y el cambio sea instantáneo.
   */
  @Get('prefetch-audio/:videoId')
  async prefetchAudio(
    @Param('videoId') videoId: string,
    @Query('fmt') fmt: string | undefined,
    @Res() res: Response,
  ) {
    if (STREAM_BACKEND) {
      // Reenvía el prefetch al backend de streaming (best-effort, no bloqueamos).
      const q = fmt ? `?fmt=${encodeURIComponent(fmt)}` : '';
      fetch(`${STREAM_BACKEND}/api/prefetch-audio/${encodeURIComponent(videoId)}${q}`).catch(() => {});
      res.status(204).end();
      return;
    }
    try {
      if (fmt === 'hq') await this.yt.resolveHqAudioUrl(videoId);
      else await this.yt.resolveAudioUrl(videoId);
    } catch {
      /* prefetch best-effort: nunca devolvemos error al cliente */
    }
    res.status(204).end();
  }

  /** Formatos de audio reales de un video (para el comparador de calidad). */
  @Get('stream-quality/:videoId')
  async streamQuality(@Param('videoId') videoId: string) {
    if (STREAM_BACKEND) return this.proxyJson(`/api/stream-quality/${encodeURIComponent(videoId)}`);
    try {
      return await this.yt.getStreamQuality(videoId);
    } catch (e: any) {
      throw new HttpException(
        { detail: `No se pudo obtener la calidad del stream: ${e?.message || e}` },
        502,
      );
    }
  }

  /** Loudness (dB) de un video para nivelar el volumen entre pistas (ReplayGain). */
  @Get('loudness/:videoId')
  async loudness(@Param('videoId') videoId: string) {
    if (STREAM_BACKEND) {
      try {
        return await this.proxyJson(`/api/loudness/${encodeURIComponent(videoId)}`);
      } catch {
        return { videoId, loudnessDb: null };
      }
    }
    try {
      return await this.yt.getLoudness(videoId);
    } catch {
      return { videoId, loudnessDb: null };
    }
  }

  @Get('stream-audio/:videoId')
  async streamAudio(
    @Param('videoId') videoId: string,
    @Headers('range') range: string | undefined,
    @Query('fmt') fmt: string | undefined,
    @Res() res: Response,
  ) {
    // Aborta la petición upstream si el cliente se desconecta (seek / skip / cerrar).
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    // ── Modo híbrido: reenviar al backend de streaming (tu PC) ──
    if (STREAM_BACKEND) {
      const q = fmt ? `?fmt=${encodeURIComponent(fmt)}` : '';
      const target = `${STREAM_BACKEND}/api/stream-audio/${encodeURIComponent(videoId)}${q}`;
      const headers: Record<string, string> = { 'Accept-Encoding': 'identity' };
      if (range) headers['Range'] = range;
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(target, { headers, signal: abort.signal });
      } catch (e: any) {
        if (abort.signal.aborted) return;
        throw new HttpException(
          { detail: `El backend de streaming (tu PC) no respondió: ${e?.message || e}. ¿Está encendido y en la misma red Tailscale?` },
          502,
        );
      }
      this.pipeUpstream(upstream, res);
      return;
    }

    // ── Modo normal: resolvemos y proxeamos googlevideo aquí ──
    const hq = fmt === 'hq';
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Encoding': 'identity',
    };
    if (range) headers['Range'] = range;

    const fetchUpstream = async (forceRefresh: boolean): Promise<globalThis.Response> => {
      const streamUrl = hq
        ? await this.yt.resolveHqAudioUrl(videoId, forceRefresh)
        : await this.yt.resolveAudioUrl(videoId, forceRefresh);
      return fetch(streamUrl, { headers, signal: abort.signal });
    };

    let upstream: globalThis.Response;
    try {
      upstream = await fetchUpstream(false);
      if ((upstream.status === 403 || upstream.status === 410) && !abort.signal.aborted) {
        if (hq) this.yt.invalidateHqAudioUrl(videoId);
        else this.yt.invalidateAudioUrl(videoId);
        upstream = await fetchUpstream(true);
      }
    } catch (e: any) {
      if (abort.signal.aborted) return;
      throw new HttpException(
        { detail: `Error al transmitir audio desde el backend: ${e?.message || e}` },
        500,
      );
    }

    this.pipeUpstream(upstream, res);
  }

  // ───────────────────────── utilidades ─────────────────────────

  /** Reenvía una petición JSON (GET) al backend de streaming y devuelve su cuerpo. */
  private async proxyJson(path: string): Promise<any> {
    const r = await fetch(`${STREAM_BACKEND}${path}`);
    if (!r.ok) throw new HttpException({ detail: `Streaming backend ${r.status}` }, 502);
    return r.json();
  }

  /** Copia estado + cabeceras relevantes + cuerpo de una respuesta upstream a res. */
  private pipeUpstream(upstream: globalThis.Response, res: Response) {
    res.status(upstream.status);
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    else if (upstream.status === 206) res.setHeader('Accept-Ranges', 'bytes');

    for (const h of ['content-range', 'content-length', 'content-type']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h === 'content-type' ? 'Content-Type' : h, v);
    }
    if (!upstream.headers.get('content-type')) res.setHeader('Content-Type', 'audio/mp4');

    if (!upstream.body) {
      res.end();
      return;
    }
    const nodeStream = Readable.fromWeb(upstream.body as any);
    res.on('close', () => nodeStream.destroy());
    nodeStream.on('error', () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    nodeStream.pipe(res);
  }
}
