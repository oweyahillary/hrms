import {
  ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

/**
 * Maps Prisma "record not found" (P2025) to a clean 404. This is what the
 * tenant fail-closed guard raises when an update/delete targets a row outside the
 * caller's organization, so a cross-tenant attempt reads as an ordinary not-found
 * rather than a 500. Any other Prisma error keeps the prior behaviour (generic
 * 500), so this filter doesn't change existing responses.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PrismaExceptionFilter');

  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status: (c: number) => { json: (b: unknown) => void } }>();

    if (err.code === 'P2025') {
      const e = new NotFoundException('Resource not found');
      res.status(e.getStatus()).json(e.getResponse());
      return;
    }

    this.logger.error(`Unmapped Prisma error ${err.code}: ${err.message}`);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
