import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Button, Card, Group, Skeleton, SimpleGrid, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { getMyAttendance } from '../api/self-service';
import { ATTENDANCE_STATUSES, type AttendanceRecord, type AttendanceStatus } from '../api/attendance';
import { ErrorCard } from '../components/ErrorCard';
import { shiftColor } from '../utils/shift-color';

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', ON_LEAVE: 'On leave',
};
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  PRESENT: 'brand', ABSENT: 'red', LATE: 'amber', ON_LEAVE: 'sand',
};
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
function addMonths(monthStr: string, n: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthRange(monthStr: string): { from: string; to: string; days: number } {
  const [y, m] = monthStr.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${monthStr}-01`, to: `${monthStr}-${String(lastDay).padStart(2, '0')}`, days: lastDay };
}
/** Monday-first weekday index (0=Mon..6=Sun) for the 1st of the month, so the grid aligns like the HR shift roster. */
function leadingBlankCount(monthStr: string): number {
  const [y, m] = monthStr.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function MyAttendancePage() {
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    setRecords(null);
    try {
      const { from, to } = monthRange(month);
      setRecords(await getMyAttendance(from, to));
    } catch {
      setError('Your attendance could not load. Check your connection and try again.');
    }
  }, [month]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const counts = (records ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const byDate = new Map((records ?? []).map((r) => [r.date.slice(0, 10), r]));
  const { days } = monthRange(month);
  const blanks = leadingBlankCount(month);
  const [y, m] = month.split('-').map(Number);

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>My attendance</Title>
        <Text c="sand.6" mt={4}>Your shift and status for each day this month, at a glance.</Text>
      </div>

      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Button variant="default" size="sm" onClick={() => setMonth(addMonths(month, -1))} leftSection={<IconChevronLeft size={15} />}>
            Prev
          </Button>
          <TextInput type="month" value={month} onChange={(e) => setMonth(e.currentTarget.value || currentMonth())} w={160} />
          <Button variant="default" size="sm" onClick={() => setMonth(addMonths(month, 1))} rightSection={<IconChevronRight size={15} />}>
            Next
          </Button>
        </Group>
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={records === null} />}

      {!error && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            {ATTENDANCE_STATUSES.map((s) => (
              <Card key={s} p="md" radius="md">
                <Text size="xs" c="sand.6" tt="uppercase" fw={600} style={{ letterSpacing: '0.04em' }}>{STATUS_LABEL[s]}</Text>
                {records === null
                  ? <Skeleton h={26} w={40} radius="sm" mt={6} />
                  : <Text fz={24} fw={700} mt={2}>{counts[s] ?? 0}</Text>}
              </Card>
            ))}
          </SimpleGrid>

          <Card p="lg" radius="md">
            <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {DAY_LABELS.map((d) => (
                <Text key={d} size="xs" c="sand.6" fw={600} ta="center">{d}</Text>
              ))}
              {records === null
                ? Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} h={64} radius="sm" />)
                : (
                  <>
                    {Array.from({ length: blanks }).map((_, i) => <Box key={`b${i}`} />)}
                    {Array.from({ length: days }).map((_, i) => {
                      const dayNum = i + 1;
                      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                      const r = byDate.get(dateStr);
                      return (
                        <Card key={dateStr} withBorder p={6} radius="sm" mih={64}>
                          <Text size="xs" c="sand.6">{dayNum}</Text>
                          {r && (
                            <Stack gap={2} mt={2}>
                              <Badge variant="light" size="xs" color={STATUS_COLOR[r.status]} fullWidth>
                                {STATUS_LABEL[r.status]}
                              </Badge>
                              {r.shiftCode && (
                                <Badge variant="outline" size="xs" color={shiftColor(r.shiftCode)} fullWidth>
                                  {r.shiftCode}
                                </Badge>
                              )}
                            </Stack>
                          )}
                        </Card>
                      );
                    })}
                  </>
                )}
            </Box>
          </Card>
        </>
      )}
    </Stack>
  );
}
