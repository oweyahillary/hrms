import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import type { CreateConsentDto } from './dto/create-consent.dto';

interface ConsentRow {
  id: string; employeeId: string; purpose: string; lawfulBasis: string;
  grantedAt: Date; withdrawnAt: Date | null;
}

@Injectable()
export class ConsentService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async grant(employeeId: string, dto: CreateConsentDto) {
    await this.assertEmployee(employeeId);
    const row = (await this.prisma.consentRecord.create({
      data: {
        employeeId, purpose: dto.purpose, lawfulBasis: dto.lawfulBasis,
        ...(dto.grantedAt ? { grantedAt: new Date(dto.grantedAt) } : {}),
      } as never,
    })) as unknown as ConsentRow;
    return this.present(row);
  }

  async listForEmployee(employeeId: string) {
    await this.assertEmployee(employeeId);
    const rows = (await this.prisma.consentRecord.findMany({
      where: { employeeId } as never, orderBy: { grantedAt: 'desc' },
    })) as unknown as ConsentRow[];
    return rows.map((r) => this.present(r));
  }

  async get(id: string) { return this.present(await this.mustOwn(id)); }

  async withdraw(id: string) {
    const row = await this.mustOwn(id);
    if (row.withdrawnAt) throw new ConflictException('Consent already withdrawn.');
    const updated = (await this.prisma.consentRecord.update({
      where: { id }, data: { withdrawnAt: new Date() } as never,
    })) as unknown as ConsentRow;
    return this.present(updated);
  }

  private async assertEmployee(employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId } as never });
    if (!emp) throw new NotFoundException('Employee not found');
  }

  private async mustOwn(id: string): Promise<ConsentRow> {
    const row = (await this.prisma.consentRecord.findFirst({ where: { id } as never })) as unknown as ConsentRow | null;
    if (!row) throw new NotFoundException('Consent record not found');
    return row;
  }

  private present(r: ConsentRow) {
    return {
      id: r.id, employeeId: r.employeeId, purpose: r.purpose, lawfulBasis: r.lawfulBasis,
      grantedAt: r.grantedAt, withdrawnAt: r.withdrawnAt, active: r.withdrawnAt === null,
    };
  }
}
