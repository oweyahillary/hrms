import { useEffect, useState } from 'react';
import {
  Badge, Card, Grid, Group, Skeleton, Stack, Text, Title,
} from '@mantine/core';
import { IconArrowUpRight, IconArrowDownRight } from '@tabler/icons-react';
import { getYearTrend, getHeadcount, getLeaveInboxCount, type TrendMonth } from '../api/reports';

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

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    async function load() {
      try {
        const [trend, hc, pending] = await Promise.all([
          getYearTrend(year), getHeadcount(), getLeaveInboxCount(),
        ]);
        if (cancelled) return;

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
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const stats = [
    { label: 'Headcount', value: data ? String(data.active) : '—' },
    { label: 'On leave', value: data ? String(data.onLeave) : '—' },
    { label: 'Pending approvals', value: data ? String(data.pending) : '—' },
  ];

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>Dashboard</Title>
        <Text c="sand.6" mt={4}>Your workspace at a glance</Text>
      </div>

      {error && (
        <Card p="md" radius="md">
          <Text c="sand.6" size="sm">Some metrics could not load. They need finalized payroll and HR access.</Text>
        </Card>
      )}

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card p="lg" radius="md" h="100%">
            <Group justify="space-between" align="baseline" mb={2}>
              <Text size="sm" c="sand.6">
                Payroll — {data ? `${MONTHS[data.shownMonth - 1]} ${data.shownYear}` : '—'}
              </Text>
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
              : <Text fz={34} fw={700} mt={4} mb="md">{fmtKES(data?.grossPay ?? 0)}</Text>}

            {loading
              ? <Skeleton h={56} radius="sm" />
              : <Sparkline values={data && data.series.length ? data.series : [0, 0]} />}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="md" h="100%">
            {stats.map((s) => (
              <Card key={s.label} p="md" radius="md" style={{ flex: 1 }}>
                <Group justify="space-between" align="center" h="100%">
                  <Text size="sm" c="sand.6">{s.label}</Text>
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
        <Title order={3}>Welcome</Title>
        <Text c="sand.6" mt="xs" maw={620}>
          These figures come from your finalized payroll and staffing records. Quick actions
          and deeper reports will land here as we build out each section.
        </Text>
      </Card>
    </Stack>
  );
}
