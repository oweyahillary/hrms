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

// ---------------------------------------------------------------------------
// Register-style reports (row lists, not period summaries).

interface Col { x: number; w: number; label: string; align: 'left' | 'right' }

function plainHeader(doc: PDFKit.PDFDocument, title: string, employer: string, subtitle: string): number {
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#111111').text(title, 40, 44, { width: 515, align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor('#444444').text(subtitle, 40, 66, { width: 515, align: 'center' });
  doc.fontSize(11).fillColor('#111111').text(employer || '—', 40, 90, { width: 515, align: 'center' });
  doc.moveTo(40, 114).lineTo(555, 114).lineWidth(0.7).strokeColor('#999999').stroke();
  return 128;
}

function colHeader(doc: PDFKit.PDFDocument, cols: Col[], y: number): number {
  doc.rect(40, y, 515, 20).fillAndStroke('#f0f0f0', '#999999');
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(8.5);
  for (const c of cols) doc.text(c.label, c.x + 3, y + 6, { width: c.w - 6, align: c.align });
  return y + 20;
}

export interface LoanBookPdfData {
  employer: string;
  filter: { employeeId: string | null; status: string | null };
  rows: Array<{
    employeeName: string; employeeNumber: string; type: string; status: string;
    principal: number; balance: number; installmentsRemaining: number; nextDueAmount: number;
  }>;
  totals: { count: number; totalPrincipal: number; totalOutstanding: number; byStatus: Record<string, number> };
  generatedAt: Date;
}

export function renderLoanBookPdf(d: LoanBookPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const cols: Col[] = [
    { x: 40, w: 118, label: 'Employee', align: 'left' },
    { x: 158, w: 48, label: 'Type', align: 'left' },
    { x: 206, w: 60, label: 'Status', align: 'left' },
    { x: 266, w: 68, label: 'Principal', align: 'right' },
    { x: 334, w: 68, label: 'Balance', align: 'right' },
    { x: 402, w: 40, label: 'Inst.', align: 'right' },
    { x: 442, w: 113, label: 'Next Due', align: 'right' },
  ];
  const subtitle = `As at ${d.generatedAt.toISOString().slice(0, 10)}`
    + (d.filter.status ? `  ·  status: ${d.filter.status}` : '')
    + (d.filter.employeeId ? '  ·  filtered by employee' : '');
  let y = plainHeader(doc, 'LOAN & ADVANCE BOOK', d.employer, subtitle);
  y = colHeader(doc, cols, y);

  doc.font('Helvetica').fontSize(8.5);
  for (const r of d.rows) {
    if (y > 770) { doc.addPage(); y = 50; y = colHeader(doc, cols, y); doc.font('Helvetica').fontSize(8.5); }
    doc.fillColor('#111111');
    doc.text(`${r.employeeName}${r.employeeNumber ? ` (${r.employeeNumber})` : ''}`, cols[0].x + 3, y + 6, { width: cols[0].w - 6 });
    doc.text(r.type, cols[1].x + 3, y + 6, { width: cols[1].w - 6 });
    doc.text(r.status, cols[2].x + 3, y + 6, { width: cols[2].w - 6 });
    doc.text(money(r.principal), cols[3].x + 3, y + 6, { width: cols[3].w - 6, align: 'right' });
    doc.text(money(r.balance), cols[4].x + 3, y + 6, { width: cols[4].w - 6, align: 'right' });
    doc.text(String(r.installmentsRemaining), cols[5].x + 3, y + 6, { width: cols[5].w - 6, align: 'right' });
    doc.text(money(r.nextDueAmount), cols[6].x + 3, y + 6, { width: cols[6].w - 6, align: 'right' });
    y += 18;
    doc.moveTo(40, y).lineTo(555, y).lineWidth(0.3).strokeColor('#dddddd').stroke();
  }

  if (y > 740) { doc.addPage(); y = 50; }
  y += 6;
  doc.rect(40, y, 515, 22).fillAndStroke('#eaeaea', '#999999');
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(9.5);
  doc.text('OUTSTANDING EXPOSURE (active balances)', cols[0].x + 3, y + 6, { width: 330 });
  doc.text(money(d.totals.totalOutstanding), cols[6].x + 3, y + 6, { width: cols[6].w - 6, align: 'right' });
  y += 30;
  const statusLine = Object.entries(d.totals.byStatus).map(([s, n]) => `${s}: ${n}`).join('    ·    ');
  doc.font('Helvetica').fontSize(8.5).fillColor('#666666')
    .text(`${d.totals.count} record(s)    ·    ${statusLine}    ·    Generated ${d.generatedAt.toISOString().slice(0, 10)}`, 40, y, { width: 515 });
  return bufferize(doc);
}

