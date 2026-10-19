/** The Deposit page's calls to `/api/sft`: list, correct and delete (FormSG is the only way to create one). */

import type { SftEditForm, SftRecord } from '../../../shared/sftEdit.ts';
import { callJson } from './api.ts';

const API = '/api/sft';

const HTTP_ERRORS: Record<number, string> = {
  401: 'The session has ended. Reload the page and unlock it again.',
  404: 'That SFT record no longer exists. Reload the list.',
  503: 'SFT corrections are not configured yet. Set DASHBOARD_PASSWORD on Vercel.',
};

/** A correction's answer: the stored record, or a 422's field errors. */
export interface SftUpdateReply {
  status?: string;
  record?: SftRecord;
  error?: string;
  errors?: Record<string, string>;
}

/** Every SFT record, newest first. */
export async function listSftRecords(): Promise<SftRecord[]> {
  return (await callJson<{ records?: SftRecord[] }>(API, 'GET', '', undefined, HTTP_ERRORS)).records ?? [];
}

/** Replaces a record's answers with a correction. */
export function updateSftRecord(id: string, form: SftEditForm): Promise<SftUpdateReply> {
  return callJson(API, 'PUT', '?id=' + encodeURIComponent(id), form, HTTP_ERRORS);
}

/** Deletes a record. */
export function deleteSftRecord(id: string): Promise<unknown> {
  return callJson(API, 'DELETE', '?id=' + encodeURIComponent(id), undefined, HTTP_ERRORS);
}
