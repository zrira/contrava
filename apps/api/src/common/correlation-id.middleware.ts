import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export interface CorrelatedRequest extends Request { requestId: string }

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    const requestId = request.header('x-request-id')?.trim() || randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    const started = performance.now();
    response.on('finish', () => console.info(JSON.stringify({ service: 'api', requestId, method: request.method, path: request.originalUrl, status: response.statusCode, durationMs: Math.round(performance.now() - started) })));
    next();
  }
}
