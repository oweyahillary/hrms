import { api, downloadFile } from './client';

export const DOCUMENT_TYPES = ['ID_COPY', 'CONTRACT', 'CERTIFICATE', 'OTHER'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  documentType: DocumentType;
  filename: string;
  isSensitive: boolean;
  uploadedById: string;
  uploadedAt: string;
}

export const listEmployeeDocuments = (employeeId: string): Promise<EmployeeDocument[]> =>
  api<EmployeeDocument[]>(`/employees/${employeeId}/documents`);

export interface UploadDocumentInput {
  file: File;
  documentType: DocumentType;
  isSensitive?: boolean;
}

export const uploadEmployeeDocument = (employeeId: string, input: UploadDocumentInput): Promise<EmployeeDocument> => {
  const form = new FormData();
  form.append('file', input.file);
  form.append('documentType', input.documentType);
  if (input.isSensitive) form.append('isSensitive', 'true');
  return api<EmployeeDocument>(`/employees/${employeeId}/documents`, { method: 'POST', body: form });
};

export const downloadEmployeeDocument = (employeeId: string, docId: string, filename: string): Promise<void> =>
  downloadFile(`/employees/${employeeId}/documents/${docId}/download`, filename);

export const deleteEmployeeDocument = (employeeId: string, docId: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/employees/${employeeId}/documents/${docId}`, { method: 'DELETE' });
