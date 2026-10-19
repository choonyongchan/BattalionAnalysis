/**
 * The Settings page's writes through `/api/settings` (the server decides who may edit), and the
 * two settings `app/` reads without reaching into `model/`.
 */

import { settingOf } from '../model/activeSettings.ts';
import type { SectionName, SettingsValues } from '../../../shared/settings/defaults.ts';
import type { FieldMessage } from '../../../shared/settings/validate.ts';
import { ApiError, send } from './api.ts';

const API = '/api/settings';

const HTTP_ERRORS: Record<number, string> = {
  400: 'The dashboard sent a request the server could not read. Reload and try again.',
  401: 'Editing has ended. Unlock editing again.',
  403: 'Settings can only be changed from the dashboard itself.',
  409: 'Someone else saved this section. Reload to see their version.',
  422: 'Some fields need fixing.',
  503: 'Editing is not configured. Set SETTINGS_PASSWORD on Vercel, different from DASHBOARD_PASSWORD.',
};

/** Sends one write; a refusal throws an `ApiError` carrying the field errors of a 422. */
async function write(url: string, init: RequestInit) {
  const { ok, status, body } = await send(url, init);
  if (!ok || !body.ok) {
    const message = HTTP_ERRORS[status] ?? `The settings could not be saved (HTTP ${status}).`;
    throw new ApiError(message, status, String(status), (body.errors as FieldMessage[] | undefined) ?? []);
  }
  return body;
}

/** Saves one section opened at `version` (0 for a default); resolves with the new version and any warnings. */
export async function saveSection(
  section: SectionName,
  value: unknown,
  version: number,
): Promise<{ version: number; warnings: FieldMessage[] }> {
  const body = await write(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, value, version }),
  });
  return { version: body.version as number, warnings: (body.warnings as FieldMessage[] | undefined) ?? [] };
}

/** Resets one section to its default. */
export async function resetSection(section: SectionName, version: number): Promise<void> {
  await write(`${API}?section=${encodeURIComponent(section)}&version=${version}`, { method: 'DELETE' });
}

/** The unit section in force, for the logo, wordmark and page title. */
export function unitSettings(): SettingsValues['unit'] {
  return settingOf('unit');
}

/** How often an open dashboard re-reads, in milliseconds. */
export function refreshMs(): number {
  return settingOf('session').refreshSeconds * 1000;
}
