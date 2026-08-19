import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);

  // Global API prefix — all routes are served under /api
  app.setGlobalPrefix('api');

  // Global exception filter — sanitises all error responses (no internal details leaked)
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Security
  app.use(helmet());

  // CORS
  const frontendUrl = configService.get<string>('app.frontendUrl') ?? 'http://localhost:3001';
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI IT Team SaaS API')
    .setDescription('Backend API for AI IT Team SaaS MVP')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('app.port') ?? 3000;
  await app.listen(port);
}

void bootstrap();
