import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RequestContextMiddleware } from './common/context/request-context.middleware';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // --- Request context FIRST: establish the AsyncLocalStorage store so the
  // whole request (guards, handlers, Prisma extension) runs inside it. Bound
  // globally here rather than via forRoutes('*') to avoid the path-to-regexp v8
  // wildcard deprecation and to guarantee it wraps every request. ---
  const requestContext = new RequestContextMiddleware();
  app.use(requestContext.use.bind(requestContext));

  // --- Security baseline ---
  app.use(helmet());
  app.enableCors({ origin: true, credentials: true });

  // --- Global input validation: reject unknown fields, coerce DTO types ---
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api');

  // --- OpenAPI / Swagger (always in sync with the code) ---
  const swaggerConfig = new DocumentBuilder()
    .setTitle('HRMS API')
    .setDescription('Kenyan HRMS — Phase 1')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  logger.log(`HRMS API listening on http://localhost:${port}/api`);
  logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
}

// Auto-start only when run directly (VPS/Docker: `node dist/main.js`).
// Under cPanel/Passenger the shim (passenger.js) calls bootstrap() itself.
if (require.main === module) {
  void bootstrap();
}
