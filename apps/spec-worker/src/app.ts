import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ServiceError } from './errors.js';
import { fetchAndNormalizeSpec, type FetchOptions } from './fetch-spec.js';
import { requestLogger } from './logger.js';

const requestSchema = z.object({ apiId: z.string().min(1), specUrl: z.string().min(1) });

export function createApp(options?: Partial<FetchOptions>) {
  const app = express();
  app.use(express.json({ limit: '32kb' }), requestLogger);
  app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'spec-worker' }));
  app.post('/fetch-spec', async (request, response, next) => {
    try {
      const input = requestSchema.parse(request.body);
      const result = await fetchAndNormalizeSpec(input.apiId, input.specUrl, {
        timeoutMs: options?.timeoutMs ?? Number(process.env.SPEC_FETCH_TIMEOUT_MS ?? 8000),
        maxBytes: options?.maxBytes ?? Number(process.env.SPEC_MAX_BYTES ?? 5 * 1024 * 1024),
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message } });
      return;
    }
    const serviceError =
      error instanceof ServiceError
        ? error
        : new ServiceError(500, 'INTERNAL_ERROR', 'Unexpected worker error');
    response.status(serviceError.status).json({
      error: {
        code: serviceError.code,
        message: serviceError.message,
        requestId: response.locals.requestId as string,
      },
    });
  });
  return app;
}
