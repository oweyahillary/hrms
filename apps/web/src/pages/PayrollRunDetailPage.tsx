import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Alert, Anchor, Badge, Box, Button, Card, Grid, Group, List, Modal, MultiSelect, ActionIcon,
  Select, Skeleton, Stack, Switch, Table, Text, ThemeIcon, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconArrowLeft, IconBriefcase, IconBuildingBank, IconCheck, IconCoin,
  IconDownload, IconFileInvoice, IconReceipt2, IconRefresh, IconRotateClockwise, IconTrash,
  IconUsers, IconWallet,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import {
  createCorrection, discardPayrollRun, downloadBankExport, downloadPayslipPdf, finalizePayrollRun,
  generateBankExport, generateMissingPdfs, getPayrollRun, listBankExports,
  type BankExportBatch, type BankExportFormat, type BankExportTemplate, type PayrollRunDetail,
  type PayrollRunStatus, type PayrollRunType, type Payslip, type SkippedEmployee,
} from '../api/payroll';
import { listEmployees } from '../api/employees';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { hasAnyPermission } from '../auth/permissions';
import { ErrorCard } from '../components/ErrorCard';
import { kes } from '../utils/money';

const STATUS_COLOR: Record<PayrollRunStatus, string> = {
  DRAFT: 'amber', PROCESSING: 'amber', FINALIZED: 'brand', PAID: 'sand',
};
const STATUS_LABEL: Record<PayrollRunStatus, string> = {
  DRAFT: 'Draft', PROCESSING: 'Processing', FINALIZED: 'Finalized', PAID: 'Paid',
};
const TYPE_COLOR: Record<PayrollRunType, string> = { REGULAR: 'sand', ADJUSTMENT: 'amber' };
const TYPE_LABEL: Record<PayrollRunType, string> = { REGULAR: 'Regular run', ADJUSTMENT: 'Correction run' };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface EmpInfo { name: string; number: string }

/** Pull employees into a lookup map. Payslips only carry employeeId. */
async function loadEmployeeMap(): Promise<Map<string, EmpInfo>> {
  const map = new Map<string, EmpInfo>();
  let page = 1;
  for (;;) {
    const res = await listEmployees({ page, pageSize: 100, sort: 'name', order: 'asc' });
    for (const e of res.data) map.set(e.id, { name: e.fullName, number: e.employeeNumber });
    if (page >= res.totalPages || page >= 10) break;
    page += 1;
  }
  return map;
}

function StatTile({ label, value, icon: TileIcon, color }: { label: string; value: string; icon: Icon; color: string }) {
  return (
    <Card p="md" radius="md" h="100%">
      <Group gap="sm" wrap="nowrap" align="center">
        <ThemeIcon size={34} radius="md" variant="light" color={color}>
          <TileIcon size={17} stroke={1.7} />
        </ThemeIcon>
        <div>
          <Text size="xs" c="sand.6" fw={500}>{label}</Text>
          <Text size="md" fw={700}>{value}</Text>
        </div>
      </Group>
    </Card>
  );
}

/** Underlines a figure with a tooltip breakdown when it's made up of more than one line item. */
function BreakdownText({ value, lines }: { value: string; lines: string[] }) {
  if (!lines.length) return <Text size="sm">{value}</Text>;
  return (
    <Tooltip
      withArrow multiline w={260}
      label={<Stack gap={2}>{lines.map((l, i) => <Text key={i} size="xs">{l}</Text>)}</Stack>}
    >
      <Text size="sm" style={{ textDecoration: 'underline dotted', cursor: 'help' }}>{value}</Text>
    </Tooltip>
  );
}

const PDF_STATUS_COLOR: Record<string, string> = { PENDING: 'sand', READY: 'brand', FAILED: 'red' };

