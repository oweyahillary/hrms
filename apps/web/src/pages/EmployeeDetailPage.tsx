import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Anchor, Avatar, Badge, Button, Card, Center, CopyButton, Grid, Group, Modal, Select, Skeleton,
  Stack, Text, TextInput, ThemeIcon, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconArrowLeft, IconBriefcase, IconBuildingBank, IconCheck, IconCopy, IconEye, IconEyeOff, IconKey,
  IconLock, IconPencil, IconUser, IconUserOff, IconUsersGroup,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import {
  createEmployeeLogin, getEmployee, terminateEmployee,
  GRANTABLE_ROLE_NAMES, type CreateLoginResult, type EmployeeDetail, type GrantableRoleName,
} from '../api/employees';
import {
  getDepartments, getJobTitles, departmentMap, jobTitleMap,
} from '../api/lookups';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { canManageEmployees } from '../auth/roles';
import { SalarySection } from '../components/SalarySection';
import { SeveranceSection } from '../components/SeveranceSection';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'brand', ON_LEAVE: 'amber', SUSPENDED: 'red', EXITED: 'sand',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active', ON_LEAVE: 'On leave', SUSPENDED: 'Suspended', EXITED: 'Exited',
};
const TYPE_LABEL: Record<string, string> = {
  PERMANENT: 'Permanent', CONTRACT: 'Contract', CASUAL: 'Casual', INTERN: 'Intern',
};

/** @db.Date values arrive at UTC midnight — format in UTC or they shift a day. */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * Mirrors the API's maskLast4. Used only to re-hide values the server already
 * sent us in full. This is discretion, not security — the plaintext is already
 * in the browser for an HR caller. It exists so a national ID isn't sitting on
 * screen in an open-plan office by default.
 */
function maskLast4(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return '*'.repeat(value.length - 4) + value.slice(-4);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Grid.Col span={{ base: 12, xs: 6 }}>
      <Text size="xs" c="sand.6" tt="uppercase" fw={600} lh={1.6} style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </Grid.Col>
  );
}

function Section({ title, icon: SectionIcon, right, children }: {
  title: string; icon?: Icon; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Card p="lg" radius="md">
      <Group justify="space-between" align="center" mb="md">
        <Group gap="xs">
          {SectionIcon && (
            <ThemeIcon size={28} radius="md" variant="light" color="brand">
              <SectionIcon size={16} stroke={1.7} />
            </ThemeIcon>
          )}
          <Title order={3}>{title}</Title>
        </Group>
        {right}
      </Group>
      <Grid gutter="md">{children}</Grid>
    </Card>
  );
}

/** Render nextOfKin without assuming a shape — it's a free-form Json column. */
function NextOfKin({ value }: { value: unknown }) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return <Text size="sm" c="sand.6">Not recorded</Text>;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return <Text size="sm" c="sand.6">Not recorded</Text>;
  return (
    <Grid gutter="md">
      {entries.map(([k, v]) => (
        <Field key={k} label={k.replace(/([a-z])([A-Z])/g, '$1 $2')}>
          {typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </Field>
      ))}
    </Grid>
  );
}

