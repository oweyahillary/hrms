import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ExtendedPrismaClient, PRISMA } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  /** Liveness — the process is up and serving. */
  @Get()
  @ApiOkResponse({ description: 'Service is live.' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness — the process can reach its database. */
  @Get('ready')
  @ApiOkResponse({ description: 'Service can reach its dependencies.' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}