function PdfCell({
  payslip, downloading, onDownload,
}: { payslip: Payslip; downloading: boolean; onDownload: (p: Payslip) => void }) {
  if (payslip.pdfStatus === 'READY') {
    return (
      <ActionIcon
        variant="light" color="brand" loading={downloading} onClick={() => onDownload(payslip)}
        aria-label="Download payslip PDF"
      >
        <IconDownload size={15} />
      </ActionIcon>
    );
  }
  return (
    <Badge variant="light" size="sm" color={PDF_STATUS_COLOR[payslip.pdfStatus] ?? 'sand'} style={{ whiteSpace: 'nowrap' }}>
      {payslip.pdfStatus === 'FAILED' ? 'Failed' : 'Pending'}
    </Badge>
  );
}

export function PayrollRunDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  // Matches the API's view gate (@AnyPermission on payroll.view/run/finalize)
  // — a view-only or finalize-only holder still needs to see the run.
  const allowed = hasAnyPermission(user?.permissions, ['payroll.view', 'payroll.run', 'payroll.finalize']);

  const [run, setRun] = useState<PayrollRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [empMap, setEmpMap] = useState<Map<string, EmpInfo>>(new Map());

  // Only present on the initial navigation right after creation — not something
  // a plain GET on this run will ever carry, so it can't be refetched later.
  const [skippedBanner, setSkippedBanner] = useState<SkippedEmployee[]>(
    (location.state as { skipped?: SkippedEmployee[] } | null)?.skipped ?? [],
  );

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionIds, setCorrectionIds] = useState<string[]>([]);
  const [correctionRound, setCorrectionRound] = useState(false);
  const [creatingCorrection, setCreatingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [newCorrectionId, setNewCorrectionId] = useState<string | null>(null);

  const [generatingPdfs, setGeneratingPdfs] = useState(false);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

  const [bankExports, setBankExports] = useState<BankExportBatch[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [exportFormat, setExportFormat] = useState<BankExportFormat>('csv');
  const [exportTemplate, setExportTemplate] = useState<BankExportTemplate>('generic');
  const [generatingExport, setGeneratingExport] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [downloadingBatchId, setDownloadingBatchId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await getPayrollRun(id);
    setRun(r);
    return r;
  }, [id]);

  useEffect(() => {
    if (!allowed || !id) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [r, map] = await Promise.all([getPayrollRun(id), loadEmployeeMap()]);
        if (cancelled) return;
        setRun(r);
        setEmpMap(map);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setRun(null);
        setError(
          e instanceof ApiError && e.status === 404
            ? 'That payroll run does not exist, or is not part of this organisation.'
            : 'This run could not load. Check your connection and try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, allowed, reloadKey]);

  const loadBankExports = useCallback(async (runId: string) => {
    setBankLoading(true);
    try {
      setBankExports(await listBankExports(runId));
    } catch {
      setBankExports([]);
    } finally {
      setBankLoading(false);
    }
  }, []);

  useEffect(() => {
    if (run?.status === 'FINALIZED' || run?.status === 'PAID') void loadBankExports(run.id);
  }, [run?.status, run?.id, loadBankExports]);

  const doFinalize = async () => {
    if (!run) return;
    setFinalizing(true);
    try {
      const override = run.oneThirdFailureEmployeeIds.length > 0;
      const updated = await finalizePayrollRun(run.id, override);
      setRun(updated);
      setFinalizeOpen(false);
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />, title: 'Run finalized',
        message: `${updated.payslipCount} payslip(s) locked in for ${MONTHS[updated.periodMonth - 1]} ${updated.periodYear}.`,
      });
    } catch (e) {
      notifications.show({
        color: 'red', title: 'Could not finalize',
        message: e instanceof ApiError ? e.message : 'Please try again.',
      });
    } finally {
      setFinalizing(false);
    }
  };

  const doDiscard = async () => {
    if (!run) return;
    setDiscarding(true);
    setDiscardError(null);
    try {
      await discardPayrollRun(run.id);
      notifications.show({ color: 'sand', title: 'Draft discarded', message: `${MONTHS[run.periodMonth - 1]} ${run.periodYear} run removed.` });
      window.location.href = '/payroll';
    } catch (e) {
      setDiscardError(e instanceof ApiError ? e.message : 'Could not discard this run.');
    } finally {
      setDiscarding(false);
    }
  };

  const doCreateCorrection = async () => {
    if (!run) return;
    setCreatingCorrection(true);
    setCorrectionError(null);
    try {
      const corrected = await createCorrection(run.id, {
        employeeIds: correctionIds, roundNetToShilling: correctionRound,
      });
      setNewCorrectionId(corrected.id);
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />, title: 'Correction run created',
        message: `${corrected.payslipCount} payslip(s) to review.`,
      });
    } catch (e) {
      setCorrectionError(e instanceof ApiError ? e.message : 'Could not create a correction run.');
    } finally {
      setCreatingCorrection(false);
    }
  };

  const doGeneratePdfs = async () => {
    if (!run) return;
    setGeneratingPdfs(true);
    try {
      const res = await generateMissingPdfs(run.id);
      await reload();
      notifications.show({
        color: res.failed > 0 ? 'amber' : 'brand',
        icon: res.failed > 0 ? <IconAlertTriangle size={16} /> : <IconCheck size={16} />,
        title: 'Payslip PDFs generated',
        message: `${res.ready}/${res.total} ready${res.failed ? `, ${res.failed} failed` : ''}.`,
      });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not generate PDFs', message: e instanceof ApiError ? e.message : 'Please try again.' });
    } finally {
      setGeneratingPdfs(false);
    }
  };

  const downloadPdf = async (p: Payslip) => {
    if (!run) return;
    setDownloadingPdfId(p.id);
    try {
      await downloadPayslipPdf(run.id, p.id);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not download payslip', message: e instanceof ApiError ? e.message : 'Please try again.' });
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const doGenerateExport = async () => {
    if (!run) return;
    setGeneratingExport(true);
    setExportError(null);
    try {
      const res = await generateBankExport(run.id, exportFormat, exportTemplate);
      await loadBankExports(run.id);
      notifications.show({
        color: res.warnings.length ? 'amber' : 'brand',
        icon: <IconCheck size={16} />,
        title: 'Bank export generated',
        message: `${res.included} payment(s), ${kes(res.totalAmount)}${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}.`,
      });
    } catch (e) {
      setExportError(e instanceof ApiError ? e.message : 'Could not generate the bank export.');
    } finally {
      setGeneratingExport(false);
    }
  };

  const downloadBatch = async (batch: BankExportBatch) => {
    if (!run) return;
    setDownloadingBatchId(batch.id);
    try {
      await downloadBankExport(run.id, batch.id);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Could not download export', message: e instanceof ApiError ? e.message : 'Please try again.' });
    } finally {
      setDownloadingBatchId(null);
    }
  };

  const empLabel = (empId: string): EmpInfo => empMap.get(empId) ?? { name: 'Unknown employee', number: empId.slice(0, 8) };

  const correctionOptions = useMemo(
    () => (run?.payslips ?? []).map((p) => {
      const info = empLabel(p.employeeId);
      return { value: p.employeeId, label: `${info.name} · ${info.number}` };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, empMap],
  );

  const back = (
    <Anchor component={Link} to="/payroll" size="sm" c="sand.6">
      <Group gap={4}><IconArrowLeft size={14} /> Back to payroll</Group>
    </Anchor>
  );

  if (loading) {
    return (
      <Stack gap="lg">
        {back}
        <Skeleton h={38} w={280} radius="sm" />
        <Card p="lg" radius="md"><Skeleton h={100} radius="sm" /></Card>
        <Card p="lg" radius="md"><Skeleton h={220} radius="sm" /></Card>
      </Stack>
    );
  }

  if (error || !run) {
    return (
      <Stack gap="lg">
        {back}
        <ErrorCard
          message={error ?? 'That payroll run does not exist, or is not part of this organisation.'}
          onRetry={() => setReloadKey((k) => k + 1)} retrying={loading}
        />
      </Stack>
    );
  }

  const hasFailures = run.oneThirdFailureEmployeeIds.length > 0;
  const pdfsOutstanding = run.pdfStatus.total - run.pdfStatus.ready;

  // "Total deductions" by identity (gross − net) rather than summing every
  // deduction column by name — correct even if a new deduction type is added
  // later without this page being updated. "Employer cost" is what totals.*
  // doesn't carry at all: gross plus the employer's OWN NSSF/AHL contributions
  // (nssfEmployer/ahlEmployer are per-payslip, not aggregated server-side).
  const totalDeductions = run.totals.gross - run.totals.net;
  const employerCost = run.totals.gross
    + run.payslips.reduce((s, p) => s + p.nssfEmployer + p.ahlEmployer, 0);

  // Loan installments this run reduced/withheld to protect the one-third floor.
  const throttledRepayments = run.payslips
    .flatMap((p) => p.loanRepayments.filter((r) => r.deferredAmount > 0).map((r) => ({ employeeId: p.employeeId, ...r })));
  const deferredDeductions = run.deferredDeductions ?? [];
  const hasThrottle = throttledRepayments.length > 0 || deferredDeductions.length > 0;
  const carriedForwardTotal = throttledRepayments.reduce((s, r) => s + r.deferredAmount, 0)
    + deferredDeductions.reduce((s, d) => s + d.amount, 0);

  return (
    <Stack gap="lg">
      {back}

      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <div>
          <Group gap="sm" align="center">
            <Title order={1}>{MONTHS[run.periodMonth - 1]} {run.periodYear}</Title>
            <Badge variant="light" color={STATUS_COLOR[run.status]}>{STATUS_LABEL[run.status]}</Badge>
            <Badge variant="light" color={TYPE_COLOR[run.runType]}>{TYPE_LABEL[run.runType]}</Badge>
          </Group>
          <Text c="sand.6" mt={4}>
            {run.payslipCount} payslip{run.payslipCount === 1 ? '' : 's'} · Run on {fmtDateTime(run.runDate)}
            {run.correctsRunId && (
              <> · <Anchor component={Link} to={`/payroll/${run.correctsRunId}`} size="sm">View original run</Anchor></>
            )}
          </Text>
        </div>

        <Group gap="sm">
          {run.status === 'DRAFT' && (
            <>
              {/* Finalize is the single primary action for a draft run — Discard
                  is destructive and secondary, so it stays quiet (subtle, not
                  filled) even though it's still one click away. */}
              <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => { setDiscardError(null); setDiscardOpen(true); }}>
                Discard
              </Button>
              <Button leftSection={<IconCheck size={16} />} onClick={() => setFinalizeOpen(true)}>
                Finalize
              </Button>
            </>
          )}
          {run.status === 'FINALIZED' && (
            <Button
              variant="light" leftSection={<IconRotateClockwise size={16} />}
              onClick={() => { setCorrectionError(null); setNewCorrectionId(null); setCorrectionIds([]); setCorrectionRound(false); setCorrectionOpen(true); }}
            >
              Create correction
            </Button>
          )}
        </Group>
      </Group>

      {skippedBanner.length > 0 && (
        <Alert
          color="amber" variant="light" icon={<IconAlertTriangle size={16} />}
          title={`${skippedBanner.length} employee(s) were skipped`}
          withCloseButton onClose={() => setSkippedBanner([])}
        >
          <List size="sm">
            {skippedBanner.map((s) => <List.Item key={s.employeeId}>{s.employeeNumber} — {s.reason}</List.Item>)}
          </List>
        </Alert>
      )}

      {hasFailures && run.status === 'DRAFT' && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="One-third rule breach">
          {run.oneThirdFailureEmployeeIds.length} payslip(s) have take-home pay below one-third of basic
          salary. You can still finalize, but you will be asked to confirm.
        </Alert>
      )}

      {hasThrottle && (
        <Alert color="amber" variant="light" icon={<IconWallet size={16} />} title="Deductions capped for the one-third rule">
          <Text size="sm" mb={deferredDeductions.length ? 'xs' : 0}>
            {throttledRepayments.length > 0 && (
              <>{throttledRepayments.length} loan installment(s) were reduced or withheld </>
            )}
            {throttledRepayments.length > 0 && deferredDeductions.length > 0 && 'and '}
            {deferredDeductions.length > 0 && (
              <>{deferredDeductions.length} one-off deduction(s) were deferred </>
            )}
            to keep take-home pay at or above one-third of basic salary —
            {' '}{kes(carriedForwardTotal)} carried forward. Hover a deductions figure for the per-line detail.
          </Text>
          {deferredDeductions.length > 0 && (
            <List size="sm">
              {deferredDeductions.map((d) => {
                const info = empLabel(d.employeeId);
                return (
                  <List.Item key={d.id}>
                    {info.name} · {info.number} — {kes(d.amount)}{d.reason ? ` (${d.reason})` : ''} deferred, still pending
                  </List.Item>
                );
              })}
            </List>
          )}
        </Alert>
      )}

      {/* The summary strip — five figures, in the order a reader actually asks
          them: how many people, how much did we pay out, how much was held
          back, what lands in pockets, what did this actually cost the
          business. The per-statutory-line breakdown (PAYE/NSSF/SHIF/AHL)
          lives in the table below now, not duplicated up here. */}
      <Grid gutter="md">
        <Grid.Col span={{ base: 6, sm: 4, lg: 2.4 }}><StatTile label="Headcount" value={String(run.payslipCount)} icon={IconUsers} color="sand" /></Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, lg: 2.4 }}><StatTile label="Gross" value={kes(run.totals.gross)} icon={IconCoin} color="brand" /></Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, lg: 2.4 }}><StatTile label="Total deductions" value={kes(totalDeductions)} icon={IconReceipt2} color="sand" /></Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, lg: 2.4 }}><StatTile label="Net" value={kes(run.totals.net)} icon={IconWallet} color="brand" /></Grid.Col>
        <Grid.Col span={{ base: 6, sm: 4, lg: 2.4 }}><StatTile label="Employer cost" value={kes(employerCost)} icon={IconBriefcase} color="sand" /></Grid.Col>
      </Grid>

      {run.status === 'FINALIZED' && (
        <Card p="lg" radius="md">
          <Group justify="space-between" align="center" wrap="wrap" gap="sm">
            <Group gap="xs">
              <ThemeIcon size={28} radius="md" variant="light" color="brand">
                <IconFileInvoice size={16} stroke={1.7} />
              </ThemeIcon>
              <div>
                <Title order={3}>Payslip PDFs</Title>
                <Text size="sm" c="sand.6">{run.pdfStatus.ready} of {run.pdfStatus.total} ready</Text>
              </div>
            </Group>
            {pdfsOutstanding > 0 && (
              <Button variant="light" leftSection={<IconRefresh size={16} />} loading={generatingPdfs} onClick={() => void doGeneratePdfs()}>
                Generate missing PDFs
              </Button>
            )}
          </Group>
        </Card>
      )}

      {(run.status === 'FINALIZED' || run.status === 'PAID') && (
        <Card p="lg" radius="md">
          <Group gap="xs" mb="md">
            <ThemeIcon size={28} radius="md" variant="light" color="brand">
              <IconBuildingBank size={16} stroke={1.7} />
            </ThemeIcon>
            <Title order={3}>Bank export</Title>
          </Group>

          <Group align="flex-end" gap="sm" wrap="wrap" mb="md">
            <Select
              label="Format" value={exportFormat} allowDeselect={false} w={140}
              data={[{ value: 'csv', label: 'CSV' }, { value: 'xlsx', label: 'XLSX' }, { value: 'both', label: 'Both' }]}
              onChange={(v) => setExportFormat((v as BankExportFormat) ?? 'csv')}
            />
            <Select
              label="Template" value={exportTemplate} allowDeselect={false} w={140}
              data={[{ value: 'generic', label: 'Generic' }, { value: 'eft', label: 'EFT' }]}
              onChange={(v) => setExportTemplate((v as BankExportTemplate) ?? 'generic')}
            />
            <Button loading={generatingExport} onClick={() => void doGenerateExport()}>Generate export</Button>
          </Group>

          {exportError && <Text size="sm" c="red" mb="sm">{exportError}</Text>}

          {bankLoading ? (
            <Skeleton h={60} radius="sm" />
          ) : bankExports.length === 0 ? (
            <Text size="sm" c="sand.6">No exports generated yet for this run.</Text>
          ) : (
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Format</Table.Th>
                  <Table.Th>Template</Table.Th>
                  <Table.Th>Rows</Table.Th>
                  <Table.Th>Generated</Table.Th>
                  <Table.Th w={40} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {bankExports.map((b) => (
                  <Table.Tr key={b.id}>
                    <Table.Td><Text size="sm">{b.format}</Text></Table.Td>
                    <Table.Td><Text size="sm">{b.template}</Text></Table.Td>
                    <Table.Td><Text size="sm">{b.rowCount}</Text></Table.Td>
                    <Table.Td><Text size="sm" c="sand.6">{fmtDateTime(b.generatedAt)}</Text></Table.Td>
                    <Table.Td>
                      <ActionIcon
                        variant="light" color="brand" loading={downloadingBatchId === b.id}
                        onClick={() => void downloadBatch(b)} aria-label="Download bank export"
                      >
                        <IconDownload size={15} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>
      )}

      <Card p="lg" radius="md">
        <Title order={3} mb="md">Payslips</Title>
        <Box visibleFrom="sm">
        <Table.ScrollContainer minWidth={960}>
          <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
            <Table.Thead>
              {/* Two-row header: a spanning group label distinguishes the four
                  statutory (mandatory, government-set) columns from the single
                  voluntary column (loan repayments + one-off deductions —
                  negotiated/elected, not statutory), so the eye can separate
                  "the law requires this" from "this person agreed to this"
                  without reading every column name. */}
              <Table.Tr>
                <Table.Th rowSpan={2}>Employee</Table.Th>
                <Table.Th rowSpan={2}>Gross</Table.Th>
                <Table.Th
                  colSpan={4} ta="center"
                  style={{ borderLeft: '1px solid var(--mantine-color-sand-2)', borderBottom: 'none' }}
                >
                  Statutory
                </Table.Th>
                <Table.Th rowSpan={2} style={{ borderLeft: '1px solid var(--mantine-color-sand-2)' }}>
                  Voluntary
                </Table.Th>
                <Table.Th rowSpan={2}>Net</Table.Th>
                {/* Fixed, non-wrapping widths: a short two-word header ("1/3
                    rule") would otherwise wrap onto two lines and shrink the
                    column below the badge it's meant to hold, truncating
                    "Pass"/"Fails" to "P…"/"F…". */}
                <Table.Th rowSpan={2} w={90} style={{ whiteSpace: 'nowrap' }}>1/3 rule</Table.Th>
                <Table.Th rowSpan={2} w={90} style={{ whiteSpace: 'nowrap' }}>PDF</Table.Th>
              </Table.Tr>
              <Table.Tr>
                <Table.Th style={{ borderLeft: '1px solid var(--mantine-color-sand-2)' }}>PAYE</Table.Th>
                <Table.Th>NSSF</Table.Th>
                <Table.Th>SHIF</Table.Th>
                <Table.Th>AHL</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {run.payslips.map((p) => {
                const info = empLabel(p.employeeId);
                const grossLines = [
                  ...p.adjustments.filter((a) => a.type === 'BONUS').map((a) => `+${kes(a.amount)} — ${a.reason ?? 'Bonus'}`),
                  ...p.overtime.map((o) => `+${kes(o.amount)} — Overtime ${o.hours}h (${o.category.replace('_', ' ').toLowerCase()}, ${o.date.slice(0, 10)})`),
                ];
                const deductionLines = [
                  ...p.loanRepayments.map((r) => {
                    if (r.amount === 0 && r.deferredAmount > 0) {
                      return `Loan/advance installment of ${kes(r.scheduledAmount)} withheld — carried forward (one-third floor)`;
                    }
                    if (r.deferredAmount > 0) {
                      return `-${kes(r.amount)} — Loan/advance repayment (reduced from ${kes(r.scheduledAmount)}; ${kes(r.deferredAmount)} carried forward — one-third floor)`;
                    }
                    return `-${kes(r.amount)} — Loan/advance repayment`;
                  }),
                  ...p.adjustments.filter((a) => a.type === 'DEDUCTION').map((a) => `-${kes(a.amount)} — ${a.reason ?? 'Deduction'}`),
                ];
                return (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>{info.name}</Text>
                      <Text size="xs" c="sand.6" ff="monospace">{info.number}</Text>
                    </Table.Td>
                    <Table.Td><BreakdownText value={kes(p.grossPay)} lines={grossLines} /></Table.Td>
                    <Table.Td><Text size="sm">{kes(p.paye)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{kes(p.nssfEmployee)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{kes(p.shif)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{kes(p.ahlEmployee)}</Text></Table.Td>
                    <Table.Td><BreakdownText value={kes(p.otherDeductions)} lines={deductionLines} /></Table.Td>
                    <Table.Td><Text size="sm" fw={700}>{kes(p.netPay)}</Text></Table.Td>
                    <Table.Td>
                      {p.oneThirdRulePass ? (
                        <Badge variant="light" size="sm" color="brand">Pass</Badge>
                      ) : (
                        <Tooltip label="Take-home pay is below one-third of basic salary" withArrow>
                          <Badge variant="light" size="sm" color="red" style={{ whiteSpace: 'nowrap' }}>Fails</Badge>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <PdfCell payslip={p} downloading={downloadingPdfId === p.id} onDownload={(ps) => void downloadPdf(ps)} />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        </Box>

        {/* Below sm: one card per payslip instead of a 10-column table forced into
            horizontal scroll at every width. */}
        <Stack hiddenFrom="sm" gap="sm">
          {run.payslips.map((p) => {
            const info = empLabel(p.employeeId);
            const deductionCount = p.loanRepayments.length + p.adjustments.filter((a) => a.type === 'DEDUCTION').length;
            return (
              <Card key={p.id} p="md" radius="md" withBorder>
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <div>
                    <Text size="sm" fw={600}>{info.name}</Text>
                    <Text size="xs" c="sand.6" ff="monospace">{info.number}</Text>
                  </div>
                  {p.oneThirdRulePass ? (
                    <Badge variant="light" size="sm" color="brand">Pass</Badge>
                  ) : (
                    <Badge variant="light" size="sm" color="red" style={{ whiteSpace: 'nowrap' }}>Fails 1/3 rule</Badge>
                  )}
                </Group>
                <Group gap="lg" mt="sm">
                  <div>
                    <Text size="xs" c="sand.6">Gross</Text>
                    <Text size="sm">{kes(p.grossPay)}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="sand.6">Deductions{deductionCount > 0 ? ` (${deductionCount})` : ''}</Text>
                    <Text size="sm">{kes(p.paye + p.nssfEmployee + p.shif + p.ahlEmployee + p.otherDeductions)}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="sand.6">Net</Text>
                    <Text size="sm" fw={700}>{kes(p.netPay)}</Text>
                  </div>
                </Group>
                <Group justify="flex-end" mt="sm">
                  <PdfCell payslip={p} downloading={downloadingPdfId === p.id} onDownload={(ps) => void downloadPdf(ps)} />
                </Group>
              </Card>
            );
          })}
        </Stack>
      </Card>

      {/* Finalize confirmation */}
      <Modal opened={finalizeOpen} onClose={() => setFinalizeOpen(false)} title="Finalize payroll run" centered>
        <Stack gap="md">
          {hasFailures ? (
            <>
              <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                {run.oneThirdFailureEmployeeIds.length} payslip(s) breach the one-third rule.
              </Alert>
              <List size="sm">
                {run.oneThirdFailureEmployeeIds.map((eid) => {
                  const info = empLabel(eid);
                  return <List.Item key={eid}>{info.name} · {info.number}</List.Item>;
                })}
              </List>
              <Text size="sm" c="sand.7">
                Finalizing locks every payslip in this run — it can no longer be edited or discarded,
                only corrected. Continue anyway?
              </Text>
            </>
          ) : (
            <Text size="sm" c="sand.7">
              Finalizing locks every payslip in this run — it can no longer be edited or discarded,
              only corrected. This cannot be undone.
            </Text>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="sand" onClick={() => setFinalizeOpen(false)}>Cancel</Button>
            <Button color={hasFailures ? 'red' : undefined} loading={finalizing} onClick={() => void doFinalize()}>
              {hasFailures ? 'Finalize anyway' : 'Finalize'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Discard confirmation */}
      <Modal opened={discardOpen} onClose={() => setDiscardOpen(false)} title="Discard draft run" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            This permanently deletes this draft run and its {run.payslipCount} payslip(s). This
            cannot be undone.
          </Text>
          {discardError && <Text size="sm" c="red">{discardError}</Text>}
          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="sand" onClick={() => setDiscardOpen(false)}>Cancel</Button>
            <Button color="red" loading={discarding} leftSection={<IconTrash size={16} />} onClick={() => void doDiscard()}>
              Discard
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Correction */}
      <Modal
        opened={correctionOpen} onClose={() => setCorrectionOpen(false)}
        title={newCorrectionId ? 'Correction run created' : 'Create correction run'} centered
      >
        {newCorrectionId ? (
          <Stack gap="md">
            <Group gap="xs">
              <ThemeIcon size={28} radius="md" variant="light" color="brand"><IconCheck size={16} /></ThemeIcon>
              <Text size="sm">The correction run is ready to review.</Text>
            </Group>
            <Group justify="flex-end" gap="sm">
              <Button variant="subtle" color="sand" onClick={() => setCorrectionOpen(false)}>Close</Button>
              <Button component={Link} to={`/payroll/${newCorrectionId}`}>View correction run</Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="md">
            <Text size="sm" c="sand.7">
              Recomputes payslips for the employees you choose, in a new linked run — the original
              finalized run is untouched.
            </Text>
            <MultiSelect
              label="Employees to correct" data={correctionOptions} searchable withAsterisk
              value={correctionIds} onChange={setCorrectionIds}
              placeholder="Choose one or more employees from this run"
            />
            <Switch
              label="Round net pay to the nearest shilling" checked={correctionRound}
              onChange={(e) => setCorrectionRound(e.currentTarget.checked)}
            />
            {correctionError && <Text size="sm" c="red">{correctionError}</Text>}
            <Group justify="flex-end" gap="sm">
              <Button variant="subtle" color="sand" onClick={() => setCorrectionOpen(false)}>Cancel</Button>
              <Button loading={creatingCorrection} disabled={correctionIds.length === 0} onClick={() => void doCreateCorrection()}>
                Create correction
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