export function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();

  // The list hands us the URL it was showing (filters, sort, page) so we can
  // return to that exact view. Arriving by deep link or a new tab means no
  // state — fall back to the bare list.
  const from = (location.state as { from?: string } | null)?.from ?? '/employees';
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const { user } = useAuth();
  const canManage = canManageEmployees(user?.role);
  // Granting 'Admin' is restricted to Admin actors — enforced server-side too.
  const grantableRoles = useMemo(
    () => GRANTABLE_ROLE_NAMES.filter((r) => r !== 'Admin' || user?.role === 'Admin'),
    [user?.role],
  );
  const [termOpen, setTermOpen] = useState(false);
  const [termDate, setTermDate] = useState(new Date().toISOString().slice(0, 10));
  const [terminating, setTerminating] = useState(false);
  const [termError, setTermError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginRole, setLoginRole] = useState<GrantableRoleName>('Employee');
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginResult, setLoginResult] = useState<CreateLoginResult | null>(null);
  const [deptNames, setDeptNames] = useState<Map<string, string>>(new Map());
  const [titleNames, setTitleNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRevealed(false); // never carry a reveal across records
    void (async () => {
      try {
        const e = await getEmployee(id);
        if (cancelled) return;
        setEmp(e);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setEmp(null);
        setError(
          e instanceof ApiError && e.status === 404
            ? 'That employee record does not exist, or is not part of this organisation.'
            : 'This record could not load. Check your connection and try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [depts, titles] = await Promise.all([getDepartments(), getJobTitles()]);
        if (cancelled) return;
        setDeptNames(departmentMap(depts));
        setTitleNames(jobTitleMap(titles));
      } catch {
        // Non-fatal — fall back to the placeholders below.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sensitive = useMemo(() => {
    if (!emp) return { nationalId: '—', kraPin: '—', bankAccountNumber: '—' };
    // When the server masked it, that IS the value — never unmask locally.
    const show = (v: string | null): string => {
      if (!v) return '—';
      if (emp.piiMasked) return v;
      return revealed ? v : maskLast4(v);
    };
    return {
      nationalId: show(emp.nationalId),
      kraPin: show(emp.kraPin),
      bankAccountNumber: show(emp.bankAccountNumber),
    };
  }, [emp, revealed]);

  const back = (
    <Anchor component={Link} to={from} size="sm" c="sand.6">
      <Group gap={4}><IconArrowLeft size={14} /> Back to employees</Group>
    </Anchor>
  );

  if (loading) {
    return (
      <Stack gap="lg">
        {back}
        <Skeleton h={38} w={280} radius="sm" />
        <Card p="lg" radius="md"><Skeleton h={120} radius="sm" /></Card>
        <Card p="lg" radius="md"><Skeleton h={120} radius="sm" /></Card>
      </Stack>
    );
  }

  if (error || !emp) {
    return (
      <Stack gap="lg">
        {back}
        <Card p="xl" radius="md">
          <Center py={32}>
            <Stack gap={8} align="center">
              <Text fw={600}>Record unavailable</Text>
              <Text size="sm" c="sand.6" maw={420} ta="center">{error}</Text>
              <Button component={Link} to={from} variant="light" mt="sm">
                Back to employees
              </Button>
            </Stack>
          </Center>
        </Card>
      </Stack>
    );
  }

  const dept = (emp.departmentId && deptNames.get(emp.departmentId)) || 'Unassigned';
  const title = (emp.jobTitleId && titleNames.get(emp.jobTitleId)) || '—';

  return (
    <Stack gap="lg">
      {back}

      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Group gap="md" wrap="nowrap" align="center">
          <Avatar radius="xl" size={52} color="brand" variant="light" style={{ fontWeight: 700 }}>
            {(emp.firstName[0] ?? '') + (emp.lastName[0] ?? '')}
          </Avatar>
          <div>
            <Group gap="sm" align="center">
              <Title order={1}>{emp.firstName} {emp.lastName}</Title>
              <Badge variant="light" color={STATUS_COLOR[emp.employmentStatus] ?? 'sand'}>
                {STATUS_LABEL[emp.employmentStatus] ?? emp.employmentStatus}
              </Badge>
            </Group>
            <Text c="sand.6" mt={4}>
              {emp.employeeNumber} · {title === '—' ? 'No job title' : title} · {dept}
            </Text>
          </div>
        </Group>
        {canManage && (
          <Group gap="sm">
            {!emp.login && (
              <Button
                variant="light" leftSection={<IconKey size={16} />}
                onClick={() => {
                  setLoginError(null);
                  setLoginResult(null);
                  setLoginEmail(emp.email ?? '');
                  setLoginRole('Employee');
                  setLoginOpen(true);
                }}
              >
                Create login
              </Button>
            )}
            {emp.employmentStatus !== 'EXITED' && (
              <Button
                variant="light" color="sand" leftSection={<IconUserOff size={16} />}
                onClick={() => { setTermError(null); setTermOpen(true); }}
              >
                Terminate
              </Button>
            )}
            <Button component={Link} to={`/employees/${emp.id}/edit`} leftSection={<IconPencil size={16} />}>
              Edit
            </Button>
          </Group>
        )}
      </Group>

      <Modal opened={termOpen} onClose={() => setTermOpen(false)} title="Terminate employee" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            This marks {emp.firstName} {emp.lastName} as exited. Their payslips and records are
            kept — nothing is deleted. You can erase their personal data separately once they
            have left.
          </Text>
          <TextInput
            label="Exit date" type="date" value={termDate}
            onChange={(e) => setTermDate(e.currentTarget.value)}
          />
          {termError && <Text size="sm" c="red">{termError}</Text>}
          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="sand" onClick={() => setTermOpen(false)}>Cancel</Button>
            <Button
              color="red" loading={terminating}
              onClick={() => {
                setTerminating(true);
                setTermError(null);
                void (async () => {
                  try {
                    const updated = await terminateEmployee(emp.id, termDate || undefined);
                    setEmp(updated);
                    setTermOpen(false);
                    notifications.show({
                      color: 'brand', icon: <IconCheck size={16} />,
                      title: 'Employee terminated',
                      message: `${updated.firstName} ${updated.lastName} is now exited.`,
                    });
                  } catch (err) {
                    setTermError(err instanceof ApiError ? err.message : 'Could not terminate this employee.');
                  } finally {
                    setTerminating(false);
                  }
                })();
              }}
            >
              Terminate
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={loginOpen}
        onClose={() => setLoginOpen(false)}
        title={loginResult ? 'Login created' : 'Create login'}
        centered
      >
        {loginResult ? (
          <Stack gap="md">
            <Text size="sm" c="sand.7">
              This password is shown once and cannot be retrieved again. Share it with{' '}
              {emp.firstName} through a secure channel — they will be asked to change it on first sign-in.
            </Text>
            <Group gap="xs" wrap="nowrap">
              <TextInput value={loginResult.email} label="Email" readOnly style={{ flex: 1 }} />
            </Group>
            <Group gap="xs" wrap="nowrap" align="flex-end">
              <TextInput
                value={loginResult.temporaryPassword} label="Temporary password" readOnly
                style={{ flex: 1 }} styles={{ input: { fontFamily: 'monospace' } }}
              />
              <CopyButton value={loginResult.temporaryPassword}>
                {({ copied, copy }) => (
                  <Button
                    variant="light" color={copied ? 'brand' : 'sand'}
                    leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    onClick={copy}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                )}
              </CopyButton>
            </Group>
            <Group justify="flex-end">
              <Button onClick={() => setLoginOpen(false)}>Done</Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="md">
            <Text size="sm" c="sand.7">
              Provisions a login for {emp.firstName} {emp.lastName}. A temporary password is
              generated and shown once — there is no email delivery, so you will need to pass it on
              yourself.
            </Text>
            <TextInput
              label="Email" type="email" required value={loginEmail}
              onChange={(e) => setLoginEmail(e.currentTarget.value)}
            />
            <Select
              label="Role" required data={grantableRoles} value={loginRole}
              onChange={(v) => setLoginRole((v as GrantableRoleName) ?? 'Employee')}
              allowDeselect={false}
            />
            {loginError && <Text size="sm" c="red">{loginError}</Text>}
            <Group justify="flex-end" gap="sm">
              <Button variant="subtle" color="sand" onClick={() => setLoginOpen(false)}>Cancel</Button>
              <Button
                loading={creatingLogin}
                disabled={!loginEmail.trim()}
                onClick={() => {
                  setCreatingLogin(true);
                  setLoginError(null);
                  void (async () => {
                    try {
                      const result = await createEmployeeLogin(emp.id, {
                        email: loginEmail.trim(), roleName: loginRole,
                      });
                      setLoginResult(result);
                      setEmp({ ...emp, login: { email: result.email, role: result.role, isActive: true } });
                      notifications.show({
                        color: 'brand', icon: <IconCheck size={16} />,
                        title: 'Login created',
                        message: `${emp.firstName} ${emp.lastName} can now sign in.`,
                      });
                    } catch (err) {
                      setLoginError(err instanceof ApiError ? err.message : 'Could not create a login for this employee.');
                    } finally {
                      setCreatingLogin(false);
                    }
                  })();
                }}
              >
                Create login
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Section title="Employment" icon={IconBriefcase}>
            <Field label="Employee no.">{emp.employeeNumber}</Field>
            <Field label="Type">{TYPE_LABEL[emp.employmentType] ?? emp.employmentType}</Field>
            <Field label="Department">{dept}</Field>
            <Field label="Job title">{title}</Field>
            <Field label="Hired">{fmtDate(emp.hireDate)}</Field>
            <Field label="Exit date">{fmtDate(emp.exitDate)}</Field>
          </Section>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Section title="Personal" icon={IconUser}>
            <Field label="Phone">{emp.phone || '—'}</Field>
            <Field label="Email">{emp.email || '—'}</Field>
            <Field label="Date of birth">{fmtDate(emp.dateOfBirth)}</Field>
            <Field label="Gender">{emp.gender || '—'}</Field>
            <Field label="Login">
              {emp.login
                ? `${emp.login.email} · ${emp.login.role}${emp.login.isActive ? '' : ' · deactivated'}`
                : 'Not provisioned'}
            </Field>
          </Section>
        </Grid.Col>

        <Grid.Col span={12}>
          <Section
            title="Statutory & bank"
            icon={IconBuildingBank}
            right={
              emp.piiMasked ? (
                <Tooltip label="Your role sees only the last 4 digits of these values" withArrow>
                  <Badge variant="light" color="sand" leftSection={<IconLock size={11} />}>
                    Restricted
                  </Badge>
                </Tooltip>
              ) : (
                <Button
                  variant="subtle" size="compact-sm" color="sand"
                  leftSection={revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  onClick={() => setRevealed((v) => !v)}
                >
                  {revealed ? 'Hide details' : 'Show details'}
                </Button>
              )
            }
          >
            <Field label="National ID">{sensitive.nationalId}</Field>
            <Field label="KRA PIN">{sensitive.kraPin}</Field>
            <Field label="Bank">{emp.bankName || '—'}</Field>
            <Field label="Account number">{sensitive.bankAccountNumber}</Field>
            <Field label="Bank code">{emp.bankCode || '—'}</Field>
            <Field label="Branch code">{emp.bankBranchCode || '—'}</Field>
          </Section>
        </Grid.Col>

        <Grid.Col span={12}>
          <Card p="lg" radius="md">
            <Group gap="xs" mb="md">
              <ThemeIcon size={28} radius="md" variant="light" color="brand">
                <IconUsersGroup size={16} stroke={1.7} />
              </ThemeIcon>
              <Title order={3}>Next of kin</Title>
            </Group>
            <NextOfKin value={emp.nextOfKin} />
          </Card>
        </Grid.Col>

        <Grid.Col span={12}>
          <SalarySection employeeId={emp.id} canEdit={canManage} />
        </Grid.Col>

        <Grid.Col span={12}>
          <SeveranceSection
            employeeId={emp.id}
            canEdit={canManage}
            hasExited={emp.employmentStatus === 'EXITED'}
            defaultExitDate={emp.exitDate}
          />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
