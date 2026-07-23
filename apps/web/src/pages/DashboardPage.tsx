import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, Grid, Group, Skeleton, SimpleGrid, Stack, Text, Title, ThemeIcon,
} from '@mantine/core';
import {
  IconArrowUpRight, IconArrowDownRight, IconCoin, IconUsers, IconBeach, IconClockHour4,
  IconReceipt2, IconCalendarStats, IconUserCircle, IconArrowRight,
} from '@tabler/icons-react';
import { getYearTrend, getHeadcount, getLeaveInboxCount, type TrendMonth } from '../api/reports';
import { listPayrollRuns, type PayrollRunStatus } from '../api/payroll';
import { getMyPayslips, getMyLeave, type MyPayslip } from '../api/self-service';
import type { LeaveBalance } from '../api/leave';
import { ErrorCard } from '../components/ErrorCard';
import { kes } from '../utils/money';
import { useAuth } from '../auth/AuthContext';
import { canManageEmployees } from '../auth/roles';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const RUN_STATUS_COLOR: Record<PayrollRunStatus, string> = {
  DRAFT: 'amber', PROCESSING: 'amber', FINALIZED: 'brand', PAID: 'sand',
};
const RUN_STATUS_LABEL: Record<PayrollRunStatus, string> = {
  DRAFT: 'Draft', PROCESSING: 'Processing', FINALIZED: 'Finalized', PAID: 'Paid',
};

function Sparkline({ values, width = 320, height = 56 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * width;
    const y = height - (v / max) * (height - 6) - 3;
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} ${width},${height} 0,${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      <polygon points={area} fill="var(--mantine-color-brand-0)" />
      <polyline points={line} fill="none" stroke="var(--mantine-color-brand-6)" strokeWidth={2.5} />
    </svg>
  );
}

function StatCard({ label, value, icon: Icon, color, loading }: {
  label: string; value: string; icon: typeof IconUsers; color: string; loading: boolean;
}) {
  return (
    <Card p="md" radius="md" style={{ flex: 1 }}>
      <Group justify="space-between" align="center" h="100%" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon size={38} radius="md" variant="light" color={color}>
            <Icon size={19} stroke={1.7} />
          </ThemeIcon>
          <Text size="sm" c="sand.6" fw={500}>{label}</Text>
        </Group>
        {loading ? <Skeleton h={26} w={40} radius="sm" /> : <Text fz={24} fw={700}>{value}</Text>}
      </Group>
    </Card>
  );
}

