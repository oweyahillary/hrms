import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Checkbox, FileInput, Group, Modal, Select, Skeleton, Stack, Table,
  Text, ThemeIcon, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconDownload, IconFiles, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import {
  deleteEmployeeDocument, downloadEmployeeDocument, listEmployeeDocuments, uploadEmployeeDocument,
  DOCUMENT_TYPES, type DocumentType, type EmployeeDocument,
} from '../api/employee-documents';
import { loadUserOptions, type UserOption } from '../api/users';
import { ApiError } from '../api/client';
import { formatDate as fmtDate } from '../utils/date';

const TYPE_LABEL: Record<DocumentType, string> = {
  ID_COPY: 'ID copy', CONTRACT: 'Contract', CERTIFICATE: 'Certificate', OTHER: 'Other',
};
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_BYTES = 10 * 1024 * 1024;

interface FormValues {
  file: File | null;
  documentType: DocumentType;
  isSensitive: boolean;
}

export function DocumentsSection({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: { file: null, documentType: 'OTHER', isSensitive: false },
    validate: {
      file: (v) => (v ? null : 'Choose a file'),
    },
  });

  useEffect(() => {
    void loadUserOptions().then(setUsers).catch(() => { /* uploader names just stay as "Recorded" */ });
  }, []);

  const uploaderName = (id: string): string => users.find((u) => u.value === id)?.label ?? 'Recorded';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setDocs(await listEmployeeDocuments(employeeId));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to view documents.'
        : 'Could not load documents.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  const openModal = () => {
    form.reset();
    setFormError(null);
    setOpen(true);
  };

  const submit = async (values: FormValues) => {
    if (!values.file) return;
    if (!ALLOWED_MIME.has(values.file.type)) {
      setFormError('Only PDF, JPEG or PNG files are accepted.');
      return;
    }
    if (values.file.size > MAX_BYTES) {
      setFormError('The file must be 10 MB or smaller.');
      return;
    }
    setSaving(true); setFormError(null);
    try {
      await uploadEmployeeDocument(employeeId, {
        file: values.file, documentType: values.documentType, isSensitive: values.isSensitive,
      });
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Document uploaded', message: '' });
      setOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not upload this document.');
    } finally {
      setSaving(false);
    }
  };

  const doDownload = async (d: EmployeeDocument) => {
    setDownloadingId(d.id);
    try {
      await downloadEmployeeDocument(employeeId, d.id, d.filename);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not download', message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteEmployeeDocument(employeeId, deleteTarget.id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Document removed', message: '' });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not remove document', message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card p="lg" radius="md">
      <Group justify="space-between" align="center" mb="md">
        <Group gap="xs">
          <ThemeIcon size={28} radius="md" variant="light" color="brand">
            <IconFiles size={16} stroke={1.7} />
          </ThemeIcon>
          <Title order={3}>Documents</Title>
        </Group>
        {canEdit && (
          <Button size="compact-sm" leftSection={<IconPlus size={14} />} onClick={openModal} disabled={loading}>
            Upload
          </Button>
        )}
      </Group>

      {error && <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} mb="md">{error}</Alert>}

      {loading && <Skeleton h={90} radius="sm" />}

      {!loading && !error && (
        docs.length === 0 ? (
          <Text c="sand.6">No documents on file yet.{canEdit ? ' Upload the first one to get started.' : ''}</Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Filename</Table.Th>
                  <Table.Th>Uploaded</Table.Th>
                  <Table.Th>Uploaded by</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {docs.map((d) => (
                  <Table.Tr key={d.id}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        {TYPE_LABEL[d.documentType]}
                        {d.isSensitive && <Badge size="xs" variant="light" color="sand">Sensitive</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="sm" lineClamp={1} maw={220}>{d.filename}</Text></Table.Td>
                    <Table.Td>{fmtDate(d.uploadedAt)}</Table.Td>
                    <Table.Td><Text size="sm" c="sand.6">{uploaderName(d.uploadedById)}</Text></Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Button
                          size="compact-sm" variant="subtle" leftSection={<IconDownload size={13} />}
                          loading={downloadingId === d.id} onClick={() => void doDownload(d)}
                        >
                          Download
                        </Button>
                        {canEdit && (
                          <Button
                            size="compact-sm" variant="subtle" color="red" leftSection={<IconTrash size={13} />}
                            onClick={() => setDeleteTarget(d)}
                          >
                            Remove
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )
      )}

      <Modal opened={open} onClose={() => setOpen(false)} title="Upload document" centered>
        <form onSubmit={form.onSubmit((v) => void submit(v))}>
          <Stack gap="md">
            <FileInput
              label="File" withAsterisk placeholder="Choose a PDF, JPEG or PNG (up to 10 MB)"
              leftSection={<IconUpload size={16} />} accept="application/pdf,image/jpeg,image/png"
              {...form.getInputProps('file')}
            />
            <Select
              label="Document type" withAsterisk allowDeselect={false}
              data={DOCUMENT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
              value={form.values.documentType}
              onChange={(v) => form.setFieldValue('documentType', (v as DocumentType) ?? 'OTHER')}
            />
            <Checkbox
              label="Sensitive document" description="Flags this document for extra discretion in how it's handled"
              {...form.getInputProps('isSensitive', { type: 'checkbox' })}
            />
            {formError && <Text size="sm" c="red">{formError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Upload</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Remove document" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            Remove <strong>{deleteTarget?.filename}</strong>? This cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="sand" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button color="red" loading={deleting} onClick={() => void doDelete()}>Remove</Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
