import PDFDocument from 'pdfkit';

/**
 * Pure P9 (Tax Deduction Card) renderer. Takes the already-assembled card
 * (no DB, no Nest) and returns a PDF buffer. Faithful to KRA's P9A column set
 * (A–O) in a landscape grid; the defined-contribution pension column (E) shows
 * the deductible actual, with the E1/E2/E3 lower-of-three rule in the notes.
 */
export interface P9DocRow {
  month: number;
  A: number; B: number; C: number; D: number; E: number; F: number; G: number;
  H: number; I: number; J: number; K: number; L: number; M: number; N: number; O: number;
}
export interface P9DocumentData {
  year: number;
  employer: { name: string; kraPin: string };
  employee: { name: string; employeeNumber: string; kraPin: string };
  rows: P9DocRow[];
  totals: Omit<P9DocRow, 'month'>;
  reconciles: boolean;
  generatedAt: Date;
}

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type ColKey = keyof Omit<P9DocRow, 'month'>;
interface Col { key: 'month' | ColKey; label: string; letter: string; w: number; }

const COLS: Col[] = [
  { key: 'month', label: 'Month', letter: '', w: 56 },
  { key: 'A', label: 'Basic', letter: 'A', w: 52 },
  { key: 'B', label: 'Non-Cash', letter: 'B', w: 50 },
  { key: 'C', label: 'Quarters', letter: 'C', w: 48 },
  { key: 'D', label: 'Gross', letter: 'D', w: 54 },
  { key: 'E', label: 'Pension', letter: 'E', w: 50 },
  { key: 'F', label: 'AHL', letter: 'F', w: 46 },
  { key: 'G', label: 'SHIF', letter: 'G', w: 48 },
  { key: 'H', label: 'PRMF', letter: 'H', w: 44 },
  { key: 'I', label: 'Own.Int', letter: 'I', w: 46 },
  { key: 'J', label: 'Tot.Ded', letter: 'J', w: 52 },
  { key: 'K', label: 'Charg.', letter: 'K', w: 54 },
  { key: 'L', label: 'Tax Chgd', letter: 'L', w: 52 },
  { key: 'M', label: 'Relief', letter: 'M', w: 46 },
  { key: 'N', label: 'Ins.Rel', letter: 'N', w: 44 },
  { key: 'O', label: 'PAYE', letter: 'O', w: 52 },
];

const money = (n: number): string =>
  Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderP9Pdf(data: P9DocumentData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const L = 24;
  const R = L + COLS.reduce((s, c) => s + c.w, 0); // 818
  const xOf: number[] = [];
  { let x = L; for (const c of COLS) { xOf.push(x); x += c.w; } }

  // ---- Title ----
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111')
    .text('TAX DEDUCTION CARD (P9A)', L, 26, { width: R - L, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#444444')
    .text(`Kenya Revenue Authority  ·  Year ${data.year}`, L, 44, { width: R - L, align: 'center' });

  // ---- Identity ----
  let y = 62;
  doc.fontSize(8.5).fillColor('#111111');
  doc.font('Helvetica-Bold').text('Employer: ', L, y, { continued: true })
    .font('Helvetica').text(`${data.employer.name}    PIN: ${data.employer.kraPin || '—'}`);
  y += 13;
  doc.font('Helvetica-Bold').text('Employee: ', L, y, { continued: true })
    .font('Helvetica').text(`${data.employee.name}  (${data.employee.employeeNumber})    PIN: ${data.employee.kraPin || '—'}`);
  y += 16;

  // ---- Grid header (label row + letter row) ----
  const headTop = y;
  const rowH = 15;
  const headH = 22;
  doc.rect(L, headTop, R - L, headH).fillAndStroke('#f0f0f0', '#999999');
  doc.fillColor('#111111');
  COLS.forEach((c, i) => {
    const x = xOf[i];
    doc.font('Helvetica-Bold').fontSize(6.5)
      .text(c.label, x + 2, headTop + 3, { width: c.w - 4, align: c.key === 'month' ? 'left' : 'right' });
    if (c.letter) {
      doc.font('Helvetica').fontSize(6).fillColor('#666666')
        .text(c.letter, x + 2, headTop + 12, { width: c.w - 4, align: 'right' });
      doc.fillColor('#111111');
    }
  });
  y = headTop + headH;

  // ---- Month rows (all 12; blank where no run) ----
  const byMonth = new Map<number, P9DocRow>();
  for (const r of data.rows) byMonth.set(r.month, r);

  const drawCell = (text: string, colIdx: number, ry: number, bold = false): void => {
    const c = COLS[colIdx];
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.8).fillColor('#111111')
      .text(text, xOf[colIdx] + 2, ry + 4, { width: c.w - 4, align: c.key === 'month' ? 'left' : 'right' });
  };

  for (let m = 1; m <= 12; m += 1) {
    const row = byMonth.get(m);
    const shade = m % 2 === 0;
    if (shade) doc.rect(L, y, R - L, rowH).fill('#fafafa');
    drawCell(MONTHS[m], 0, y);
    if (row) {
      COLS.forEach((c, i) => {
        if (c.key === 'month') return;
        drawCell(money(row[c.key as ColKey]), i, y);
      });
    }
    y += rowH;
  }

  // ---- TOTAL row ----
  doc.rect(L, y, R - L, rowH).fillAndStroke('#eaeaea', '#999999');
  drawCell('TOTAL', 0, y, true);
  COLS.forEach((c, i) => {
    if (c.key === 'month') return;
    drawCell(money(data.totals[c.key as ColKey]), i, y, true);
  });
  y += rowH;

  // ---- Grid borders (outer box + verticals) ----
  doc.lineWidth(0.5).strokeColor('#999999');
  doc.rect(L, headTop, R - L, y - headTop).stroke();
  for (let i = 1; i < COLS.length; i += 1) doc.moveTo(xOf[i], headTop).lineTo(xOf[i], y).stroke();

  // ---- Notes ----
  y += 10;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111111').text('Notes', L, y);
  y += 11;
  const notes = [
    'E — Defined-contribution retirement: deductible amount is the lowest of E1 (30% of basic), E2 (actual contribution), and E3 (KES 30,000 p.m.).',
    'F (AHL) and G (SHIF) deductions are allowable with effect from December 2024.',
    'H — Post-retirement medical fund contribution is deductible up to KES 15,000 p.m. (from December 2024).',
    'M — Personal relief is KES 2,400 p.m. (KES 28,800 p.a.).  N — Insurance relief is 15% of premiums up to KES 5,000 p.m.',
    'J = E+F+G+H+I.   K = D − J (chargeable pay).   O = L − M − N (PAYE).',
  ];
  doc.font('Helvetica').fontSize(6.8).fillColor('#333333');
  for (const n of notes) { doc.text(`•  ${n}`, L, y, { width: R - L }); y += 9.5; }

  // ---- Footer ----
  y += 6;
  const stamp = data.generatedAt.toISOString().slice(0, 10);
  doc.fontSize(6.5).fillColor('#777777').text(
    `Generated ${stamp}. Figures reflect finalized payroll for the year and reconcile to PAYE deducted${data.reconciles ? '' : ' (DISCREPANCY DETECTED — verify)'}.`,
    L, y, { width: R - L },
  );

  doc.end();
  return done;
}
