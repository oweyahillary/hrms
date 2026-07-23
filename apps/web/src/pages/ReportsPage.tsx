import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Anchor, Badge, Button, Card, Divider, Group, NumberInput, Select, Skeleton, Stack, Table,
  Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDownload, IconRefresh } from '@tabler/icons-react';
import {
  downloadPayrollSummaryPdf, downloadRemittancePdf, downloadP9Pdf,
  downloadLoanBookPdf, downloadSeveranceRegisterPdf,
  getSeveranceRegister, type SeveranceRegister,
} from '../api/reports';
import { loadEmployeeOptions, type EmployeeOption } from '../api/employee-options';
import { BUCKET_LABEL } from '../api/severance';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { kes } from '../utils/money';

const now = new Date();

function useDownloader() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Download failed',
        message: e instanceof ApiError ? e.message : 'Could not generate the report.',
      });
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function ReportCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card p="lg" radius="md" withBorder>
      <Text fw={600}>{title}</Text>
      <Text size="sm" c="sand.6" mt={2} mb="md">{description}</Text>
      {children}
    </Card>
  );
}

export function ReportsPage() {
  const { busy, run } = useDownloader();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const [summaryYear, setSummaryYear] = useState<number | string>(now.getFullYear());
  const [summaryMonth, setSummaryMonth] = useState<number | string>(now.getMonth() + 1);
  const [remitYear, setRemitYear] = useState<number | string>(now.getFullYear());
  const [remitMonth, setRemitMonth] = useState<number | string>(now.getMonth() + 1);
  const [p9Employee, setP9Employee] = useState<string | null>(null);
  const [p9Year, setP9Year] = useState<number | string>(now.getFullYear());

  const [sev, setSev] = useState<SeveranceRegister | null>(null);
  const [sevLoading, setSevLoading] = useState(false);
  const [sevError, setSevError] = useState<string | null>(null);

  useEffect(() => {
    void loadEmployeeOptions().then(setEmployees).catch(() => { /* P9 picker renders empty */ });
  }, []);

  const loadSeverance = async () => {
    setSevLoading(true); setSevError(null);
    try {
      setSev(await getSeveranceRegister());
    } catch (e) {
      setSevError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to view the severance register.'
        : 'Could not load the severance register.');
    } finally {
      setSevLoading(false);
    }
  };
  useEffect(() => { void loadSeverance(); }, []);

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Reports</Title>
        <Text c="sand.6" size="sm" mt={2}>Statutory, payroll and staff-cost reports. PDF exports open in your browser&apos;s downloads.</Text>
      </div>

      <ReportCard title="Payroll summary" description="Gross, deductions, employer cost and net for a finalized month.">
        <Group align="flex-end">
          <NumberInput label="Year" w={110} min={2000} max={2100} allowDecimal={false} value={summaryYear} onChange={setSummaryYear} />
          <NumberInput label="Month" w={90} min={1} max={12} allowDecimal={false} value={summaryMonth} onChange={setSummaryMonth} />
          <Button
            leftSection={<IconDownload size={16} />} loading={busy === 'summary'}
            onClick={() => void run('summary', () => downloadPayrollSummaryPdf(Number(summaryYear), Number(summaryMonth)))}
          >
            Download PDF
          </Button>
        </Group>
      </ReportCard>

      <ReportCard title="Statutory remittance" description="What to remit to KRA, NSSF and SHA for a period.">
        <Group align="flex-end">
          <NumberInput label="Year" w={110} min={2000} max={2100} allowDecimal={false} value={remitYear} onChange={setRemitYear} />
          <NumberInput label="Month" w={90} min={1} max={12} allowDecimal={false} value={remitMonth} onChange={setRemitMonth} />
          <Button
            leftSection={<IconDownload size={16} />} loading={busy === 'remit'}
            onClick={() => void run('remit', () => downloadRemittancePdf(Number(remitYear), Number(remitMonth)))}
          >
            Download PDF
          </Button>
        </Group>
      </ReportCard>

      <ReportCard title="P9 — employee tax card" description="An individual employee's annual PAYE deduction card.">
        <Group align="flex-end">
          <Select label="Employee" placeholder="Choose an employee" searchable w={300} data={employees} value={p9Employee} onChange={setP9Employee} />
          <NumberInput label="Year" w={110} min={2000} max={2100} allowDecimal={false} value={p9Year} onChange={setP9Year} />
          <Button
            leftSection={<IconDownload size={16} />} loading={busy === 'p9'} disabled={!p9Employee}
            onClick={() => p9Employee && void run('p9', () => downloadP9Pdf(p9Employee, Number(p9Year)))}
          >
            Download PDF
          </Button>
        </Group>
      </ReportCard>

      <ReportCard title="Loan book" description="Total outstanding staff-loan exposure and every loan/advance.">
        <Group>
          <Button
            variant="default" leftSection={<IconDownload size={16} />} loading={busy === 'loanbook'}
            onClick={() => void run('loanbook', () => downloadLoanBookPdf())}
          >
            Download PDF
          </Button>
          <Anchor component={RouterLink} to="/payroll/setup/loans" size="sm">View & filter the full list &rarr;</Anchor>
        </Group>
      </ReportCard>

      <ReportCard title="Trend & headcount" description="Year-to-date payroll trend and current staffing are on the Dashboard.">
        <Anchor component={RouterLink} to="/" size="sm">Open the Dashboard &rarr;</Anchor>
      </ReportCard>

      {/* Severance register — provisional PAYE must be visually unmissable here. */}
      <Card p="lg" radius="md" withBorder>
        <Group justify="space-between" align="flex-start" mb="xs">
          <div>
            <Text fw={600}>Severance register</Text>
            <Text size="sm" c="sand.6" mt={2}>Every severance calculation, with years of service, entitlement, notice pay and PAYE status.</Text>
          </div>
          <Group>
            <Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={() => void loadSeverance()} loading={sevLoading}>Refresh</Button>
            <Button
              variant="default" size="sm" leftSection={<IconDownload size={16} />} loading={busy === 'sev'}
              onClick={() => void run('sev', () => downloadSeveranceRegisterPdf())}
            >
              Download PDF
            </Button>
          </Group>
        </Group>

        {sevError && <ErrorCard message={sevError} onRetry={() => void loadSeverance()} retrying={sevLoading} />}

        {!sevError && sev && sev.totals.provisionalCount > 0 && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="Unverified PAYE figures" mb="sm">
            {sev.totals.provisionalCount} of {sev.totals.count} record(s) carry a <b>provisional, unverified</b> PAYE
            figure. Severance lump-sum tax treatment is not confirmed — do not rely on these PAYE amounts without KRA guidance.
          </Alert>
        )}

        {!sevError && <><Divider my="sm" />

        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Employee</Table.Th>
              <Table.Th visibleFrom="md">Exit date</Table.Th>
              <Table.Th visibleFrom="lg">Reason</Table.Th>
              <Table.Th ta="right" visibleFrom="lg">Years</Table.Th>
              <Table.Th ta="right" visibleFrom="sm">Severance</Table.Th>
              <Table.Th ta="right" visibleFrom="md">Notice pay</Table.Th>
              <Table.Th visibleFrom="md">Rule</Table.Th>
              <Table.Th>PAYE</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sevLoading && [0, 1, 2].map((i) => (
              <Table.Tr key={i}>{(['', 'md', 'lg', 'lg', 'sm', 'md', 'md', ''] as const).map((vf, j) => (<Table.Td key={j} visibleFrom={vf || undefined}><Skeleton height={14} /></Table.Td>))}</Table.Tr>
            ))}
            {!sevLoading && sev?.rows.length === 0 && (
              <Table.Tr><Table.Td colSpan={8}><Text ta="center" c="sand.6" py="lg">No severance calculations recorded yet.</Text></Table.Td></Table.Tr>
            )}
            {!sevLoading && sev?.rows.map((r) => (
              <Table.Tr key={r.id} style={r.provisional ? { background: 'var(--mantine-color-red-0)' } : undefined}>
                <Table.Td>
                  <Text fw={500}>{r.employeeName || '\u2014'}</Text>
                  <Text size="xs" c="sand.6">{r.employeeNumber}</Text>
                </Table.Td>
                <Table.Td visibleFrom="md">{r.exitDate}</Table.Td>
                <Table.Td visibleFrom="lg">{r.reason}</Table.Td>
                <Table.Td ta="right" visibleFrom="lg">{r.completedYears ?? '\u2014'}</Table.Td>
                <Table.Td ta="right" visibleFrom="sm">{kes(r.severanceAmount)}</Table.Td>
                <Table.Td ta="right" visibleFrom="md">{r.noticePayInLieu == null ? '\u2014' : kes(r.noticePayInLieu)}</Table.Td>
                <Table.Td visibleFrom="md"><Text size="sm">{BUCKET_LABEL[r.bucket ?? ''] ?? r.bucket ?? '\u2014'}</Text></Table.Td>
                <Table.Td>
                  {r.provisional
                    ? <Badge color="red" variant="filled">Provisional</Badge>
                    : <Text size="sm" c="sand.6">{r.payeStatus}</Text>}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table></>}
      </Card>
    </Stack>
  );
}
