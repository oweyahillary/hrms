import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Card, Grid, Group, Skeleton, Stack, Text, ThemeIcon, Title,
} from '@mantine/core';
import {
  IconBriefcase, IconBuildingBank, IconEye, IconEyeOff, IconUser, IconUsersGroup,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { getMyProfile, type MyProfile } from '../api/self-service';
import {
  getDepartments, getJobTitles, departmentMap, jobTitleMap,
} from '../api/lookups';
import { ErrorCard } from '../components/ErrorCard';
import { formatDate as fmtDate } from '../utils/date';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'brand', ON_LEAVE: 'amber', SUSPENDED: 'red', EXITED: 'sand',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active', ON_LEAVE: 'On leave', SUSPENDED: 'Suspended', EXITED: 'Exited',
};
const TYPE_LABEL: Record<string, string> = {
  PERMANENT: 'Permanent', CONTRACT: 'Contract', CASUAL: 'Casual', INTERN: 'Intern',
};

/**
 * The API sends this back fully decrypted — that's correct here, it's your
 * own record (see self-service.service.ts). This mask is purely a screen
 * courtesy so it isn't sitting in the open by default; "reveal" never leaves
 * the browser.
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

export function MyProfilePage() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [deptNames, setDeptNames] = useState<Map<string, string>>(new Map());
  const [titleNames, setTitleNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const [me, depts, titles] = await Promise.all([
          getMyProfile(), getDepartments(), getJobTitles(),
        ]);
        if (cancelled) return;
        setProfile(me);
        setDeptNames(departmentMap(depts));
        setTitleNames(jobTitleMap(titles));
      } catch {
        if (!cancelled) setError('Could not load your profile. Please try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const sensitive = useMemo(() => {
    if (!profile) return { nationalId: '—', kraPin: '—', bankAccountNumber: '—' };
    const show = (v: string | null): string => (v ? (revealed ? v : maskLast4(v)) : '—');
    return {
      nationalId: show(profile.nationalId),
      kraPin: show(profile.kraPin),
      bankAccountNumber: show(profile.bankAccountNumber),
    };
  }, [profile, revealed]);

  if (error) {
    return (
      <Stack gap="lg">
        <Title order={1}>My profile</Title>
        <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </Stack>
    );
  }

  if (!profile) {
    return (
      <Stack gap="lg">
        <Title order={1}>My profile</Title>
        <Card p="lg" radius="md"><Skeleton h={200} radius="sm" /></Card>
      </Stack>
    );
  }

  const dept = (profile.departmentId && deptNames.get(profile.departmentId)) || 'Unassigned';
  const title = (profile.jobTitleId && titleNames.get(profile.jobTitleId)) || '—';

  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>My profile</Title>
        <Text c="sand.6" mt={4}>
          Read-only — if anything here is wrong, ask HR to update it.
        </Text>
      </div>

      <Section title="Personal" icon={IconUser}>
        <Field label="Full name">{profile.firstName} {profile.lastName}</Field>
        <Field label="Employee number">{profile.employeeNumber}</Field>
        <Field label="Date of birth">{fmtDate(profile.dateOfBirth)}</Field>
        <Field label="Gender">{profile.gender || '—'}</Field>
        <Field label="Phone">{profile.phone || '—'}</Field>
        <Field label="Email">{profile.email || '—'}</Field>
      </Section>

      <Section title="Employment" icon={IconBriefcase}>
        <Field label="Department">{dept}</Field>
        <Field label="Job title">{title}</Field>
        <Field label="Employment type">{TYPE_LABEL[profile.employmentType] ?? profile.employmentType}</Field>
        <Field label="Status">
          <Badge variant="light" size="sm" color={STATUS_COLOR[profile.employmentStatus] ?? 'sand'}>
            {STATUS_LABEL[profile.employmentStatus] ?? profile.employmentStatus}
          </Badge>
        </Field>
        <Field label="Hire date">{fmtDate(profile.hireDate)}</Field>
        {profile.exitDate && <Field label="Exit date">{fmtDate(profile.exitDate)}</Field>}
      </Section>

      <Section
        title="Statutory & bank"
        icon={IconBuildingBank}
        right={
          <Button
            variant="subtle" size="compact-sm" color="sand"
            leftSection={revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? 'Hide details' : 'Show details'}
          </Button>
        }
      >
        <Field label="National ID">{sensitive.nationalId}</Field>
        <Field label="KRA PIN">{sensitive.kraPin}</Field>
        <Field label="Bank">{profile.bankName || '—'}</Field>
        <Field label="Account number">{sensitive.bankAccountNumber}</Field>
        <Field label="Bank code">{profile.bankCode || '—'}</Field>
        <Field label="Branch code">{profile.bankBranchCode || '—'}</Field>
      </Section>

      <Section title="Next of kin" icon={IconUsersGroup}>
        <NextOfKin value={profile.nextOfKin} />
      </Section>
    </Stack>
  );
}
