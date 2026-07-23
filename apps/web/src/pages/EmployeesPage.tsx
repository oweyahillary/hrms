import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon, Anchor, Avatar, Badge, Box, Button, Card, Center, Group, Pagination, Select, Skeleton,
  Stack, Table, Text, TextInput, Title, UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  IconArrowsSort, IconChevronUp, IconChevronDown, IconPlus, IconSearch, IconUsersGroup, IconX,
} from '@tabler/icons-react';
import {
  listEmployees, EMPLOYMENT_STATUSES,
  type EmployeeListRow, type EmployeeSort, type SortOrder,
} from '../api/employees';
import {
  getDepartments, getJobTitles, departmentMap, departmentOptions, jobTitleMap, type Option,
} from '../api/lookups';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { canManageEmployees } from '../auth/roles';
import { ErrorCard } from '../components/ErrorCard';
import { formatDate as fmtDate } from '../utils/date';

const PAGE_SIZE = 25;

/** Status colours borrow the theme's own ramp — no new palette. */
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'brand',
  ON_LEAVE: 'amber',
  SUSPENDED: 'red',
  EXITED: 'sand',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On leave',
  SUSPENDED: 'Suspended',
  EXITED: 'Exited',
};

const STATUS_OPTIONS: Option[] = EMPLOYMENT_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABEL[s] ?? s,
}));


function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}

function isSort(v: string | null): v is EmployeeSort {
  return v === 'name' || v === 'employeeNumber' || v === 'hireDate' || v === 'createdAt';
}

/** A column header that toggles sort direction, with the active key marked. */
function SortHeader({
  label, active, order, onSort,
}: {
  label: string; active: boolean; order: SortOrder; onSort: () => void;
}) {
  const Icon = !active ? IconArrowsSort : order === 'asc' ? IconChevronUp : IconChevronDown;
  return (
    <UnstyledButton
      onClick={onSort}
      aria-label={`Sort by ${label}`}
      style={{ width: '100%' }}
    >
      <Group gap={6} wrap="nowrap">
        <Text size="sm" fw={600} c={active ? 'brand.8' : undefined}>{label}</Text>
        <Icon size={14} stroke={2} opacity={active ? 1 : 0.4} />
      </Group>
    </UnstyledButton>
  );
}

