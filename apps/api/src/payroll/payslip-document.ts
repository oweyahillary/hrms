import PDFDocument from 'pdfkit';

/**
 * Pure payslip renderer. Takes already-resolved values (no DB, no Nest) and
 * returns a PDF buffer, so it is fully unit-testable. Figures are the frozen
 * payslip record — this document never recomputes payroll.
 */
export interface PayslipDocumentData {
  employer: {
    name: string;
    kraPin?: string | null;
    address?: string | null;
    registrationNumber?: string | null;
    notice?: string | null;
    logo?: { buffer: Buffer; alignment: 'LEFT' | 'CENTER' | 'RIGHT' } | null;
  };
  employee: { fullName: string; employeeNumber: string; kraPin?: string | null };
  period: { month: number; year: number; runType: string };
  earnings: { grossPay: number; lines?: { label: string; amount: number }[] };
  deductions: {
    paye: number;
    nssfEmployee: number;
    shif: number;
    ahlEmployee: number;
    otherDeductions: number;
    /** Itemized breakdown of otherDeductions (loan repayments, one-off deductions,
     *  salary-structure voluntary deductions). Omitted for payslips predating this
     *  breakdown — falls back to a single "Other deductions" line. */
    otherDeductionLines?: { label: string; amount: number }[];
  };
  employerContributions: { nssfEmployer: number; ahlEmployer: number };
  netPay: number;
  oneThirdRulePass: boolean;
  generatedAt: Date;
  reference: string;
}

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const money = (n: number): string =>
  'KES ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderPayslipPdf(data: PayslipDocumentData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const L = 50;
  const R = 545;
  const W = R - L;
  const AMT = 150;

  const rule = (y: number): void => {
    doc.moveTo(L, y).lineTo(R, y).strokeColor('#cccccc').lineWidth(1).stroke();
  };
  const header = (t: string): void => {
    doc.x = L;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(t, L, doc.y);
    doc.y += 4;
  };
  const row = (
    label: string,
    value: string,
    o: { bold?: boolean; size?: number; color?: string; indent?: number; h?: number } = {},
  ): void => {
    const y = doc.y;
    doc.fontSize(o.size ?? 10).font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(o.color ?? '#000000');
    doc.text(label, L + (o.indent ?? 0), y, { width: W - AMT - 5, lineBreak: false });
    doc.text(value, R - AMT, y, { width: AMT, align: 'right', lineBreak: false });
    doc.x = L;
    doc.y = y + (o.h ?? 15);
  };

  // --- Branding header: logo (aligned per org setting) + employer identity ---
  const align = data.employer.logo?.alignment ?? 'LEFT';
  const textAlign: 'left' | 'center' | 'right' =
    align === 'CENTER' ? 'center' : align === 'RIGHT' ? 'right' : 'left';

  let headerY = 50;
  // Logo is fail-soft: embed only if a valid PNG/JPEG buffer decodes; any
  // failure falls through to a text-only header without throwing. pdfkit's
  // fit box caps the size and its align option handles LEFT/CENTER/RIGHT.
  if (data.employer.logo?.buffer) {
    try {
      const boxH = 60;
      const opts: { fit: [number, number]; align?: 'center' | 'right' } = { fit: [W, boxH] };
      if (align === 'CENTER') opts.align = 'center';
      else if (align === 'RIGHT') opts.align = 'right';
      doc.image(data.employer.logo.buffer, L, headerY, opts);
      headerY += boxH + 6;
    } catch {
      // corrupt/unsupported image — ignore and render text only
    }
  }

  // Employer identity, aligned as a block across the full content width.
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111111')
    .text(data.employer.name, L, headerY, { width: W, align: textAlign });
  doc.font('Helvetica').fontSize(9).fillColor('#444444');
  if (data.employer.kraPin) doc.text('KRA PIN: ' + data.employer.kraPin, L, doc.y, { width: W, align: textAlign });
  if (data.employer.registrationNumber) {
    doc.text('Reg. No: ' + data.employer.registrationNumber, L, doc.y, { width: W, align: textAlign });
  }
  if (data.employer.address) doc.text(data.employer.address, L, doc.y, { width: W, align: textAlign });
  const notice = (data.employer.notice ?? '').trim();
  if (notice) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666').text(notice, L, doc.y + 2, { width: W, align: textAlign });
  }
  doc.x = L;
  doc.y += 10;
  rule(doc.y);
  doc.y += 6;

  // Centered title, decoupled from logo position so it never collides.
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text('PAYSLIP', L, doc.y, { width: W, align: 'center' });
  doc.x = L;
  doc.y += 10;

  // Employee + period (two columns)
  const topY = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text('EMPLOYEE', L, topY);
  doc.font('Helvetica').fontSize(9).fillColor('#333333');
  doc.text(data.employee.fullName, L, doc.y, { width: 260 });
  doc.text('Employee No: ' + data.employee.employeeNumber, L, doc.y, { width: 260 });
  if (data.employee.kraPin) doc.text('KRA PIN: ' + data.employee.kraPin, L, doc.y, { width: 260 });
  const leftEnd = doc.y;

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text('PAY PERIOD', L + 280, topY);
  doc.font('Helvetica').fontSize(9).fillColor('#333333');
  doc.text(MONTHS[data.period.month] + ' ' + data.period.year, L + 280, doc.y, { width: 200 });
  doc.text('Run type: ' + data.period.runType, L + 280, doc.y, { width: 200 });
  doc.text('Ref: ' + data.reference, L + 280, doc.y, { width: 200 });
  doc.x = L;
  doc.y = Math.max(leftEnd, doc.y) + 8;
  rule(doc.y);
  doc.y += 8;

  // Earnings
  header('EARNINGS');
  const earningsLines = data.earnings.lines ?? [];
  if (earningsLines.length) {
    const base = earningsLines.reduce((acc, l) => acc - l.amount, data.earnings.grossPay);
    row('Basic + allowances', money(base));
    for (const line of earningsLines) row(line.label, money(line.amount));
    doc.y += 2;
    rule(doc.y);
    doc.y += 4;
  }
  row('Gross Pay', money(data.earnings.grossPay), { bold: true });
  doc.y += 4;
  rule(doc.y);
  doc.y += 8;

  // Deductions
  header('STATUTORY & OTHER DEDUCTIONS');
  row('PAYE (income tax)', money(data.deductions.paye));
  row('NSSF (employee)', money(data.deductions.nssfEmployee));
  row('SHIF', money(data.deductions.shif));
  row('Affordable Housing Levy (employee)', money(data.deductions.ahlEmployee));
  if (data.deductions.otherDeductionLines?.length) {
    for (const line of data.deductions.otherDeductionLines) {
      row(line.label, money(line.amount));
    }
  } else if (Number(data.deductions.otherDeductions) > 0) {
    row('Other deductions', money(data.deductions.otherDeductions));
  }
  const totalDed =
    data.deductions.paye + data.deductions.nssfEmployee + data.deductions.shif +
    data.deductions.ahlEmployee + data.deductions.otherDeductions;
  doc.y += 2;
  rule(doc.y);
  doc.y += 6;
  row('Total deductions', money(totalDed), { bold: true });
  doc.y += 6;

  // Net pay box
  const boxY = doc.y;
  doc.rect(L, boxY, W, 30).fillAndStroke('#eef3ff', '#3366cc');
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(13).text('NET PAY', L + 12, boxY + 9, { lineBreak: false });
  doc.text(money(data.netPay), R - AMT - 12, boxY + 9, { width: AMT, align: 'right', lineBreak: false });
  doc.x = L;
  doc.y = boxY + 44;

  // Employer contributions (informational)
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#555555')
    .text('EMPLOYER CONTRIBUTIONS (not deducted from pay)', L, doc.y);
  doc.y += 3;
  row('NSSF (employer)', money(data.employerContributions.nssfEmployer), { size: 9, color: '#555555', h: 13 });
  row('Affordable Housing Levy (employer)', money(data.employerContributions.ahlEmployer), { size: 9, color: '#555555', h: 13 });
  doc.y += 8;

  // One-third note + footer
  doc.font('Helvetica').fontSize(8).fillColor(data.oneThirdRulePass ? '#2e7d32' : '#b00020').text(
    data.oneThirdRulePass
      ? 'One-third rule: PASS - net pay is at least one-third of gross (Employment Act 2007, s.19(3)).'
      : 'One-third rule: REVIEW - net pay is below one-third of gross.',
    L, doc.y, { width: W },
  );
  doc.y += 4;
  doc.fillColor('#999999').fontSize(8).text(
    'Generated ' + data.generatedAt.toISOString().slice(0, 19).replace('T', ' ') +
    ' UTC. System-generated document; no signature required.',
    L, doc.y, { width: W },
  );

  doc.end();
  return done;
}
