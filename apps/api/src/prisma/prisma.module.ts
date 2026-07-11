import { Global, Inject, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { createPrismaClient, ExtendedPrismaClient, PRISMA } from './prisma.service';
import { PrismaExceptionFilter } from './prisma-exception.filter';

const prismaProvider = {
  provide: PRISMA,
  useFactory: (): ExtendedPrismaClient => createPrismaClient(),
};

/**
 * Global so every feature module can inject the PRISMA token without re-importing.
 * The module owns the client's connect/disconnect lifecycle.
 */
@Global()
@Module({
  providers: [prismaProvider, { provide: APP_FILTER, useClass: PrismaExceptionFilter }],
  exports: [PRISMA],
})
export class PrismaModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaModule.name);

  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('Prisma connected to PostgreSQL (tenant-scoping + audit active)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
