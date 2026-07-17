import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Anchor, Button, Card, Grid, Group, Select, Skeleton, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconArrowLeft, IconCheck } from '@tabler/icons-react';
import {
  getEmployee, updateEmployee, type EmployeeDetail, type UpdateEmployeeInput,
} from '../api/employees';
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

const today = (): string => new Date().toISOString().slice(0, 10);

/** ISO timestamp -> yyyy-mm-dd for a native date input. UTC: @db.Date values
 *  arrive at UTC midnight and would shift a day if read in local time. */
const dateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

const kinField = (kin: unknown, key: string): string => {
  if (kin == null || typeof kin !== 'object' || Array.isArray(kin)) return '';
  const v = (kin as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
};

export function EmployeeEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const allowed = canManageEmployees(user?.role);

  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [jobTitles, setJobTitles] = useState<Option[]>([]);

  const form = useForm<FormValues>({
    initialValues: {
      employeeNumber: '', firstName: '', lastName: '', nationalId: '', kraPin: '',
      employmentType: 'PERMANENT', hireDate: '', departmentId: '', jobTitleId: '',
      phone: '', email: '', dateOfBirth: '', gender: '',
      bankName: '', bankAccountNumber: '', bankCode: '', bankBranchCode: '',
      kinName: '', kinRelationship: '', kinPhone: '',
    },
    validateInputOnBlur: true,
    validate: {
      employeeNumber: (v) => (v.trim() ? null : 'Give this employee a number'),
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
    setLoading(true);
    void (async () => {
      try {
        const [e, depts, titles] = await Promise.all([
          getEmployee(id), getDepartments(), getJobTitles(),
        ]);
        if (cancelled) return;
        setDepartments(depts.map((d) => ({ value: d.id, label: d.name })));
        setJobTitles(titles.map((j) => ({ value: j.id, label: j.title })));
        setEmp(e);
        form.setValues({
          employeeNumber: e.employeeNumber,
          firstName: e.firstName,
          lastName: e.lastName,
          nationalId: e.nationalId ?? '',
          kraPin: e.kraPin ?? '',
          employmentType: e.employmentType,
          hireDate: dateInput(e.hireDate),
          departmentId: e.departmentId ?? '',
          jobTitleId: e.jobTitleId ?? '',
          phone: e.phone ?? '',
          email: e.email ?? '',
          dateOfBirth: dateInput(e.dateOfBirth),
          gender: e.gender ?? '',
          bankName: e.bankName ?? '',
          bankAccountNumber: e.bankAccountNumber ?? '',
          bankCode: e.bankCode ?? '',
          bankBranchCode: e.bankBranchCode ?? '',
          kinName: kinField(e.nextOfKin, 'name'),
          kinRelationship: kinField(e.nextOfKin, 'relationship'),
          kinPhone: kinField(e.nextOfKin, 'phone'),
        });
        // Everything from here is the user's own change — that's what we PATCH.
        form.resetDirty();
        setLoadError(null);
      } catch (e) {
        if (cancelled) return;
        setLoadError(
          e instanceof ApiError && e.status === 404
            ? 'That employee record does not exist.'
            : 'This record could not load. Check your connection and try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const scrollToFirstError = (errs: Record<string, React.ReactNode>) => {
    const first = Object.keys(errs)[0];
    if (!first) return;
    const node = form.getInputNode(first);
    if (!node) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    node.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    node.focus?.();
  };

  const submit = async (v: FormValues) => {
    setSaving(true);
    setFormError(null);
    try {
      // Only changed fields go in the patch. Sending an unchanged national ID
      // would pointlessly re-encrypt it and rewrite its blind index.
      const patch: UpdateEmployeeInput = {};
      const req = (f: keyof FormValues, k: 'employeeNumber' | 'firstName' | 'lastName' | 'nationalId', t = (x: string) => x.trim()) => {
        if (form.isDirty(f)) patch[k] = t(v[f]);
      };
      req('employeeNumber', 'employeeNumber');
      req('firstName', 'firstName');
      req('lastName', 'lastName');
      req('nationalId', 'nationalId');
      if (form.isDirty('employmentType')) patch.employmentType = v.employmentType;
      if (form.isDirty('hireDate')) patch.hireDate = v.hireDate;

      // Nullable fields: blank means clear, which is `null` — not '' (the API
      // would reject '' against a format rule) and not undefined (no change).
      const nullable = (f: keyof FormValues, k: keyof UpdateEmployeeInput, t = (x: string) => x.trim()) => {
        if (!form.isDirty(f)) return;
        const raw = v[f].trim();
        (patch as Record<string, unknown>)[k] = raw ? t(v[f]) : null;
      };
      nullable('kraPin', 'kraPin', normalizeKraPin);
      nullable('phone', 'phone', normalizePhone);
      nullable('email', 'email');
      nullable('dateOfBirth', 'dateOfBirth');
      nullable('gender', 'gender');
      nullable('departmentId', 'departmentId');
      nullable('jobTitleId', 'jobTitleId');
      nullable('bankName', 'bankName');
      nullable('bankAccountNumber', 'bankAccountNumber');
      nullable('bankCode', 'bankCode');
      nullable('bankBranchCode', 'bankBranchCode');

      // nextOfKin is a free-form Json column, so merge onto whatever is stored
      // rather than replacing it — a record written by another tool may carry
      // keys this form doesn't show, and replacing would drop them.
      if (form.isDirty('kinName') || form.isDirty('kinRelationship') || form.isDirty('kinPhone')) {
        const existing = (emp?.nextOfKin && typeof emp.nextOfKin === 'object' && !Array.isArray(emp.nextOfKin))
          ? { ...(emp.nextOfKin as Record<string, unknown>) } : {};
        const put = (key: string, val: string) => {
          if (val.trim()) existing[key] = val.trim();
          else delete existing[key];
        };
        put('name', v.kinName);
        put('relationship', v.kinRelationship);
        put('phone', v.kinPhone ? normalizePhone(v.kinPhone) : '');
        patch.nextOfKin = existing;
      }

      if (Object.keys(patch).length === 0) {
        notifications.show({ color: 'sand', title: 'Nothing to save', message: 'No changes were made.' });
        setSaving(false);
        return;
      }

      const updated = await updateEmployee(id, patch);
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Changes saved', message: `${updated.firstName} ${updated.lastName}`,
      });
      navigate(`/employees/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        form.setFieldError('employeeNumber', 'That employee number is already taken');
      } else if (e instanceof ApiError && e.status === 403) {
        setFormError('Your role cannot edit employees. Ask an administrator for access.');
      } else {
        setFormError(e instanceof ApiError ? e.message : 'The changes could not be saved. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const back = (
    <Anchor component={Link} to={`/employees/${id}`} size="sm" c="sand.6">
      <Group gap={4}><IconArrowLeft size={14} /> Back to record</Group>
    </Anchor>
  );

  if (!allowed) {
    return (
      <Stack gap="lg">
        {back}
        <Card p="xl" radius="md">
          <Title order={3}>You can&apos;t edit employees</Title>
          <Text c="sand.6" mt="xs">Editing employee records needs an HR role.</Text>
        </Card>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Stack gap="lg">
        {back}
        <Skeleton h={38} w={280} radius="sm" />
        <Card p="lg" radius="md"><Skeleton h={160} radius="sm" /></Card>
      </Stack>
    );
  }

  if (loadError || !emp) {
    return (
      <Stack gap="lg">
        {back}
        <Card p="xl" radius="md">
          <Title order={3}>Record unavailable</Title>
          <Text c="sand.6" mt="xs">{loadError}</Text>
          <Button component={Link} to="/employees" variant="light" mt="md">Back to employees</Button>
        </Card>
      </Stack>
    );
  }

  /**
   * Refuse to edit a record whose PII came back masked. The form round-trips
   * what it was given, and bankAccountNumber has no format rule server-side —
   * so submitting a masked "*********6789" would encrypt and store that as the
   * real account number. Today this can't happen (editing and unmasked PII share
   * the same role list), but the cost of being wrong is silent data loss.
   */
  if (emp.piiMasked) {
    return (
      <Stack gap="lg">
        {back}
        <Card p="xl" radius="md">
          <Title order={3}>You can&apos;t edit this record</Title>
          <Text c="sand.6" mt="xs">
            Your role sees this employee&apos;s ID and bank details in masked form, so editing
            would overwrite them. Ask an administrator to make the change.
          </Text>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      {back}

      <div>
        <Title order={1}>Edit {emp.firstName} {emp.lastName}</Title>
        <Text c="sand.6" mt={4}>Only the fields you change are saved</Text>
      </div>

      <form onSubmit={form.onSubmit((v) => void submit(v), scrollToFirstError)}>
        <Stack gap="md">
          {formError && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{formError}</Alert>
          )}

          <Card p="lg" radius="md">
            <Title order={3} mb="md">Employment</Title>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Employee number" withAsterisk {...form.getInputProps('employeeNumber')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Select
                  label="Employment type" data={EMPLOYMENT_TYPES} withAsterisk allowDeselect={false}
                  {...form.getInputProps('employmentType')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Hire date" type="date" withAsterisk {...form.getInputProps('hireDate')} />
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
                <TextInput label="Phone" placeholder="0712345678" {...form.getInputProps('phone')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Email" {...form.getInputProps('email')} />
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
              Changing the national ID, KRA PIN or account number re-encrypts the value.
            </Text>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="National ID" withAsterisk {...form.getInputProps('nationalId')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="KRA PIN" placeholder="A012345678Z" {...form.getInputProps('kraPin')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Bank" {...form.getInputProps('bankName')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Account number" {...form.getInputProps('bankAccountNumber')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Bank code" {...form.getInputProps('bankCode')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Branch code" {...form.getInputProps('bankBranchCode')} />
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
                <TextInput label="Relationship" {...form.getInputProps('kinRelationship')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <TextInput label="Phone" {...form.getInputProps('kinPhone')} />
              </Grid.Col>
            </Grid>
          </Card>

          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="sand" component={Link} to={`/employees/${id}`}>Cancel</Button>
            <Button type="submit" loading={saving}>Save changes</Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
