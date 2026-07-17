import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert, Anchor, Button, Card, Grid, Group, Select, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconArrowLeft, IconCheck } from '@tabler/icons-react';
import { createEmployee, getNextNumber, type CreateEmployeeInput } from '../api/employees';
import { getDepartments, getJobTitles, type Option } from '../api/lookups';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { canManageEmployees } from '../auth/roles';
import {
  KENYA_PHONE_REGEX, KRA_PIN_REGEX, NATIONAL_ID_REGEX, errors as msg,
  normalizeKraPin, normalizePhone,
} from '../validation/kenya';

const EMPLOYMENT_TYPES: Option[] = [
  { value: 'PERMANENT', label: 'Permanent' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'CASUAL', label: 'Casual' },
  { value: 'INTERN', label: 'Intern' },
];

const GENDERS: Option[] = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

interface FormValues {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  kraPin: string;
  employmentType: string;
  hireDate: string;
  departmentId: string;
  jobTitleId: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  bankName: string;
  bankAccountNumber: string;
  bankCode: string;
  bankBranchCode: string;
  kinName: string;
  kinRelationship: string;
  kinPhone: string;
}

const EMPTY: FormValues = {
  employeeNumber: '', firstName: '', lastName: '', nationalId: '', kraPin: '',
  employmentType: 'PERMANENT', hireDate: '', departmentId: '', jobTitleId: '',
  phone: '', email: '', dateOfBirth: '', gender: '',
  bankName: '', bankAccountNumber: '', bankCode: '', bankBranchCode: '',
  kinName: '', kinRelationship: '', kinPhone: '',
};

const today = (): string => new Date().toISOString().slice(0, 10);

/** Turn form state into the API payload, omitting every empty optional field. */
function toPayload(v: FormValues): CreateEmployeeInput {
  const opt = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);

  const kin: Record<string, unknown> = {};
  if (v.kinName.trim()) kin.name = v.kinName.trim();
  if (v.kinRelationship.trim()) kin.relationship = v.kinRelationship.trim();
  if (v.kinPhone.trim()) kin.phone = normalizePhone(v.kinPhone);

  return {
    // Omitted (not empty) when blank -> the server allocates from the org prefix.
    employeeNumber: opt(v.employeeNumber),
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    nationalId: v.nationalId.trim(),
    employmentType: v.employmentType,
    hireDate: v.hireDate,
    kraPin: v.kraPin.trim() ? normalizeKraPin(v.kraPin) : undefined,
    phone: v.phone.trim() ? normalizePhone(v.phone) : undefined,
    email: opt(v.email),
    dateOfBirth: opt(v.dateOfBirth),
    gender: opt(v.gender),
    departmentId: opt(v.departmentId),
    jobTitleId: opt(v.jobTitleId),
    bankName: opt(v.bankName),
    bankAccountNumber: opt(v.bankAccountNumber),
    bankCode: opt(v.bankCode),
    bankBranchCode: opt(v.bankBranchCode),
    // Only send next-of-kin when there's something in it — an empty object would
    // be stored as `{}` and read back as a record with no fields.
    nextOfKin: Object.keys(kin).length ? kin : undefined,
  };
}

