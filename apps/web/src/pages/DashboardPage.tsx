import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Card, Grid, Group, Skeleton, Stack, Text, Title, ThemeIcon,
} from '@mantine/core';
import {
  IconArrowUpRight, IconArrowDownRight, IconCoin, IconUsers, IconBeach, IconClockHour4,
  IconSparkles,
} from '@tabler/icons-react';
import { getYearTrend, getHeadcount, getLeaveInboxCount, type TrendMonth } from '../api/reports';
import { ErrorCard } from '../components/ErrorCard';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtKES(n: number): string {
  return `KES ${Math.round(n).toLocaleString('en-KE')}`;
}

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

interface Data {
  shownMonth: number; shownYear: number; grossPay: number; pctChange: number | null;
  series: number[]; active: number; onLeave: number; pending: number;
}

export function DashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    try {
      const [trend, hc, pending] = await Promise.all([
        getYearTrend(year), getHeadcount(), getLeaveInboxCount(),
      ]);

      const upToNow = trend.months.filter((m) => m.month <= month);
      const withData = upToNow.filter((m) => m.grossPay > 0);
      const shown: TrendMonth | undefined = withData[withData.length - 1] ?? upToNow[upToNow.length - 1];
      const prev = withData.length >= 2 ? withData[withData.length - 2] : undefined;
      const pctChange = shown && prev && prev.grossPay > 0
        ? ((shown.grossPay - prev.grossPay) / prev.grossPay) * 100
        : null;

      setData({
        shownMonth: shown?.month ?? month,
        shownYear: year,
        grossPay: shown?.grossPay ?? 0,
        pctChange,
        series: upToNow.map((m) => m.grossPay),
        active: hc.active ?? hc.byStatus?.ACTIVE ?? 0,
        onLeave: hc.byStatus?.ON_LEAVE ?? 0,
        pending,
      });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stats = [
    { label: 'Headcount', value: data ? String(data.active) : '—', icon: IconUsers, color: 'brand' },
    { label: 'On leave', value: data ? String(data.onLeave) : '—', icon: IconBeach, color: 'amber' },
    { label: 'Pending approvals', value: data ? String(data.pending) : '—', icon: IconClockHour4, color: 'amber' },
  ];

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>Dashboard</Title>
        <Text c="sand.6" mt={4}>Your workspace at a glance</Text>
      </div>

      {error ? (
        <ErrorCard message="Your dashboard metrics could not load. Check your connection and try again." onRetry={() => void load()} retrying={loading} />
      ) : (
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
                  <Text size="sm" c="sand.6" fw={500}>Payroll</Text>
                  <Text size="xs" c="sand.5">
                    {data ? `${MONTHS[data.shownMonth - 1]} ${data.shownYear}` : '—'}
                  </Text>
                </div>
              </Group>
              {!loading && data?.pctChange != null && (
                <Badge
                  variant="light" size="sm"
                  color={data.pctChange >= 0 ? 'brand' : 'red'}
                  leftSection={data.pctChange >= 0 ? <IconArrowUpRight size={12} /> : <IconArrowDownRight size={12} />}
                >
                  {Math.abs(data.pctChange).toFixed(1)}% vs last
                </Badge>
              )}
            </Group>

            {loading
              ? <Skeleton h={38} w={220} my="xs" radius="sm" />
              : <Text fz={34} fw={700} mt="md" mb="md">{fmtKES(data?.grossPay ?? 0)}</Text>}

            {loading
              ? <Skeleton h={56} radius="sm" />
              : <Sparkline values={data && data.series.length ? data.series : [0, 0]} />}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="md" h="100%">
            {stats.map((s) => (
              <Card key={s.label} p="md" radius="md" style={{ flex: 1 }}>
                <Group justify="space-between" align="center" h="100%" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon size={38} radius="md" variant="light" color={s.color}>
                      <s.icon size={19} stroke={1.7} />
                    </ThemeIcon>
                    <Text size="sm" c="sand.6" fw={500}>{s.label}</Text>
                  </Group>
                  {loading
                    ? <Skeleton h={26} w={40} radius="sm" />
                    : <Text fz={24} fw={700}>{s.value}</Text>}
                </Group>
              </Card>
            ))}
          </Stack>
        </Grid.Col>
      </Grid>

      <Card p="xl" radius="md">
        <Group gap="md" align="flex-start" wrap="nowrap">
          <ThemeIcon size={42} radius="md" variant="light" color="brand" style={{ flexShrink: 0 }}>
            <IconSparkles size={22} stroke={1.7} />
          </ThemeIcon>
          <Box>
            <Title order={3}>Welcome</Title>
            <Text c="sand.6" mt={6} maw={620}>
              These figures come from your finalized payroll and staffing records. Quick actions
              and deeper reports will land here as we build out each section.
            </Text>
          </Box>
        </Group>
      </Card>
      </>
      )}
    </Stack>
  );
}