function ShortcutCard({ to, icon: Icon, label }: { to: string; icon: typeof IconUsers; label: string }) {
  return (
    <Card component={Link} to={to} p="md" radius="md" style={{ cursor: 'pointer' }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon size={38} radius="md" variant="light" color="brand">
            <Icon size={19} stroke={1.7} />
          </ThemeIcon>
          <Text size="sm" fw={600}>{label}</Text>
        </Group>
        <IconArrowRight size={16} color="var(--mantine-color-sand-5)" />
      </Group>
    </Card>
  );
}

interface HrData {
  shownMonth: number; shownYear: number; netPay: number; pctChange: number | null;
  series: number[]; active: number; onLeave: number; pending: number;
  latestRun: { id: string; status: PayrollRunStatus } | null;
}

export function DashboardPage() {
  const { user } = useAuth();
  const isHr = canManageEmployees(user?.role);

  const [hrData, setHrData] = useState<HrData | null>(null);
  const [myPayslips, setMyPayslips] = useState<MyPayslip[] | null>(null);
  const [myBalances, setMyBalances] = useState<LeaveBalance[] | null>(null);
  const [myPendingCount, setMyPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadHr = useCallback(async () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const [trend, hc, pending, runs] = await Promise.all([
      getYearTrend(year), getHeadcount(), getLeaveInboxCount(), listPayrollRuns(),
    ]);

    const upToNow = trend.months.filter((m) => m.month <= month);
    const withData = upToNow.filter((m) => m.grossPay > 0);
    const shown: TrendMonth | undefined = withData[withData.length - 1] ?? upToNow[upToNow.length - 1];
    const prev = withData.length >= 2 ? withData[withData.length - 2] : undefined;
    const pctChange = shown && prev && prev.grossPay > 0
      ? ((shown.grossPay - prev.grossPay) / prev.grossPay) * 100
      : null;

    // The run backing the "shown" month — REGULAR first, so a later correction
    // run for the same period doesn't silently replace the headline figure.
    const periodRuns = runs
      .filter((r) => r.periodMonth === shown?.month && r.periodYear === year)
      .sort((a, b) => (a.runType === 'REGULAR' ? -1 : 1) - (b.runType === 'REGULAR' ? -1 : 1));

    setHrData({
      shownMonth: shown?.month ?? month,
      shownYear: year,
      netPay: shown?.netPay ?? 0,
      pctChange,
      series: upToNow.map((m) => m.netPay),
      active: hc.active,
      onLeave: hc.byStatus.ON_LEAVE ?? 0,
      pending,
      latestRun: periodRuns[0] ? { id: periodRuns[0].id, status: periodRuns[0].status } : null,
    });
  }, []);

  const loadEmployee = useCallback(async () => {
    const [payslips, leave] = await Promise.all([getMyPayslips(), getMyLeave()]);
    setMyPayslips(payslips);
    setMyBalances(leave.balances);
    setMyPendingCount(leave.requests.filter((r) => r.status === 'PENDING').length);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (isHr) await loadHr(); else await loadEmployee();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [isHr, loadHr, loadEmployee]);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <Stack gap="lg">
        <div>
          <Title order={1}>Dashboard</Title>
          <Text c="sand.6" mt={4}>Your workspace at a glance</Text>
        </div>
        <ErrorCard message="Your dashboard could not load. Check your connection and try again." onRetry={() => void load()} retrying={loading} />
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>Dashboard</Title>
        <Text c="sand.6" mt={4}>Your workspace at a glance</Text>
      </div>

      {isHr ? (
        <>
          <Grid gutter="md">
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Card p="lg" radius="md" h="100%">
                <Group justify="space-between" align="flex-start" mb={4}>
                  <Group gap="sm" align="center">
                    <ThemeIcon size={38} radius="md" variant="light" color="brand">
                      <IconCoin size={20} stroke={1.7} />
                    </ThemeIcon>
                    <div>
                      <Text size="sm" c="sand.6" fw={500}>Latest payroll — net</Text>
                      <Text size="xs" c="sand.5">
                        {hrData ? `${MONTHS[hrData.shownMonth - 1]} ${hrData.shownYear}` : '—'}
                      </Text>
                    </div>
                  </Group>
                  <Group gap="xs">
                    {!loading && hrData?.pctChange != null && (
                      <Badge
                        variant="light" size="sm"
                        color={hrData.pctChange >= 0 ? 'brand' : 'red'}
                        leftSection={hrData.pctChange >= 0 ? <IconArrowUpRight size={12} /> : <IconArrowDownRight size={12} />}
                      >
                        {Math.abs(hrData.pctChange).toFixed(1)}% vs last
                      </Badge>
                    )}
                    {!loading && hrData?.latestRun && (
                      <Badge variant="light" size="sm" color={RUN_STATUS_COLOR[hrData.latestRun.status]}>
                        {RUN_STATUS_LABEL[hrData.latestRun.status]}
                      </Badge>
                    )}
                  </Group>
                </Group>

                {loading
                  ? <Skeleton h={38} w={220} my="xs" radius="sm" />
                  : <Text fz={34} fw={700} mt="md" mb="md">{kes(hrData?.netPay ?? 0)}</Text>}

                {loading
                  ? <Skeleton h={56} radius="sm" />
                  : <Sparkline values={hrData && hrData.series.length ? hrData.series : [0, 0]} />}

                {!loading && hrData?.latestRun && (
                  <Group justify="flex-end" mt="sm">
                    <Button component={Link} to={`/payroll/${hrData.latestRun.id}`} variant="subtle" size="compact-sm" rightSection={<IconArrowRight size={14} />}>
                      View this run
                    </Button>
                  </Group>
                )}
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack gap="md" h="100%">
                <StatCard label="Headcount" value={hrData ? String(hrData.active) : '—'} icon={IconUsers} color="brand" loading={loading} />
                <StatCard label="On leave" value={hrData ? String(hrData.onLeave) : '—'} icon={IconBeach} color="amber" loading={loading} />
                <StatCard label="Pending approvals" value={hrData ? String(hrData.pending) : '—'} icon={IconClockHour4} color="amber" loading={loading} />
              </Stack>
            </Grid.Col>
          </Grid>
        </>
      ) : (
        <>
          <Grid gutter="md">
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Card p="lg" radius="md" h="100%">
                <Group gap="sm" align="center" mb={4}>
                  <ThemeIcon size={38} radius="md" variant="light" color="brand">
                    <IconReceipt2 size={20} stroke={1.7} />
                  </ThemeIcon>
                  <div>
                    <Text size="sm" c="sand.6" fw={500}>My latest payslip</Text>
                    <Text size="xs" c="sand.5">
                      {myPayslips?.[0]?.periodMonth && myPayslips[0].periodYear
                        ? `${MONTHS[myPayslips[0].periodMonth - 1]} ${myPayslips[0].periodYear}`
                        : '—'}
                    </Text>
                  </div>
                </Group>

                {loading
                  ? <Skeleton h={38} w={220} my="xs" radius="sm" />
                  : (
                    <Text fz={34} fw={700} mt="md" mb="md">
                      {myPayslips?.[0] ? kes(myPayslips[0].netPay) : 'No payslips yet'}
                    </Text>
                  )}

                <Button component={Link} to="/me/payslips" variant="subtle" size="compact-sm" rightSection={<IconArrowRight size={14} />}>
                  View all my payslips
                </Button>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack gap="md" h="100%">
                <StatCard
                  label="Leave available"
                  value={myBalances ? String(myBalances.reduce((s, b) => s + b.availableDays, 0)) : '—'}
                  icon={IconBeach} color="brand" loading={loading}
                />
                <StatCard label="My pending requests" value={String(myPendingCount)} icon={IconClockHour4} color="amber" loading={loading} />
              </Stack>
            </Grid.Col>
          </Grid>

          <div>
            <Text size="sm" fw={600} c="sand.7" mb="xs">Your shortcuts</Text>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
              <ShortcutCard to="/me/payslips" icon={IconReceipt2} label="My payslips" />
              <ShortcutCard to="/me/leave" icon={IconCalendarStats} label="My leave" />
              <ShortcutCard to="/me/profile" icon={IconUserCircle} label="My profile" />
            </SimpleGrid>
          </div>
        </>
      )}
    </Stack>
  );
}
