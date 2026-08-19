import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/** Vietnamese customer-friendly messages for common HTTP status codes */
const FRIENDLY_MESSAGES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Thông tin không hợp lệ. Vui lòng kiểm tra lại.',
  [HttpStatus.UNAUTHORIZED]: 'Bạn cần đăng nhập để thực hiện thao tác này.',
  [HttpStatus.FORBIDDEN]: 'Bạn không có quyền thực hiện thao tác này.',
  [HttpStatus.NOT_FOUND]: 'Không tìm thấy thông tin yêu cầu.',
  [HttpStatus.CONFLICT]: 'Dữ liệu đã tồn tại. Vui lòng kiểm tra lại.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
  [HttpStatus.INTERNAL_SERVER_ERROR]:
    'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại hoặc liên hệ hỗ trợ.',
};

const GENERIC_500_MESSAGE = FRIENDLY_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR];

/** Shape of a single field-level validation error */
export interface ValidationError {
  field: string;
  message: string;
}

/** Standard error response body — NEVER includes stack traces or internal details */
export interface ErrorResponse {
  statusCode: number;
  message: string;
  errors?: ValidationError[];
  timestamp: string;
}

/**
 * GlobalExceptionFilter catches every exception thrown anywhere in the application.
 *
 * Security guarantees:
 *  - Stack traces, SQL messages, internal paths and table names are NEVER sent to clients.
 *  - All sensitive details are written only to the internal Logger.
 *  - For 400 validation errors (class-validator), field-level `errors` are safe to expose.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, body } = this.buildResponse(exception, request);

    response.status(statusCode).json(body);
  }

  // ─── private helpers ─────────────────────────────────────────────────────────

  private buildResponse(
    exception: unknown,
    request: Request,
  ): { statusCode: number; body: ErrorResponse } {
    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, request);
    }

    return this.handleUnexpectedError(exception, request);
  }

  private handleHttpException(
    exception: HttpException,
    request: Request,
  ): { statusCode: number; body: ErrorResponse } {
    const statusCode = exception.getStatus();
    const friendlyMessage =
      FRIENDLY_MESSAGES[statusCode] ?? GENERIC_500_MESSAGE;

    // Log full details internally — never sent to client
    this.logException(exception, request, statusCode);

    const body: ErrorResponse = {
      statusCode,
      message: friendlyMessage,
      timestamp: new Date().toISOString(),
    };

    // For 400 Bad Request, class-validator produces an array of constraint messages.
    // These field-level details are safe to expose so the client can fix its input.
    if (statusCode === HttpStatus.BAD_REQUEST) {
      const validationErrors = this.extractValidationErrors(exception);
      if (validationErrors.length > 0) {
        body.errors = validationErrors;
      }
    }

    return { statusCode, body };
  }

  private handleUnexpectedError(
    exception: unknown,
    request: Request,
  ): { statusCode: number; body: ErrorResponse } {
    const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

    // Log the raw error internally with full context
    this.logger.error(
      `Unexpected error on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
      {
        method: request.method,
        url: request.url,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
    );

    return {
      statusCode,
      body: {
        statusCode,
        message: GENERIC_500_MESSAGE,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Extracts field-level validation errors produced by class-validator.
   *
   * class-validator errors arrive as:
   *   { message: ['field should not be empty', ...] }   ← array form
   *   { message: 'some string', errors: [...] }         ← object form (NestJS ValidationPipe)
   *
   * Only human-readable constraint messages are returned — no stack traces.
   */
  private extractValidationErrors(exception: HttpException): ValidationError[] {
    const raw = exception.getResponse();

    if (typeof raw !== 'object' || raw === null) {
      return [];
    }

    const payload = raw as Record<string, unknown>;

    // NestJS ValidationPipe returns { message: string[], statusCode, error }
    if (Array.isArray(payload['message'])) {
      return (payload['message'] as string[]).map((msg) => {
        // Each message from class-validator typically starts with the property name
        const spaceIndex = msg.indexOf(' ');
        if (spaceIndex !== -1) {
          return {
            field: msg.substring(0, spaceIndex),
            message: msg,
          };
        }
        return { field: 'unknown', message: msg };
      });
    }

    return [];
  }

  private logException(
    exception: HttpException,
    request: Request,
    statusCode: number,
  ): void {
    const context = {
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      statusCode,
    };

    if (statusCode >= 500) {
      this.logger.error(
        `HttpException ${statusCode} on ${request.method} ${request.url}`,
        exception.stack,
        context,
      );
    } else {
      // 4xx are expected client errors — log at warn level, no stack trace needed
      this.logger.warn(
        `HttpException ${statusCode} on ${request.method} ${request.url}: ${exception.message}`,
        context,
      );
    }
  }
}
