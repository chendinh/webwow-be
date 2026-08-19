import { ValidationPipe } from '@nestjs/common';

/**
 * Custom validation pipe with sensible defaults for the platform:
 * - whitelist: strip unknown properties from DTOs
 * - forbidNonWhitelisted: throw 400 if unknown properties are present
 * - transform: auto-transform payloads to DTO class instances
 * - transformOptions.enableImplicitConversion: convert query param strings to
 *   their declared primitive types (e.g., "1" → 1 for @Type(() => Number))
 *
 * Note: main.ts already registers this globally. This export allows consumers
 * to instantiate it explicitly if needed (e.g., specific endpoints or testing).
 */
export const customValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: {
    enableImplicitConversion: true,
  },
});
