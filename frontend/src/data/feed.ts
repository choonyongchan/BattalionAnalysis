/**
 * Reads the dashboard's data from `/api/dashboard` in one GET. The session cookie authorises it;
 * the check is on the server, where the page cannot skip it.
 */

import { OPTIONAL_DATASETS, type DashboardData } from '../../../shared/dashboard.ts';
import type { Holiday, SectionName, SettingsValues } from '../../../shared/settings/defaults.ts';
import type { SectionMeta } from '../../../shared/settings/resolve.ts';
import { defaultSettings } from '../../../shared/settings/resolve.ts';
import type { Rotation } from '../../../shared/rotations.ts';
import { setActiveSettings } from '../model/activeSettings.ts';
import { ApiError, send } from './api.ts';

const API = '/api/dashboard';

const HTTP_ERRORS: Record<number, string> = {
  401: 'The session has ended. Enter the password again.',
  503: 'The dashboard is not configured yet. Set DASHBOARD_PASSWORD and DASHBOARD_DATABASE_URL on Vercel.',
};

/** Notes shown when a calendar list is empty. */
const EMPTY_CALENDAR_NOTES = {
  'Public Holidays': 'No public holidays are set, so none are marked on any chart. Add them under Settings → Calendar.',
  Rotations: 'No rotations are set, so rotational grouping is unavailable. Add them under Settings → Calendar.',
};

/** Everything the pages read: the datasets, the settings in force and the calendar. */
export interface Dataset extends DashboardData {
  generatedAt: string;
  /** Why an optional dataset or calendar list is empty, keyed by what it is. */
  notes: Record<string, string>;
  settings: SettingsValues;
  settingsMeta: Partial<Record<SectionName, SectionMeta>>;
  canEdit: boolean;
  holidays: Holiday[];
  rotations: Rotation[];
}

/** The `/api/dashboard` reply. */
interface DashboardReply {
  ok?: boolean;
  error?: string;
  reference?: string;
  generatedAt?: string;
  data?: Partial<DashboardData>;
  settings?: { values: SettingsValues; meta: Record<SectionName, SectionMeta> };
  canEdit?: boolean;
}

/** Requests every dataset; throws an `ApiError` when the session is over or the route fails. */
async function fetchData(): Promise<DashboardReply> {
  const { ok, status, body } = await send(API);
  const reply = body as DashboardReply;
  if (!ok || !reply.ok) {
    const reference = reply.reference ? ', reference ' + reply.reference : '';
    const message = HTTP_ERRORS[status] ?? `The dashboard could not load its data (HTTP ${status}${reference}).`;
    throw new ApiError(message, status, reply.error ?? String(status));
  }
  return reply;
}

/** Maps a dashboard reply to the dataset the pages read, and makes its settings the active ones. */
export function datasetFromReply(reply: DashboardReply): Dataset {
  const data = reply.data ?? {};
  const settings = reply.settings?.values ?? defaultSettings();
  const notes: Record<string, string> = {};
  for (const [key, note] of Object.entries(OPTIONAL_DATASETS)) {
    if (!data[key as keyof DashboardData]?.length) notes[key] = note;
  }
  const { holidays, rotations } = settings.calendar;
  if (holidays.length === 0) notes['Public Holidays'] = EMPTY_CALENDAR_NOTES['Public Holidays'];
  if (rotations.length === 0) notes.Rotations = EMPTY_CALENDAR_NOTES.Rotations;

  setActiveSettings(settings);
  return {
    strength: data.strength ?? [],
    personnel: data.personnel ?? [],
    roster: data.roster ?? [],
    formSg: data.formSg ?? [],
    submissions: data.submissions ?? [],
    sft: data.sft ?? [],
    sectionCounts: data.sectionCounts ?? [],
    generatedAt: reply.generatedAt ?? '',
    notes,
    settings,
    settingsMeta: reply.settings?.meta ?? {},
    canEdit: reply.canEdit === true,
    holidays,
    rotations,
  };
}

/** Loads every dataset the dashboard reads. */
export async function loadAll(): Promise<Dataset> {
  return datasetFromReply(await fetchData());
}
