import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface WrappedResponse<T> {
  data: T;
  timestamp: string;
}

/**
 * TransformResponseInterceptor — wraps every successful response in:
 * { data: T, timestamp: string }
 *
 * Null/undefined responses (e.g., 204 No Content) are passed through as-is.
 */
@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, WrappedResponse<T> | null>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<WrappedResponse<T> | null> {
    return next.handle().pipe(
      map((data) => {
        if (data === null || data === undefined) {
          return null;
        }
        return {
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
