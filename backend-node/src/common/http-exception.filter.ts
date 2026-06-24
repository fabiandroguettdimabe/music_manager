import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Normalises every error response to `{ detail: string }` with the appropriate
 * status code — matching the FastAPI backend's shape that the frontend reads.
 */
@Catch()
export class DetailExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return; // streaming response already started

    let status = 500;
    let detail = 'Error interno del servidor';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, any>;
        detail = b.detail ?? (Array.isArray(b.message) ? b.message.join(', ') : b.message) ?? detail;
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
      console.error('[unhandled]', exception);
    }

    res.status(status).json({ detail });
  }
}
