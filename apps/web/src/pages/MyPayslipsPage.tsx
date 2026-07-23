import { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Button, Card, Center, Group, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDownload, IconReceiptOff } from '@tabler/icons-react';
import { getMyPayslips, downloadMyPayslipPdf, type MyPayslip } from '../api/self-service';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { kes } from '../utils/money';

function periodLabel(month: number | null, year: number | null): string {
  if (!month || !year) return '—';
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export function MyPayslipsPage() {
  const [rows, setRows] = useState<MyPayslip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await getMyPayslips());
    } catch {
      setRows([]);
      setError('Could not load your payslips. Please try again.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const download = async (id: string) => {
    setDownloadingId(id);
    try {
      await downloadMyPayslipPdf(id);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Download failed',
        message: e instanceof ApiError ? e.message : 'Could not download this payslip.',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>My payslips</Title>
        <Text c="sand.6" mt={4}>Every finalized payslip issued to you, most recent first</Text>
      </div>

      <Card p="lg" radius="md">
        {error && <ErrorCard message={error} onRetry={() => void load()} retrying={rows === null} />}

        {!error && <>
        <Box visibleFrom="sm">
          <Table.ScrollContainer minWidth={520}>
            <Table verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Period</Table.Th>
                  <Table.Th ta="right">Gross</Table.Th>
                  <Table.Th ta="right">Net</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows === null && Array.from({ length: 3 }, (_, i) => (
                  <Table.Tr key={`s${i}`}>
                    <Table.Td colSpan={4}><Skeleton h={14} radius="sm" /></Table.Td>
                  </Table.Tr>
                ))}
                {rows?.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>{periodLabel(p.periodMonth, p.periodYear)}</Text>
                      {p.runType === 'ADJUSTMENT' && (
                        <Badge variant="light" size="xs" color="amber" mt={2}>Correction</Badge>
                      )}
                    </Table.Td>
                    <Table.Td ta="right"><Text size="sm">{kes(p.grossPay)}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="sm" fw={600}>{kes(p.netPay)}</Text></Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-sm" variant="light" leftSection={<IconDownload size={14} />}
                        loading={downloadingId === p.id} disabled={p.pdfStatus !== 'READY'}
                        onClick={() => void download(p.id)}
                      >
                        PDF
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Box>

        {/* Below sm: one card per payslip instead of a horizontally-scrolling table. */}
        <Stack hiddenFrom="sm" gap="sm">
          {rows === null && Array.from({ length: 3 }, (_, i) => (
            <Card key={`ms${i}`} p="md" radius="md"><Skeleton h={14} w="50%" radius="sm" /></Card>
          ))}
          {rows?.map((p) => (
            <Card key={p.id} p="md" radius="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="sm" fw={600}>{periodLabel(p.periodMonth, p.periodYear)}</Text>
                  {p.runType === 'ADJUSTMENT' && (
                    <Badge variant="light" size="xs" color="amber" mt={2}>Correction</Badge>
                  )}
                  <Text size="xs" c="sand.6" mt={4}>Gross {kes(p.grossPay)} · Net {kes(p.netPay)}</Text>
                </div>
                <Button
                  size="compact-sm" variant="light" leftSection={<IconDownload size={14} />}
                  loading={downloadingId === p.id} disabled={p.pdfStatus !== 'READY'}
                  onClick={() => void download(p.id)}
                >
                  PDF
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>

        {rows?.length === 0 && (
          <Center py={48}>
            <Stack gap={6} align="center">
              <IconReceiptOff size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />
              <Text fw={600} mt={4}>No payslips yet</Text>
              <Text size="sm" c="sand.6" maw={380} ta="center">
                Payslips appear here once a payroll run that includes you has been finalized.
              </Text>
            </Stack>
          </Center>
        )}</>}
      </Card>
    </Stack>
  );
}