export function EmployeeCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const allowed = canManageEmployees(user?.role);

  const [departments, setDepartments] = useState<Option[]>([]);
  const [jobTitles, setJobTitles] = useState<Option[]>([]);
  const [autoNumber, setAutoNumber] = useState<{ on: boolean; next: string | null }>({ on: false, next: null });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    initialValues: EMPTY,
    validateInputOnBlur: true,
    validate: {
      // Mantine re-reads these rules each render, so this sees the current
      // autoNumber state rather than the value captured at mount.
      employeeNumber: (v) => (v.trim() || autoNumber.on ? null : 'Give this employee a number'),
      firstName: (v) => (v.trim() ? null : 'First name is required'),
      lastName: (v) => (v.trim() ? null : 'Last name is required'),
      nationalId: (v) => (NATIONAL_ID_REGEX.test(v.trim()) ? null : msg.nationalId),
      kraPin: (v) => (!v.trim() || KRA_PIN_REGEX.test(normalizeKraPin(v)) ? null : msg.kraPin),
      phone: (v) => (!v.trim() || KENYA_PHONE_REGEX.test(normalizePhone(v)) ? null : msg.phone),
      kinPhone: (v) => (!v.trim() || KENYA_PHONE_REGEX.test(normalizePhone(v)) ? null : msg.phone),
      email: (v) => (!v.trim() || /^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Enter a valid email address'),
      hireDate: (v) => (v ? null : 'Pick a hire date'),
      dateOfBirth: (v) => (!v || v < today() ? null : 'Date of birth must be in the past'),
      employmentType: (v) => (v ? null : 'Pick an employment type'),
    },
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [depts, titles, num] = await Promise.all([
          getDepartments(), getJobTitles(), getNextNumber(),
        ]);
        if (cancelled) return;
        setDepartments(depts.map((d) => ({ value: d.id, label: d.name })));
        setJobTitles(titles.map((j) => ({ value: j.id, label: j.title })));
        setAutoNumber({ on: num.autoNumbering, next: num.next });
      } catch {
        // Non-fatal. If the preview fails the field just stays required, which
        // is the old behaviour — better than blocking the whole form.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async (values: FormValues) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createEmployee(toPayload(values));
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Employee added', message: `${created.firstName} ${created.lastName}`,
      });
      navigate(`/employees/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // The only 409 this endpoint raises is a duplicate employee number —
        // put it on the field rather than in a banner the user has to decode.
        form.setFieldError('employeeNumber', 'That employee number is already taken');
        setFormError(null);
      } else if (e instanceof ApiError && e.status === 403) {
        setFormError('Your role cannot add employees. Ask an administrator for access.');
      } else {
        setFormError(e instanceof ApiError ? e.message : 'The employee could not be saved. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * The form is taller than the viewport, so on a failed submit the first error
   * is usually off-screen. Take the user to it instead of leaving them staring
   * at an unchanged page.
   */
  const scrollToFirstError = (errs: Record<string, React.ReactNode>) => {
    const first = Object.keys(errs)[0];
    if (!first) return;
    const node = form.getInputNode(first);
    if (!node) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    node.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    node.focus?.();
  };

  const back = (
    <Anchor component={Link} to="/employees" size="sm" c="sand.6">
      <Group gap={4}><IconArrowLeft size={14} /> Back to employees</Group>
    </Anchor>
  );

  if (!allowed) {
    return (
      <Stack gap="lg">
        {back}
        <Card p="xl" radius="md">
          <Title order={3}>You can&apos;t add employees</Title>
          <Text c="sand.6" mt="xs">
            Adding people to the organisation needs an HR role. Ask an administrator for access.
          </Text>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      {back}

      <div>
        <Title order={1}>Add employee</Title>
        <Text c="sand.6" mt={4}>Name, ID and hire date are required — the rest can follow later</Text>
      </div>

      <form onSubmit={form.onSubmit((v) => void submit(v), scrollToFirstError)}>
        <Stack gap="md">
          {formError && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              {formError}
            </Alert>
          )}

          <Card p="lg" radius="md">
            <Title order={3} mb="md">Employment</Title>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Employee number"
                  placeholder={autoNumber.on ? (autoNumber.next ?? '') : 'EMP-002'}
                  withAsterisk={!autoNumber.on}
                  description={autoNumber.on
                    ? `Leave blank to use ${autoNumber.next ?? 'the next number'}`
                    : undefined}
                  {...form.getInputProps('employeeNumber')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Select
                  label="Employment type" data={EMPLOYMENT_TYPES} withAsterisk allowDeselect={false}
                  {...form.getInputProps('employmentType')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Hire date" type="date" withAsterisk
                  {...form.getInputProps('hireDate')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Select
                  label="Department" data={departments} placeholder="Unassigned" clearable searchable
                  {...form.getInputProps('departmentId')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Select
                  label="Job title" data={jobTitles} placeholder="None" clearable searchable
                  {...form.getInputProps('jobTitleId')}
                />
              </Grid.Col>
            </Grid>
          </Card>

          <Card p="lg" radius="md">
            <Title order={3} mb="md">Personal</Title>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="First name" withAsterisk {...form.getInputProps('firstName')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Last name" withAsterisk {...form.getInputProps('lastName')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Phone" placeholder="0712345678"
                  {...form.getInputProps('phone')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Email" placeholder="name@company.co.ke" {...form.getInputProps('email')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Date of birth" type="date" {...form.getInputProps('dateOfBirth')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Select label="Gender" data={GENDERS} placeholder="Not stated" clearable {...form.getInputProps('gender')} />
              </Grid.Col>
            </Grid>
          </Card>

          <Card p="lg" radius="md">
            <Title order={3}>Statutory &amp; bank</Title>
            <Text size="sm" c="sand.6" mt={4} mb="md">
              National ID and KRA PIN are encrypted. Bank details are needed before this
              employee can appear on a bank export.
            </Text>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="National ID" placeholder="12345678" withAsterisk
                  {...form.getInputProps('nationalId')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="KRA PIN" placeholder="A012345678Z"
                  {...form.getInputProps('kraPin')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Bank" placeholder="Equity Bank" {...form.getInputProps('bankName')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Account number" {...form.getInputProps('bankAccountNumber')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Bank code" placeholder="68" {...form.getInputProps('bankCode')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Branch code" placeholder="068000" {...form.getInputProps('bankBranchCode')} />
              </Grid.Col>
            </Grid>
          </Card>

          <Card p="lg" radius="md">
            <Title order={3} mb="md">Next of kin</Title>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <TextInput label="Name" {...form.getInputProps('kinName')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <TextInput label="Relationship" placeholder="Spouse" {...form.getInputProps('kinRelationship')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <TextInput label="Phone" placeholder="0712345678" {...form.getInputProps('kinPhone')} />
              </Grid.Col>
            </Grid>
          </Card>

          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="sand" component={Link} to="/employees">
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Add employee
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
