import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, ColorInput, Group, Image, LoadingOverlay, SegmentedControl,
  SimpleGrid, Stack, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconUpload, IconTrash, IconCheck } from '@tabler/icons-react';
import {
  getBranding, updateBranding, uploadLogo, deleteLogo,
  LOGO_MAX_BYTES, LOGO_MIME, type Branding,
} from '../api/organization';
import { logoUrl } from '../api/branding';
import { ApiError } from '../api/client';
import { useBranding } from '../branding/BrandingContext';
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning';

const HEX = /^#[0-9a-fA-F]{6}$/;

const SWATCHES = [
  '#0c6355', '#1f6f5c', '#14532d', '#1e3a5f', '#312e81',
  '#7c2d12', '#c62828', '#b8860b', '#3f3f46', '#0f766e',
];

export function SettingsPage() {
  const { branding, version, refresh } = useBranding();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm<{
    name: string; brandColor: string; logoAlignment: 'LEFT' | 'CENTER' | 'RIGHT';
    payslipNotice: string; kraPin: string; registrationNumber: string; physicalAddress: string;
  }>({
    validateInputOnBlur: true,
    initialValues: {
      name: '', brandColor: '', logoAlignment: 'LEFT', payslipNotice: '',
      kraPin: '', registrationNumber: '', physicalAddress: '',
    },
    validate: {
      name: (v) => (v.trim().length > 0 ? null : 'Organisation name is required'),
      brandColor: (v) => (!v || HEX.test(v) ? null : 'Use a 6-digit hex colour, e.g. #0c6355'),
    },
  });
  useUnsavedChangesWarning(form.isDirty());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const b = await getBranding();
        if (cancelled) return;
        form.setValues({
          name: b.name ?? '',
          brandColor: b.brandColor ?? '',
          logoAlignment: b.logoAlignment ?? 'LEFT',
          payslipNotice: b.payslipNotice ?? '',
          kraPin: b.kraPin ?? '',
          registrationNumber: b.registrationNumber ?? '',
          physicalAddress: b.physicalAddress ?? '',
        });
        form.resetDirty();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError && e.status === 403
            ? 'You do not have permission to change organisation settings.'
            : 'Could not load organisation settings.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(values: typeof form.values) {
    setSaving(true); setError(null);
    try {
      const patch: Partial<Branding> = {
        name: values.name.trim(),
        logoAlignment: values.logoAlignment,
        // Empty strings mean "not set" for the optional fields.
        brandColor: values.brandColor ? values.brandColor.toLowerCase() : null,
        payslipNotice: values.payslipNotice.trim() || null,
        kraPin: values.kraPin.trim() || null,
        registrationNumber: values.registrationNumber.trim() || null,
        physicalAddress: values.physicalAddress.trim() || null,
      };
      await updateBranding(patch);
      await refresh(); // re-theme the app immediately
      form.resetDirty();
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Settings saved', message: 'Your changes are live.',
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    if (!LOGO_MIME.includes(file.type)) {
      setError('The logo must be a PNG or JPEG image.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError('The logo must be 2 MB or smaller.');
      return;
    }
    setLogoBusy(true); setError(null);
    try {
      await uploadLogo(file);
      await refresh();
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Logo updated', message: '' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not upload the logo.');
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    setLogoBusy(true); setError(null);
    try {
      await deleteLogo();
      await refresh();
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Logo removed', message: '' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove the logo.');
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <Stack gap="lg" maw={880}>
      <div>
        <Title order={1}>Organisation</Title>
        <Text c="sand.6" mt={4}>Your organisation’s identity across the app and payslips</Text>
      </div>

      {error && <Alert color="red" variant="light">{error}</Alert>}

      <form onSubmit={form.onSubmit(save)}>
        <Stack gap="lg">
          <Card p="lg" radius="md" pos="relative">
            <LoadingOverlay visible={loading} overlayProps={{ blur: 1 }} />
            <Title order={3} mb="md">Identity</Title>

            <Stack gap="md">
              <TextInput label="Organisation name" {...form.getInputProps('name')} />

              <ColorInput
                label="Brand colour"
                description="Sets the accent colour across the app. Leave empty for the default."
                placeholder="#0c6355"
                format="hex"
                swatches={SWATCHES}
                withEyeDropper={false}
                {...form.getInputProps('brandColor')}
              />

              <Box>
                <Text size="sm" fw={500} mb={6}>Logo</Text>
                <Group align="flex-start" gap="lg">
                  <Card withBorder p="sm" radius="sm" bg="sand.0" w={220} h={96}>
                    <Group justify="center" align="center" h="100%">
                      {branding.hasLogo
                        ? <Image src={logoUrl(version)} alt="Logo" mah={72} w="auto" fit="contain" />
                        : <Text size="xs" c="sand.5">No logo uploaded</Text>}
                    </Group>
                  </Card>

                  <Stack gap="xs">
                    <input
                      ref={fileRef} type="file" accept="image/png,image/jpeg" hidden
                      onChange={(e) => void onPickFile(e.currentTarget.files?.[0])}
                    />
                    <Group gap="xs">
                      <Button
                        variant="default" size="sm" loading={logoBusy}
                        leftSection={<IconUpload size={15} />}
                        onClick={() => fileRef.current?.click()}
                      >
                        {branding.hasLogo ? 'Replace logo' : 'Upload logo'}
                      </Button>
                      {branding.hasLogo && (
                        <Button
                          variant="subtle" color="red" size="sm" loading={logoBusy}
                          leftSection={<IconTrash size={15} />}
                          onClick={() => void removeLogo()}
                        >
                          Remove
                        </Button>
                      )}
                    </Group>
                    <Text size="xs" c="sand.6">PNG or JPEG, up to 2 MB. Shown on the sign-in page, the sidebar and payslips.</Text>
                  </Stack>
                </Group>
              </Box>
            </Stack>
          </Card>

          <Card p="lg" radius="md">
            <Title order={3} mb="md">Payslips</Title>
            <Stack gap="md">
              <Box>
                <Text size="sm" fw={500} mb={6}>Logo alignment</Text>
                <SegmentedControl
                  data={[{ label: 'Left', value: 'LEFT' }, { label: 'Centre', value: 'CENTER' }, { label: 'Right', value: 'RIGHT' }]}
                  {...form.getInputProps('logoAlignment')}
                />
              </Box>
              <Textarea
                label="Payslip notice"
                description="Printed at the foot of every payslip."
                autosize minRows={2} maxRows={4}
                {...form.getInputProps('payslipNotice')}
              />
            </Stack>
          </Card>

          <Card p="lg" radius="md">
            <Title order={3} mb="md">Company details</Title>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput label="KRA PIN" placeholder="P051234567X" {...form.getInputProps('kraPin')} />
              <TextInput label="Registration number" {...form.getInputProps('registrationNumber')} />
              <TextInput label="Physical address" {...form.getInputProps('physicalAddress')} />
            </SimpleGrid>
          </Card>

          <Group justify="flex-end">
            <Button type="submit" loading={saving} disabled={!form.isDirty()} size="md">
              Save changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
