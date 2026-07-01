import { Controller, Get, Headers, HttpException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { YtmusicService } from '../ytmusic/ytmusic.service';

@Controller()
export class StreamController {
  constructor(private readonly yt: YtmusicService) {}

  /**
   * Calienta la caché de URL de audio para una pista (best-effort). El frontend
   * lo llama para la *siguiente* canción de la bolsa, de modo que si esta termina
   * cayendo al audio directo, la URL ya esté resuelta y el cambio sea instantáneo.
   */
  @Get('prefetch-audio/:videoId')
  async prefetchAudio(@Param('videoId') videoId: string, @Res() res: Response) {
    try {
      await this.yt.resolveAudioUrl(videoId);
    } catch {
      /* prefetch best-effort: nunca devolvemos error al cliente */
    }
    res.status(204).end();
  }

  /** Formatos de audio reales de un video (para el comparador de calidad). */
  @Get('stream-quality/:videoId')
  async streamQuality(@Param('videoId') videoId: string) {
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
    @Res() res: Response,
  ) {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Encoding': 'identity',
    };
    if (range) headers['Range'] = range;

    // Abort the upstream request when the client disconnects (seek / skip / close)
    // so we don't leak sockets and reader streams.
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    // Resuelve la URL (con caché) y la descarga. Si googlevideo responde 403/410 la
    // URL caducó o cambió la sesión anónima → invalidamos la caché, re-resolvemos y
    // reintentamos UNA vez antes de fallar. Esto evita la mayoría de los "saltos".
    const fetchUpstream = async (forceRefresh: boolean): Promise<globalThis.Response> => {
      const streamUrl = await this.yt.resolveAudioUrl(videoId, forceRefresh);
      return fetch(streamUrl, { headers, signal: abort.signal });
    };

    let upstream: globalThis.Response;
    try {
      upstream = await fetchUpstream(false);
      if ((upstream.status === 403 || upstream.status === 410) && !abort.signal.aborted) {
        this.yt.invalidateAudioUrl(videoId);
        upstream = await fetchUpstream(true);
      }
    } catch (e: any) {
      if (abort.signal.aborted) return; // client went away — nothing to send
      throw new HttpException(
        { detail: `Error al transmitir audio desde el backend: ${e?.message || e}` },
        500,
      );
    }

    res.status(upstream.status);
    // Mirror upstream's range support instead of hardcoding it, so we don't claim
    // range support when upstream answered a Range request with a full 200 body.
    const upstreamAcceptRanges = upstream.headers.get('accept-ranges');
    if (upstreamAcceptRanges) res.setHeader('Accept-Ranges', upstreamAcceptRanges);
    else if (upstream.status === 206) res.setHeader('Accept-Ranges', 'bytes');

    const passthrough = ['content-range', 'content-length', 'content-type'];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h === 'content-type' ? 'Content-Type' : h, v);
    }
    if (!upstream.headers.get('content-type')) {
      res.setHeader('Content-Type', 'audio/mp4');
    }

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