export function EmployeesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const canAdd = canManageEmployees(user?.role);

  // Hand the current list URL (filters, sort, page) to the detail screen so its
  // "Back to employees" returns to this exact view rather than a bare list.
  const listUrl = `/employees${location.search}`;

  // The URL is the source of truth for the query, so a filtered list can be
  // shared, bookmarked, and survives back/forward.
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const status = params.get('status') ?? '';
  const departmentId = params.get('departmentId') ?? '';
  const sortParam = params.get('sort');
  const sort: EmployeeSort = isSort(sortParam) ? sortParam : 'name';
  const order: SortOrder = params.get('order') === 'desc' ? 'desc' : 'asc';
  const urlQ = params.get('q') ?? '';

  // Search is typed locally and debounced before it reaches the URL/API.
  const [search, setSearch] = useState(urlQ);
  const [debouncedSearch] = useDebouncedValue(search, 300);

  const [rows, setRows] = useState<EmployeeListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [departments, setDepartments] = useState<Option[]>([]);
  const [deptNames, setDeptNames] = useState<Map<string, string>>(new Map());
  const [titleNames, setTitleNames] = useState<Map<string, string>>(new Map());

  /** Merge into the URL, resetting to page 1 whenever the result set changes. */
  const patchParams = useCallback((patch: Record<string, string>, resetPage = true) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (resetPage) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  // Push the debounced search term into the URL once typing settles.
  useEffect(() => {
    if (debouncedSearch === urlQ) return;
    patchParams({ q: debouncedSearch });
  }, [debouncedSearch, urlQ, patchParams]);

  // Reference data — fetched once. A failure here isn't fatal: the list still
  // renders, it just shows IDs-less placeholders instead of names.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [depts, titles] = await Promise.all([getDepartments(), getJobTitles()]);
        if (cancelled) return;
        setDepartments(departmentOptions(depts));
        setDeptNames(departmentMap(depts));
        setTitleNames(jobTitleMap(titles));
      } catch {
        // Non-fatal — leave the maps empty.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Every fetch gets a sequence number; only the newest may write to state.
  // Debounced typing still races (a slow early request can land after a fast
  // later one), and a cancelled-flag alone doesn't prevent that.
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    void (async () => {
      try {
        const res = await listEmployees({
          page, pageSize: PAGE_SIZE, q: urlQ || undefined,
          status: status || undefined,
          departmentId: departmentId || undefined,
          sort, order,
        });
        if (id !== reqId.current) return;
        setRows(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setError(null);
      } catch (e) {
        if (id !== reqId.current) return;
        setRows([]);
        setTotal(0);
        setError(
          e instanceof ApiError && e.status === 403
            ? 'Your role cannot view employee records. Ask an administrator for access.'
            : 'The employee list could not load. Check your connection and try again.',
        );
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    })();
  }, [page, urlQ, status, departmentId, sort, order, reloadKey]);

  const toggleSort = useCallback((key: EmployeeSort) => {
    const nextOrder: SortOrder = sort === key && order === 'asc' ? 'desc' : 'asc';
    patchParams({ sort: key, order: nextOrder });
  }, [sort, order, patchParams]);

  const filtered = Boolean(urlQ || status || departmentId);

  const clearFilters = useCallback(() => {
    setSearch('');
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const k of ['q', 'status', 'departmentId', 'page']) next.delete(k);
      return next;
    }, { replace: true });
  }, [setParams]);

  const countLabel = useMemo(() => {
    if (loading) return 'Loading…';
    if (total === 0) return 'No people';
    const noun = total === 1 ? 'person' : 'people';
    return filtered ? `${total} ${noun} found` : `${total} ${noun}`;
  }, [loading, total, filtered]);

  const body = () => {
    if (loading) {
      // Mirrors the real row's columns and breakpoints exactly — otherwise the
      // skeleton misaligns with the headers while loading.
      return Array.from({ length: 6 }, (_, i) => (
        <Table.Tr key={`s${i}`}>
          <Table.Td><Skeleton h={14} radius="sm" /></Table.Td>
          <Table.Td><Skeleton h={14} radius="sm" /></Table.Td>
          <Table.Td visibleFrom="md"><Skeleton h={14} radius="sm" /></Table.Td>
          <Table.Td visibleFrom="lg"><Skeleton h={14} radius="sm" /></Table.Td>
          <Table.Td visibleFrom="sm"><Skeleton h={14} radius="sm" /></Table.Td>
          <Table.Td><Skeleton h={14} w={64} radius="sm" /></Table.Td>
        </Table.Tr>
      ));
    }
    return rows.map((r) => (
      <Table.Tr
        key={r.id}
        onClick={() => navigate(`/employees/${r.id}`, { state: { from: listUrl } })}
        style={{ cursor: 'pointer' }}
      >
        <Table.Td>
          <Group gap="sm" wrap="nowrap">
            <Avatar radius="xl" size={32} color="brand" variant="light">
              {initialsOf(r.fullName)}
            </Avatar>
            <div>
              <Anchor
                component={Link}
                to={`/employees/${r.id}`}
                state={{ from: listUrl }}
                size="sm"
                fw={600}
                c="inherit"
                underline="never"
                onClick={(e) => e.stopPropagation()}
              >
                {r.fullName}
              </Anchor>
              {r.email && <Text size="xs" c="sand.6">{r.email}</Text>}
            </div>
          </Group>
        </Table.Td>
        <Table.Td>
          <Text size="sm" c="sand.7" ff="monospace">{r.employeeNumber}</Text>
        </Table.Td>
        <Table.Td visibleFrom="md">
          <Text size="sm">{(r.departmentId && deptNames.get(r.departmentId)) || 'Unassigned'}</Text>
        </Table.Td>
        <Table.Td visibleFrom="lg">
          <Text size="sm">{(r.jobTitleId && titleNames.get(r.jobTitleId)) || '—'}</Text>
        </Table.Td>
        <Table.Td visibleFrom="sm">
          <Text size="sm">{fmtDate(r.hireDate)}</Text>
        </Table.Td>
        <Table.Td>
          <Badge variant="light" size="sm" color={STATUS_COLOR[r.employmentStatus] ?? 'sand'}>
            {STATUS_LABEL[r.employmentStatus] ?? r.employmentStatus}
          </Badge>
        </Table.Td>
      </Table.Tr>
    ));
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Title order={1}>Employees</Title>
          <Text c="sand.6" mt={4}>Everyone on the payroll, past and present</Text>
        </div>
        {canAdd && (
          <Button component={Link} to="/employees/new" leftSection={<IconPlus size={16} />}>
            Add employee
          </Button>
        )}
      </Group>

      <Card p="lg" radius="md">
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="md" mb="md">
          <Group gap="sm" wrap="wrap">
            <TextInput
              placeholder="Search name or employee no."
              leftSection={<IconSearch size={15} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              w={260}
              aria-label="Search employees"
              rightSection={
                search ? (
                  <ActionIcon variant="subtle" color="sand" onClick={() => setSearch('')} aria-label="Clear search">
                    <IconX size={14} />
                  </ActionIcon>
                ) : null
              }
            />
            <Select
              placeholder="Any status"
              data={STATUS_OPTIONS}
              value={status || null}
              onChange={(v) => patchParams({ status: v ?? '' })}
              clearable
              w={150}
              aria-label="Filter by status"
            />
            <Select
              placeholder="Any department"
              data={departments}
              value={departmentId || null}
              onChange={(v) => patchParams({ departmentId: v ?? '' })}
              clearable
              searchable
              w={190}
              disabled={departments.length === 0}
              aria-label="Filter by department"
            />
            {filtered && (
              <UnstyledButton onClick={clearFilters}>
                <Text size="sm" c="brand.8" fw={600}>Clear filters</Text>
              </UnstyledButton>
            )}
          </Group>
          <Text size="sm" c="sand.6">{countLabel}</Text>
        </Group>

        {error ? (
          <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />
        ) : (
          <>
            <Box visibleFrom="sm">
              <Table.ScrollContainer minWidth={520}>
                <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover={!loading}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        <SortHeader
                          label="Name" active={sort === 'name'} order={order}
                          onSort={() => toggleSort('name')}
                        />
                      </Table.Th>
                      <Table.Th w={150}>
                        <SortHeader
                          label="Employee no." active={sort === 'employeeNumber'} order={order}
                          onSort={() => toggleSort('employeeNumber')}
                        />
                      </Table.Th>
                      <Table.Th visibleFrom="md">Department</Table.Th>
                      <Table.Th visibleFrom="lg">Job title</Table.Th>
                      <Table.Th visibleFrom="sm" w={130}>
                        <SortHeader
                          label="Hired" active={sort === 'hireDate'} order={order}
                          onSort={() => toggleSort('hireDate')}
                        />
                      </Table.Th>
                      <Table.Th w={110}>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>{body()}</Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Box>

            {/* Below sm: stacked cards instead of a horizontally-scrolling table —
                every column that mattered on desktop is still here, just vertical. */}
            <Stack hiddenFrom="sm" gap="sm">
              {loading && Array.from({ length: 4 }, (_, i) => (
                <Card key={`ms${i}`} p="md" radius="md">
                  <Skeleton h={14} w="60%" radius="sm" mb={8} />
                  <Skeleton h={12} w="40%" radius="sm" />
                </Card>
              ))}
              {!loading && rows.map((r) => (
                <Card
                  key={r.id} p="md" radius="md" style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/employees/${r.id}`, { state: { from: listUrl } })}
                >
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <Avatar radius="xl" size={32} color="brand" variant="light">{initialsOf(r.fullName)}</Avatar>
                      <div>
                        <Text size="sm" fw={600}>{r.fullName}</Text>
                        <Text size="xs" c="sand.6" ff="monospace">{r.employeeNumber}</Text>
                      </div>
                    </Group>
                    <Badge variant="light" size="sm" color={STATUS_COLOR[r.employmentStatus] ?? 'sand'}>
                      {STATUS_LABEL[r.employmentStatus] ?? r.employmentStatus}
                    </Badge>
                  </Group>
                  <Group gap="xs" mt="sm">
                    <Text size="xs" c="sand.6">
                      {(r.departmentId && deptNames.get(r.departmentId)) || 'Unassigned'} · Hired {fmtDate(r.hireDate)}
                    </Text>
                  </Group>
                </Card>
              ))}
            </Stack>

            {!loading && rows.length === 0 && (
              <Center py={48}>
                <Stack gap={6} align="center">
                  <IconUsersGroup size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />
                  <Text fw={600} mt={4}>{filtered ? 'No matches' : 'No employees yet'}</Text>
                  <Text size="sm" c="sand.6" maw={380} ta="center">
                    {filtered
                      ? 'Try a different name, or clear the filters to see everyone.'
                      : 'Add your first employee to start running payroll.'}
                  </Text>
                  {!filtered && canAdd && (
                    <Button
                      component={Link} to="/employees/new" variant="light" mt="sm"
                      leftSection={<IconPlus size={16} />}
                    >
                      Add employee
                    </Button>
                  )}
                </Stack>
              </Center>
            )}

            {totalPages > 1 && (
              <Group justify="flex-end" mt="md">
                <Pagination
                  value={page}
                  onChange={(p) => patchParams({ page: p > 1 ? String(p) : '' }, false)}
                  total={totalPages}
                  size="sm"
                  withEdges
                />
              </Group>
            )}
          </>
        )}
      </Card>
    </Stack>
  );
}
