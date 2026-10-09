import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: process.env.API_JSON_BODY_LIMIT ?? '10mb' }));
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.info(`api listening on http://localhost:${port}`);
}
void bootstrap();
