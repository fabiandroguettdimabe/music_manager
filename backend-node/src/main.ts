import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DetailExceptionFilter } from './common/http-exception.filter';

// Load backend-node/.env regardless of the process cwd (the launcher may start
// node from the project root). __dirname is dist/, so ../.env = backend-node/.env.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config(); // also pick up cwd/.env if present (no override)

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  // React frontend talks to /api/* (Vite proxies to this server).
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true, methods: '*', allowedHeaders: '*' });
  app.useGlobalFilters(new DetailExceptionFilter());

  const port = Number(process.env.PORT) || 8000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`\n=== Real Shuffle Player API (NestJS) en http://0.0.0.0:${port} ===\n`);
}

bootstrap();
