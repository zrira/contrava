import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export function requestLogger(request: Request, response: Response, next: NextFunction): void {
  const requestId = request.header('x-request-id')?.trim() || randomUUID();
  response.setHeader('x-request-id', requestId);
  response.locals.requestId = requestId;
  const started = performance.now();
  response.on('finish', () => {
    console.info(
      JSON.stringify({
        service: 'spec-worker',
        requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  });
  next();
}
