/**
 * Seed the current Kenyan statutory rate versions (global — no organization).
 * Idempotent: skips a version that already exists for that rateType+effectiveDate.
 * These are the STARTING values; edit/extend them via POST /api/statutory-rates.
 *
 *   cd apps/api && npx ts-node scripts/seed-statutory-rates.ts
 */
import 'dotenv/config';
import { createPrismaClient } from '../src/prisma/prisma.service';

const RATES: Array<{ rateType: string; effectiveDate: string; parameters: unknown }> = [
  {
    rateType: 'PAYE_BAND',
    effectiveDate: '2023-07-01', // Finance Act 2023 bands, current for 2026
    parameters: {
      bands: [
        { upTo: 24000, rate: 0.10 },
        { upTo: 32333, rate: 0.25 },
        { upTo: 500000, rate: 0.30 },
        { upTo: 800000, rate: 0.325 },
        { upTo: null, rate: 0.35 },
      ],
      personalRelief: 2400,
    },
  },
  {
    rateType: 'NSSF',
    effectiveDate: '2026-02-01', // Phase 4: LEL 9,000 / UEL 108,000
    parameters: { rate: 0.06, lowerLimit: 9000, upperLimit: 108000, deductibleForPaye: true },
  },
  {
    rateType: 'SHIF',
    effectiveDate: '2024-10-01', // replaced NHIF; 2.75%, floor 300
    parameters: { rate: 0.0275, floor: 300, deductibleForPaye: true },
  },
  {
    rateType: 'AHL',
    effectiveDate: '2024-03-19', // Affordable Housing Act 2024; 1.5%
    parameters: { rate: 0.015, deductibleForPaye: true },
  },
];

async function main() {
  const prisma = createPrismaClient();
  let created = 0, skipped = 0;
  for (const r of RATES) {
    const existing = await prisma.statutoryRate.findFirst({
      where: { rateType: r.rateType as never, effectiveDate: new Date(r.effectiveDate) },
    });
    if (existing) { skipped += 1; continue; }
    await prisma.statutoryRate.create({
      data: { rateType: r.rateType, effectiveDate: new Date(r.effectiveDate), parameters: r.parameters } as never,
    });
    created += 1;
  }
  console.log(`\nStatutory rates seed complete: ${created} created, ${skipped} already present.`);
  console.log('Edit or add future versions via POST /api/statutory-rates (Admin).');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
