import PDFDocument from 'pdfkit';

/**
 * Pure report PDF renderers (no DB, no Nest) — return a PDF buffer from
 * already-aggregated report data. Portrait A4; simple tabular layout suited to
 * a finance person printing/filing the monthly figures.
 */
const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const money = (n: number): string =>
  Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function bufferize(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.end();
  return done;
}

function header(doc: PDFKit.PDFDocument, title: string, employer: string, period: { year: number; month: number }): number {
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#111111')
    .text(title, 40, 44, { width: 515, align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor('#444444')
    .text(`${MONTHS[period.month]} ${period.year}`, 40, 66, { width: 515, align: 'center' });
  doc.fontSize(11).fillColor('#111111')
    .text(employer || '—', 40, 92, { width: 515, align: 'center' });
  doc.moveTo(40, 116).lineTo(555, 116).lineWidth(0.7).strokeColor('#999999').stroke();
  return 130;
}

function footer(doc: PDFKit.PDFDocument, employeesPaid: number, generatedAt: Date, note?: string): void {
  const y = 780;
  if (note) doc.font('Helvetica').fontSize(8).fillColor('#666666').text(note, 40, y - 16, { width: 515 });
  doc.font('Helvetica').fontSize(8).fillColor('#777777').text(
    `Employees paid: ${employeesPaid}    ·    Generated ${generatedAt.toISOString().slice(0, 10)}`,
    40, y, { width: 515 },
  );
}

// ---------------------------------------------------------------------------
export interface RemittancePdfData {
  employer: string;
  period: { year: number; month: number };
  employeesPaid: number;
  items: Array<{ levy: string; payTo: string; employee: number; employer: number; total: number }>;
  grandTotal: number;
  generatedAt: Date;
}

export function renderRemittancePdf(d: RemittancePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  let y = header(doc, 'STATUTORY REMITTANCE SUMMARY', d.employer, d.period);

  const cols = [
    { x: 40, w: 90, label: 'Levy', align: 'left' as const },
    { x: 130, w: 165, label: 'Pay To', align: 'left' as const },
    { x: 295, w: 80, label: 'Employee', align: 'right' as const },
    { x: 375, w: 80, label: 'Employer', align: 'right' as const },
    { x: 455, w: 100, label: 'Total', align: 'right' as const },
  ];
  // header row
  doc.rect(40, y, 515, 20).fillAndStroke('#f0f0f0', '#999999');
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(9);
  for (const c of cols) doc.text(c.label, c.x + 4, y + 6, { width: c.w - 8, align: c.align });
  y += 20;

  doc.font('Helvetica').fontSize(9.5);
  for (const it of d.items) {
    doc.fillColor('#111111');
    doc.text(it.levy, cols[0].x + 4, y + 6, { width: cols[0].w - 8 });
    doc.text(it.payTo, cols[1].x + 4, y + 6, { width: cols[1].w - 8 });
    doc.text(money(it.employee), cols[2].x + 4, y + 6, { width: cols[2].w - 8, align: 'right' });
    doc.text(money(it.employer), cols[3].x + 4, y + 6, { width: cols[3].w - 8, align: 'right' });
    doc.text(money(it.total), cols[4].x + 4, y + 6, { width: cols[4].w - 8, align: 'right' });
    y += 20;
    doc.moveTo(40, y).lineTo(555, y).lineWidth(0.3).strokeColor('#cccccc').stroke();
  }

  // grand total row
  doc.rect(40, y, 515, 22).fillAndStroke('#eaeaea', '#999999');
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(10);
  doc.text('TOTAL DUE', cols[0].x + 4, y + 6, { width: cols[1].w + cols[0].w - 8 });
  doc.text(money(d.grandTotal), cols[4].x + 4, y + 6, { width: cols[4].w - 8, align: 'right' });
  y += 22;

  // column separators over the table body
  doc.lineWidth(0.5).strokeColor('#999999');
  footer(doc, d.employeesPaid, d.generatedAt,
    'Statutory deductions are generally due by the 9th of the following month. Verify current KRA/NSSF/SHA deadlines.');
  return bufferize(doc);
}

// ---------------------------------------------------------------------------
export interface PayrollSummaryPdfData {
  employer: string;
  period: { year: number; month: number };
  employeesPaid: number;
  grossPay: number;
  paye: number;
  nssf: { employee: number; employer: number; total: number };
  shif: number;
  ahl: { employee: number; employer: number; total: number };
  otherDeductions: number;
  netPay: number;
  generatedAt: Date;
}

export function renderPayrollSummaryPdf(d: PayrollSummaryPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  let y = header(doc, 'PAYROLL SUMMARY', d.employer, d.period);

  const line = (label: string, value: string, opts: { bold?: boolean; rule?: boolean } = {}): void => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 10).fillColor('#111111');
    doc.text(label, 60, y, { width: 320 });
    doc.text(value, 380, y, { width: 175, align: 'right' });
    y += 20;
    if (opts.rule) { doc.moveTo(40, y - 4).lineTo(555, y - 4).lineWidth(0.4).strokeColor('#cccccc').stroke(); }
  };

  line('Gross pay', money(d.grossPay), { bold: true, rule: true });
  y += 4;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666').text('DEDUCTIONS', 60, y); y += 16;
  line('PAYE', money(d.paye));
  line('NSSF (employee)', money(d.nssf.employee));
  line('SHIF', money(d.shif));
  line('AHL (employee)', money(d.ahl.employee));
  line('Other deductions', money(d.otherDeductions), { rule: true });
  line('Net pay', money(d.netPay), { bold: true });
  y += 10;

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666').text('EMPLOYER CONTRIBUTIONS', 60, y); y += 16;
  line('NSSF (employer)', money(d.nssf.employer));
  line('AHL (employer)', money(d.ahl.employer), { rule: true });
  line('Total employer cost', money(d.grossPay + d.nssf.employer + d.ahl.employer), { bold: true });

  footer(doc, d.employeesPaid, d.generatedAt);
  return bufferize(doc);
}
