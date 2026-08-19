import { HttpException, HttpStatus } from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockHost(responseMock: { status: jest.Mock; json: jest.Mock }) {
  const request = {
    method: 'GET',
    url: '/test',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest' },
  };

  return {
    switchToHttp: () => ({
      getResponse: () => responseMock,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

function callFilter(
  filter: GlobalExceptionFilter,
  exception: unknown,
): { statusCode: number; body: unknown } {
  let capturedStatus = 0;
  let capturedBody: unknown = null;

  const responseMock = {
    status: jest.fn().mockImplementation((s: number) => {
      capturedStatus = s;
      return responseMock; // allow chaining
    }),
    json: jest.fn().mockImplementation((b: unknown) => {
      capturedBody = b;
    }),
  };

  filter.catch(exception, buildMockHost(responseMock));

  return { statusCode: capturedStatus, body: capturedBody };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
  });

  // ── Response structure ───────────────────────────────────────────────────

  it('returns statusCode, message, and timestamp on every response', () => {
    const { body } = callFilter(filter, new HttpException('bad', HttpStatus.BAD_REQUEST));
    const b = body as Record<string, unknown>;

    expect(b).toHaveProperty('statusCode');
    expect(b).toHaveProperty('message');
    expect(b).toHaveProperty('timestamp');
    expect(typeof b['timestamp']).toBe('string');
    // timestamp must be a valid ISO string
    expect(() => new Date(b['timestamp'] as string)).not.toThrow();
  });

  // ── Vietnamese friendly messages ─────────────────────────────────────────

  it.each([
    [HttpStatus.BAD_REQUEST, 'Thông tin không hợp lệ. Vui lòng kiểm tra lại.'],
    [HttpStatus.UNAUTHORIZED, 'Bạn cần đăng nhập để thực hiện thao tác này.'],
    [HttpStatus.FORBIDDEN, 'Bạn không có quyền thực hiện thao tác này.'],
    [HttpStatus.NOT_FOUND, 'Không tìm thấy thông tin yêu cầu.'],
    [HttpStatus.CONFLICT, 'Dữ liệu đã tồn tại. Vui lòng kiểm tra lại.'],
    [HttpStatus.TOO_MANY_REQUESTS, 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'],
    [HttpStatus.INTERNAL_SERVER_ERROR, 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại hoặc liên hệ hỗ trợ.'],
  ])('maps HTTP %i to correct Vietnamese message', (status, expectedMsg) => {
    const { statusCode, body } = callFilter(filter, new HttpException('ignored', status));
    const b = body as Record<string, unknown>;

    expect(statusCode).toBe(status);
    expect(b['message']).toBe(expectedMsg);
  });

  // ── Unexpected (non-HTTP) errors ─────────────────────────────────────────

  it('returns 500 with generic message for non-HttpException errors', () => {
    const { statusCode, body } = callFilter(filter, new Error('DB connection failed'));
    const b = body as Record<string, unknown>;

    expect(statusCode).toBe(500);
    expect(b['message']).toBe(
      'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại hoặc liên hệ hỗ trợ.',
    );
  });

  it('returns 500 with generic message for thrown strings', () => {
    const { statusCode, body } = callFilter(filter, 'something went wrong');
    const b = body as Record<string, unknown>;

    expect(statusCode).toBe(500);
    expect(b['message']).toBe(
      'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại hoặc liên hệ hỗ trợ.',
    );
  });

  // ── SECURITY: no internal details in response ────────────────────────────

  it('does NOT include stack trace in response body for HttpException', () => {
    const exc = new HttpException('some internal detail', HttpStatus.INTERNAL_SERVER_ERROR);
    const { body } = callFilter(filter, exc);
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain('stack');
    expect(serialised).not.toContain('at Object');
    expect(serialised).not.toContain('global-exception.filter');
  });

  it('does NOT include stack trace in response body for unexpected Error', () => {
    const err = new Error('SELECT * FROM users WHERE 1=1');
    const { body } = callFilter(filter, err);
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain('SELECT');
    expect(serialised).not.toContain('stack');
  });

  it('does NOT expose the original exception message for unexpected errors', () => {
    const { body } = callFilter(
      filter,
      new Error('PrismaClient: table "users" does not exist'),
    );
    const serialised = JSON.stringify(body);

    // No SQL or internal detail
    expect(serialised).not.toContain('PrismaClient');
    expect(serialised).not.toContain('users');
  });

  // ── Validation errors (400) — safe field-level details ───────────────────

  it('includes errors array for class-validator 400 responses', () => {
    const payload = {
      statusCode: 400,
      message: ['email must be a valid email', 'password should not be empty'],
      error: 'Bad Request',
    };
    const exc = new HttpException(payload, HttpStatus.BAD_REQUEST);
    const { body } = callFilter(filter, exc);
    const b = body as Record<string, unknown>;

    expect(Array.isArray(b['errors'])).toBe(true);
    const errors = b['errors'] as Array<{ field: string; message: string }>;
    expect(errors.length).toBe(2);
    expect(errors[0]).toHaveProperty('field');
    expect(errors[0]).toHaveProperty('message');
  });

  it('does NOT include errors array for non-400 HttpExceptions', () => {
    const exc = new HttpException('forbidden', HttpStatus.FORBIDDEN);
    const { body } = callFilter(filter, exc);
    const b = body as Record<string, unknown>;

    expect(b['errors']).toBeUndefined();
  });

  it('does NOT include errors array when 400 response has no message array', () => {
    const exc = new HttpException('bad request', HttpStatus.BAD_REQUEST);
    const { body } = callFilter(filter, exc);
    const b = body as Record<string, unknown>;

    // When there's no array of constraint messages, errors should be absent
    expect(b['errors']).toBeUndefined();
  });
});