export interface SeveranceRegisterPdfData {
  employer: string;
  rows: Array<{
    employeeName: string; employeeNumber: string; exitDate: string; reason: string;
    completedYears: number | null; severanceAmount: number; noticePayInLieu: number | null;
    payeStatus: string; provisional: boolean; bucket: string | null;
  }>;
  totals: { count: number; totalSeverance: number; totalNoticePayInLieu: number; provisionalCount: number };
  generatedAt: Date;
}

/** Short, audit-legible label for the applied KRA spreading bucket. */
function bucketLabel(bucket: string | null): string {
  switch (bucket) {
    case 'FIXED_TERM': return 'Fixed term';
    case 'UNSPECIFIED_WITH_CLAUSE': return 'Unspecified';
    case 'NO_PROVISION': return 'No provision';
    default: return '\u2014';
  }
}

export function renderSeveranceRegisterPdf(d: SeveranceRegisterPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const cols: Col[] = [
    { x: 40, w: 96, label: 'Employee', align: 'left' },
    { x: 136, w: 50, label: 'Exit', align: 'left' },
    { x: 186, w: 52, label: 'Reason', align: 'left' },
    { x: 238, w: 26, label: 'Yrs', align: 'right' },
    { x: 264, w: 68, label: 'Severance', align: 'right' },
    { x: 332, w: 60, label: 'Notice Pay', align: 'right' },
    { x: 392, w: 70, label: 'Rule', align: 'left' },
    { x: 462, w: 93, label: 'PAYE', align: 'left' },
  ];
  let y = plainHeader(doc, 'SEVERANCE REGISTER', d.employer, `As at ${d.generatedAt.toISOString().slice(0, 10)}`);
  y = colHeader(doc, cols, y);

  doc.fontSize(8.5);
  for (const r of d.rows) {
    if (y > 770) { doc.addPage(); y = 50; y = colHeader(doc, cols, y); doc.fontSize(8.5); }
    doc.font('Helvetica').fillColor('#111111');
    doc.text(`${r.employeeName}${r.employeeNumber ? ` (${r.employeeNumber})` : ''}`, cols[0].x + 3, y + 6, { width: cols[0].w - 6 });
    doc.text(r.exitDate, cols[1].x + 3, y + 6, { width: cols[1].w - 6 });
    doc.text(r.reason, cols[2].x + 3, y + 6, { width: cols[2].w - 6 });
    doc.text(r.completedYears == null ? '—' : String(r.completedYears), cols[3].x + 3, y + 6, { width: cols[3].w - 6, align: 'right' });
    doc.text(money(r.severanceAmount), cols[4].x + 3, y + 6, { width: cols[4].w - 6, align: 'right' });
    doc.text(r.noticePayInLieu == null ? '—' : money(r.noticePayInLieu), cols[5].x + 3, y + 6, { width: cols[5].w - 6, align: 'right' });
    doc.text(bucketLabel(r.bucket), cols[6].x + 3, y + 6, { width: cols[6].w - 6 });
    // PAYE status — provisional/unverified entries in red so an auditor sees them.
    doc.font(r.provisional ? 'Helvetica-Bold' : 'Helvetica').fillColor(r.provisional ? '#b00000' : '#444444').fontSize(7.5);
    doc.text(r.provisional ? 'PROVISIONAL (!)' : r.payeStatus, cols[7].x + 3, y + 6, { width: cols[7].w - 6 });
    doc.fontSize(8.5);
    y += 18;
    doc.moveTo(40, y).lineTo(555, y).lineWidth(0.3).strokeColor('#dddddd').stroke();
  }

  if (y > 720) { doc.addPage(); y = 50; }
  y += 6;
  doc.rect(40, y, 515, 22).fillAndStroke('#eaeaea', '#999999');
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(9.5);
  doc.text('TOTAL SEVERANCE', cols[0].x + 3, y + 6, { width: 260 });
  doc.text(money(d.totals.totalSeverance), cols[4].x + 3, y + 6, { width: cols[4].w - 6, align: 'right' });
  doc.text(money(d.totals.totalNoticePayInLieu), cols[5].x + 3, y + 6, { width: cols[5].w - 6, align: 'right' });
  y += 30;
  if (d.totals.provisionalCount > 0) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#b00000').text(
      `(!) ${d.totals.provisionalCount} of ${d.totals.count} record(s) carry a PROVISIONAL, UNVERIFIED PAYE figure — `
      + 'severance lump-sum tax treatment is not confirmed. Do not rely on the PAYE figures without KRA guidance.',
      40, y, { width: 515 },
    );
    y += 30;
  }
  doc.font('Helvetica').fontSize(8.5).fillColor('#666666')
    .text(`${d.totals.count} record(s)    ·    Generated ${d.generatedAt.toISOString().slice(0, 10)}`, 40, y, { width: 515 });
  return bufferize(doc);
}

