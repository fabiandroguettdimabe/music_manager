import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { existsSync } from 'fs';
import * as express from 'express';
import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DetailExceptionFilter } from './common/http-exception.filter';

// Load backend-node/.env regardless of the process cwd (the launcher may start
// node from the project root). __dirname is dist/, so ../.env = backend-node/.env.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config(); // also pick up cwd/.env if present (no override)

/**
 * Falla rápido si faltan los secretos obligatorios, en vez de arrancar "sano" y
 * romper luego en runtime (JWT forjable / imposible descifrar credenciales).
 */
function assertSecrets(): void {
  const problems: string[] = [];
  if (!process.env.JWT_SECRET) {
    problems.push('JWT_SECRET — cadena larga aleatoria para firmar los JWT');
  }
  const encKey = Buffer.from(process.env.CREDENTIALS_ENC_KEY || '', 'base64');
  if (encKey.length !== 32) {
    problems.push('CREDENTIALS_ENC_KEY — 32 bytes en base64 para cifrar las credenciales');
  }
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(
      '\n[boot] Faltan secretos obligatorios en el entorno:\n  - ' +
        problems.join('\n  - ') +
        '\nDefínelos en backend-node/.env (o en el .env del despliegue) y vuelve a arrancar.\n',
    );
    process.exit(1);
  }
}

async function bootstrap() {
  assertSecrets();

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'], bodyParser: false });

  // Body parser con límite alto: la importación de CSV envía miles de filas.
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // React frontend talks to /api/* (Vite proxies to this server).
  app.setGlobalPrefix('api');

  // CORS: en prod define ALLOWED_ORIGINS (coma-separado) para NO reflejar cualquier origin.
  // En local (sin la variable) refleja el origin, como antes, para no romper el dev-server.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowedOrigins.length) {
    // eslint-disable-next-line no-console
    console.warn(
      '[cors] ALLOWED_ORIGINS no definido: se reflejará cualquier origin (ok en dev, ' +
        'NO recomendado en un despliegue público). Define ALLOWED_ORIGINS para restringirlo.',
    );
  }
  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
    methods: '*',
    allowedHeaders: '*',
  });

  // Detrás de Caddy/túnel: confía en el primer proxy para leer la IP real del cliente
  // (X-Forwarded-For) → el rate-limit del login cuenta por IP y no por la del proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useGlobalFilters(new DetailExceptionFilter());

  // Sirve el frontend compilado desde el mismo servidor (solo en producción/Docker,
  // con SERVE_FRONTEND=true). Un solo origen y un solo puerto que exponer por el túnel.
  // En local no se activa, así que el dev-server de Vite sigue mandando como siempre.
  if (process.env.SERVE_FRONTEND === 'true') {
    const clientDir = process.env.FRONTEND_DIR || path.resolve(__dirname, '..', 'public');
    if (existsSync(clientDir)) {
      const server = app.getHttpAdapter().getInstance();
      server.use(express.static(clientDir, { index: false, maxAge: '1h' }));
      // SPA fallback: todo GET que NO sea /api → index.html (las rutas /api pasan a Nest).
      server.get(/^\/(?!api\/).*/, (_req: express.Request, res: express.Response) => {
        res.sendFile(path.join(clientDir, 'index.html'));
      });
      // eslint-disable-next-line no-console
      console.log(`[static] sirviendo frontend desde ${clientDir}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[static] SERVE_FRONTEND=true pero no existe ${clientDir}`);
    }
  }

  const port = Number(process.env.PORT) || 8000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`\n=== Real Shuffle Player API (NestJS) en http://0.0.0.0:${port} ===\n`);
}

bootstrap();
