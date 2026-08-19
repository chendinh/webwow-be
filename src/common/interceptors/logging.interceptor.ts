import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * LoggingInterceptor — logs method, URL, status code and duration (ms)
 * for every incoming HTTP request using NestJS Logger.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = res.statusCode;
          const duration = Date.now() - start;
          this.logger.log(`${method} ${url} ${statusCode} +${duration}ms`);
        },
        error: (err: { status?: number }) => {
          const statusCode = err?.status ?? 500;
          const duration = Date.now() - start;
          this.logger.warn(`${method} ${url} ${statusCode} +${duration}ms`);
        },
      }),
    );
  }
}