export interface AdjustmentsRegisterPdfData {
  employer: string;
  filter: { employeeId: string | null; status: string | null; year: number | null; month: number | null };
  rows: Array<{
    employeeName: string; employeeNumber: string; type: string; amount: number; isTaxable: boolean;
    reason: string; targetPeriodMonth: number; targetPeriodYear: number; status: string;
  }>;
  totals: { count: number; totalBonuses: number; totalDeductions: number; byStatus: Record<string, number> };
  generatedAt: Date;
}

export function renderAdjustmentsRegisterPdf(d: AdjustmentsRegisterPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const cols: Col[] = [
    { x: 40, w: 110, label: 'Employee', align: 'left' },
    { x: 150, w: 58, label: 'Type', align: 'left' },
    { x: 208, w: 68, label: 'Amount', align: 'right' },
    { x: 276, w: 52, label: 'Taxable', align: 'left' },
    { x: 328, w: 56, label: 'Period', align: 'left' },
    { x: 384, w: 64, label: 'Status', align: 'left' },
    { x: 448, w: 107, label: 'Reason', align: 'left' },
  ];
  const subtitle = `As at ${d.generatedAt.toISOString().slice(0, 10)}`
    + (d.filter.status ? `  ·  status: ${d.filter.status}` : '')
    + (d.filter.year ? `  ·  ${String(d.filter.month ?? '').padStart(2, '0')}${d.filter.month ? '/' : ''}${d.filter.year}` : '')
    + (d.filter.employeeId ? '  ·  filtered by employee' : '');
  let y = plainHeader(doc, 'DEDUCTIONS & BONUSES REGISTER', d.employer, subtitle);
  y = colHeader(doc, cols, y);

  doc.font('Helvetica').fontSize(8.5);
  for (const r of d.rows) {
    if (y > 770) { doc.addPage(); y = 50; y = colHeader(doc, cols, y); doc.font('Helvetica').fontSize(8.5); }
    doc.fillColor('#111111');
    doc.text(`${r.employeeName}${r.employeeNumber ? ` (${r.employeeNumber})` : ''}`, cols[0].x + 3, y + 6, { width: cols[0].w - 6 });
    doc.text(r.type === 'BONUS' ? 'Bonus' : 'Deduction', cols[1].x + 3, y + 6, { width: cols[1].w - 6 });
    doc.text(money(r.amount), cols[2].x + 3, y + 6, { width: cols[2].w - 6, align: 'right' });
    doc.text(r.type === 'BONUS' ? (r.isTaxable ? 'Yes' : 'No') : '\u2014', cols[3].x + 3, y + 6, { width: cols[3].w - 6 });
    doc.text(`${String(r.targetPeriodMonth).padStart(2, '0')}/${r.targetPeriodYear}`, cols[4].x + 3, y + 6, { width: cols[4].w - 6 });
    doc.text(r.status, cols[5].x + 3, y + 6, { width: cols[5].w - 6 });
    doc.text(r.reason, cols[6].x + 3, y + 6, { width: cols[6].w - 6 });
    y += 18;
    doc.moveTo(40, y).lineTo(555, y).lineWidth(0.3).strokeColor('#dddddd').stroke();
  }

  if (y > 740) { doc.addPage(); y = 50; }
  y += 6;
  doc.rect(40, y, 515, 22).fillAndStroke('#eaeaea', '#999999');
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(9.5);
  doc.text('TOTALS (excludes cancelled)', cols[0].x + 3, y + 6, { width: 260 });
  doc.text(`Bonuses ${money(d.totals.totalBonuses)}   ·   Deductions ${money(d.totals.totalDeductions)}`, cols[2].x + 3, y + 6, { width: 347, align: 'right' });
  y += 30;
  const statusLine = Object.entries(d.totals.byStatus).map(([s, n]) => `${s}: ${n}`).join('    ·    ');
  doc.font('Helvetica').fontSize(8.5).fillColor('#666666')
    .text(`${d.totals.count} record(s)    ·    ${statusLine}    ·    Generated ${d.generatedAt.toISOString().slice(0, 10)}`, 40, y, { width: 515 });
  return bufferize(doc);
}
