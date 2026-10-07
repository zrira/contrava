import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { OpenApiDocument } from '@contrava/shared';
import { diffSpecs } from './diff.js';
import { requestLogger } from './logger.js';

const documentSchema = z.object({ openapi: z.string().startsWith('3.'), paths: z.record(z.string(), z.unknown()).optional() }).passthrough();
const diffSchema = z.object({ previous: documentSchema, current: documentSchema });

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }), requestLogger);
  app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'scan-worker' }));
  app.post('/diff', (request, response, next) => {
    try {
      const input = diffSchema.parse(request.body);
      response.json({ changes: diffSpecs(input.previous as OpenApiDocument, input.current as OpenApiDocument) });
    } catch (error) { next(error); }
  });
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const validation = error instanceof z.ZodError;
    response.status(validation ? 400 : 500).json({ error: { code: validation ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: validation ? error.issues[0]?.message : 'Unexpected worker error', requestId: response.locals.requestId as string } });
  });
  return app;
}
