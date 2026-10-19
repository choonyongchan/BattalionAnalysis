/**
 * Deposit → SFT: correct or delete an SFT record.
 *
 * FormSG is the only way an SFT record is created, so there is nothing to deposit here: a
 * clerk picks a stored record, corrects any answer in it, or deletes it. It talks to
 * `/api/sft`, which checks a correction with the same `model/sftEdit.js#validateSftEdit` this
 * panel runs first. The SFT page reads the same table; a change here refreshes it at once, and
 * the list reloads with every background refresh so a record FormSG sends meanwhile appears.
 */

import { useRef, useState } from 'preact/hooks';
import { refresh } from '../../app/auth.ts';
import { Banner, Card, EmptyState } from '../../components/Card.tsx';
import { DataTable } from '../../components/Table.tsx';
import { deleteSftRecord, listSftRecords, updateSftRecord } from '../../data/sft.ts';
import { fmtDate, fmtInt } from '../../format.ts';
import { COMPANIES } from '../../../../shared/domain.ts';
import {
  ACKNOWLEDGEMENTS,
  TEXT_FIELDS,
  filterSftRows,
  toEditForm,
  toSftRows,
  validateSftEdit,
  type SftEditForm,
  type SftRecord,
} from '../../../../shared/sftEdit.ts';
import type { OutcomeNote } from '../../model/paradeMessages.ts';
import { Field } from '../settings/editors.tsx';
import { Outcome, RowActions, runBusy, useStoredList } from './shared.tsx';

/** The correction form for one record. */
function SftForm({
  form,
  setForm,
  errors,
  busy,
  onSubmit,
  onCancel,
}: {
  form: SftEditForm;
  setForm: (form: SftEditForm) => void;
  errors: Record<string, string>;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const set = (key: keyof SftEditForm) => (event: { currentTarget: HTMLInputElement | HTMLSelectElement }) =>
    setForm({ ...form, [key]: event.currentTarget.value });
  return (
    <form
      class="deposit"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div class="sftform">
        {TEXT_FIELDS.map(({ key, label }) => (
          <Field key={key} label={label} error={errors[key]}>
            <input class="field" type="text" value={form[key]} onInput={set(key)} />
          </Field>
        ))}
        <Field label="Company" error={errors.company}>
          <select class="field" value={form.company} onChange={set('company')}>
            <option value="">— None —</option>
            {COMPANIES.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Submitted (Singapore time)" error={errors.submittedAt}>
          <input class="field" type="datetime-local" value={form.submittedAt} onInput={set('submittedAt')} />
        </Field>
      </div>
      <div class="sftform__ticks">
        {ACKNOWLEDGEMENTS.map(({ key, label }) => (
          <label key={key} class="checkfield">
            <input
              type="checkbox"
              checked={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.currentTarget.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <div class="deposit__actions">
        <button class="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button class="button button--quiet" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The SFT panel. */
export function SftPanel() {
  const { items: records, error: listError, reload } = useStoredList(listSftRecords);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<SftEditForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OutcomeNote | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const run = (action: () => Promise<void>) => runBusy(setBusy, setResult, action);

  const stopEditing = () => {
    setEditing(null);
    setForm(null);
    setErrors({});
  };

  const startEdit = (record: SftRecord) => {
    setEditing(record.responseId);
    setForm(toEditForm(record));
    setErrors({});
    setResult(null);
    setConfirming(null);
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const save = () => {
    if (!form || !editing) return;
    const checked = validateSftEdit(form, Date.now());
    setErrors(checked.ok ? {} : checked.errors);
    if (!checked.ok) {
      setResult({ tone: 'error', text: 'Not saved. Correct the marked fields.', reasons: [] });
      return;
    }
    void run(async () => {
      const answer = await updateSftRecord(editing, form);
      if (answer.errors) {
        setErrors(answer.errors);
        setResult({ tone: 'error', text: answer.error || 'Not saved.', reasons: [] });
        return;
      }
      stopEditing();
      setResult({ tone: 'good', text: 'Saved the correction.', reasons: [] });
      await reload();
      void refresh();
    });
  };

  const confirmDelete = (id: string) =>
    run(async () => {
      await deleteSftRecord(id);
      setConfirming(null);
      if (editing === id) stopEditing();
      setResult({ tone: 'good', text: 'Deleted the SFT record.', reasons: [] });
      await reload();
      void refresh();
    });

  const byId = new Map((records ?? []).map((record) => [record.responseId, record]));
  const allRows = toSftRows(records ?? []);
  const rows = filterSftRows(allRows, query).map((row) => ({
    ...row,
    dateLabel: fmtDate(row.date),
    actions: (
      <RowActions
        label="it"
        confirming={confirming === row.id}
        busy={busy}
        onEdit={() => startEdit(byId.get(row.id)!)}
        onDelete={() => setConfirming(row.id)}
        onConfirm={() => confirmDelete(row.id)}
        onKeep={() => setConfirming(null)}
      />
    ),
  }));
  const editingRow = editing ? allRows.find((row) => row.id === editing) : null;

  return (
    <>
      <div ref={cardRef}>
        <Card
          title={editingRow ? `Editing ${editingRow.who}, ${fmtDate(editingRow.date)}` : 'Correct an SFT record'}
          note="SFT records come only from the FormSG form."
        >
          {form ? (
            <SftForm form={form} setForm={setForm} errors={errors} busy={busy} onSubmit={save} onCancel={stopEditing} />
          ) : (
            <EmptyState>Press Edit on a record below to correct it.</EmptyState>
          )}
          <Outcome result={result} />
        </Card>
      </div>

      <Card title="Stored SFT records" note={records ? fmtInt(records.length) + ' stored' : ''}>
        {listError ? <Banner tone="error">{listError}</Banner> : null}
        {records === null && !listError ? <EmptyState>Loading…</EmptyState> : null}
        {records && records.length === 0 ? <EmptyState>Nothing stored yet.</EmptyState> : null}
        {records && records.length > 0 ? (
          <>
            <div class="controlrow sftfilter">
              <input
                class="field"
                type="search"
                aria-label="Filter SFT records"
                placeholder="Filter by name, company, IC or location"
                value={query}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            {rows.length === 0 ? (
              <EmptyState>No record matches “{query.trim()}”.</EmptyState>
            ) : (
              <DataTable
                columns={[
                  { key: 'dateLabel', label: 'Date', sortable: true, defaultDir: 'desc', sortValue: (row: { date: string | null; time: string }) => row.date + ' ' + row.time },
                  { key: 'time', label: 'Time' },
                  { key: 'who', label: 'Name', sortable: true },
                  { key: 'company', label: 'Company', sortable: true },
                  { key: 'groupIc', label: 'Group IC', sortable: true },
                  { key: 'location', label: 'Location', sortable: true },
                  { key: 'actions', label: '' },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
              />
            )}
          </>
        ) : null}
      </Card>
    </>
  );
}
