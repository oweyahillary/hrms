import 'reflect-metadata';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { getRequestContext, runWithContext } from './common/context/request-context';

const ICLOCK_BODY_MAX_BYTES = 256 * 1024;

/**
 * Collects the raw request body as text for POST /iclock/cdata (ATTLOG
 * pushes), bypassing Nest's default json/urlencoded parsers entirely rather
 * than relying on a Content-Type match — ZK firmware's exact Content-Type
 * header for this push isn't verified against a real unit, so reading raw
 * bytes regardless of header is the safer bet (flagged in the summary).
 * Doubles as the body-size cap: an oversized push just gets its socket cut.
 *
 * IMPORTANT: raw req.on('data'/'end') callbacks do NOT inherit the
 * AsyncLocalStorage context that was active when .on() was called — verified
 * directly (a minimal repro showed storage.getStore() reading undefined
 * inside the 'end' callback even though it was set right before). Capturing
 * the context synchronously here, then re-entering it via runWithContext
 * around next(), is what keeps request-context (and therefore tenant
 * scoping) working for this one path — every other route stays sync/promise-
 * chained from the middleware that established it, which propagates fine.
 */
function iclockRawTextBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== 'POST') return next();
  const ctx = getRequestContext();
  let data = '';
  let tooLarge = false;
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    if (tooLarge) return;
    data += chunk;
    if (data.length > ICLOCK_BODY_MAX_BYTES) {
      tooLarge = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooLarge) return;
    (req as unknown as { body: string }).body = data;
    runWithContext(ctx, () => next());
  });
}

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

  // --- ZKTeco ADMS/iClock device push: raw-text body ahead of Nest's own
  // json/urlencoded parsers, scoped to exactly the one path that carries a
  // device body. See iclockRawTextBody's own comment for why. ---
  app.use('/iclock/cdata', iclockRawTextBody);

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

  // /iclock/* stays OFF the 'api' prefix: real ZK terminals hardcode this
  // exact path in firmware (only host/port is configurable on the device),
  // so it must be reachable at /iclock/..., not /api/iclock/.... Listed as
  // literal paths, not a wildcard, for the same path-to-regexp v8 reason as
  // the request-context middleware above.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'iclock/cdata', method: RequestMethod.ALL },
      { path: 'iclock/getrequest', method: RequestMethod.ALL },
    ],
  });

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
