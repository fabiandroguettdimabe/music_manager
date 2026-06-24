import { Controller, Get, Headers, HttpException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { YtmusicService } from '../ytmusic/ytmusic.service';

@Controller()
export class StreamController {
  constructor(private readonly yt: YtmusicService) {}

  @Get('stream-audio/:videoId')
  async streamAudio(
    @Param('videoId') videoId: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    let streamUrl: string;
    try {
      streamUrl = await this.yt.resolveAudioUrl(videoId);
    } catch (e: any) {
      throw new HttpException(
        { detail: `Error al transmitir audio desde el backend: ${e?.message || e}` },
        500,
      );
    }

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

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(streamUrl, { headers, signal: abort.signal });
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
      res.setHeader('Content-Type', 'audio/webm');
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
