# Manual checks

The checks that cannot be automated, because they need the real spreadsheet, the real
deployment, or the real API. Everything else is in `bun test`; run that first.

Kept in `test/` beside the automated checks so the deploy procedure is versioned rather
than remembered. `test/` is outside the clasp deployment boundary (`.clasp.json` sets
`rootDir: "src"`), so nothing here ships.

## 0. Before deploying

```sh
bun test ./test/ ./whatsapp/test/     # must be green
```

## 1. One-time spreadsheet migration

There is no migration code — this is done by hand, once, per spreadsheet.

- [ ] On **Parade State Responses**, delete the columns `processed_status`,
      `process_attempts`, `last_error`, `processed_at`, and add a single `error` column
      after `parade_response_id`. Final layout, in order:
      `Timestamp | Drop your Parade State here | wa_message_id | parade_response_id | error`
      The first two are Form-owned and must keep their exact titles.
- [ ] Delete the **Parade State Errors** tab. Nothing writes it any more; failures are
      recorded on the response row itself.
- [ ] Delete the **Report Sick FormSG Errors** tab. Nothing has written it for some
      time.

The other three tabs need no action: `Strength Data`, `Personnel Data` and
`Command Roster` are created with their header rows on first write.

## 1a. The two dashboard settings tabs

Both are optional and both are created by hand. Nothing in `src/` writes either one — the
dashboard is the only thing that reads them — so there is no first write to create them.
Until they exist the dashboard reports them as absent on its Settings page and simply
draws no holiday lines and offers no rotational grouping.

- [ ] Create a tab named **Public Holidays** with exactly this header row:
      `date | name`
      One row per Singapore public holiday, `date` as `yyyy-MM-dd`. Trend charts draw a
      light red line on each one, so a wrong date is visible rather than silent. The
      `name` column is optional: `calendarMarks.js` carries a fallback map of gazetted
      Singapore holidays for 2025 and 2026, so a blank `name` on one of those dates is
      filled with the official name (e.g. "National Day"); only an unknown date shows the
      generic "Public holiday".
- [ ] Create a tab named **Rotations** with exactly this header row:
      `name | start_date | end_date`
      One row per rotation — TRADES, Rot 1, Rot 2, Rot 3, Rot 4 — with dates as
      `yyyy-MM-dd`. Leave `end_date` blank for a rotation still running. The dashboard's
      Settings page flags gaps between rotations and overlaps between them; check it after
      filling this in, because a gap silently sends those days into a "No rotation" bucket.

## 2. Script properties

Set in the Apps Script editor under **Project Settings → Script properties**. There is
no `setup()` function any more, deliberately — it required pasting live secrets into a
source file.

- [ ] `OPENAI_API_KEY`
- [ ] `WHATSAPP_INGEST_TOKEN` — must match `APPS_SCRIPT_TOKEN` in `whatsapp/.env`.

## 3. Deploy

- [ ] `bunx clasp push`
- [ ] **Deploy → New deployment.** A push alone does not change what `doPost` serves.
- [ ] Run `installTriggers()` once from the editor. Confirm on the **Triggers** page
      that exactly two exist: `onFormSubmitHandler` and `onEditHandler`.

## 4. The header guard

This is what replaced `verifySetup()`, so it is worth seeing fire once.

- [ ] **Before** doing step 1, run `reprocessRow(2)` from the editor. Expect: nothing
      written, and an execution log naming both the expected and the actual header.
- [ ] **After** step 1, run it again. Expect: the row processes.

## 5. The row contract

On a row holding a real parade-state message:

- [ ] **Fresh row.** Paste a message into a new row, leaving `parade_response_id` empty.
      Type anything into `parade_response_id` then delete it. Expect: the row processes,
      the key appears (e.g. `Archer_2026-06-22_FPS`), `error` is blank, and rows appear
      in all three output tabs.
- [ ] **Forced reprocess.** Clear `parade_response_id` on that row. Expect: the same key
      returns and the output rows are *replaced*, not duplicated — check the row count
      in Strength Data is unchanged.
- [ ] **Corrected message.** Edit the message text to change its date, then clear
      `parade_response_id`. Expect: the new key is written, and **no** rows remain under
      the old key in any of the three tabs. (This is the `previousId` path; it is the
      one thing that silently rotted in the old design.)
- [ ] **Failure.** Paste unreadable text into a new row and clear its
      `parade_response_id`. Expect: `parade_response_id` reads `ERROR`, `error` holds a
      readable reason, and nothing is written to the output tabs.
- [ ] **Recovery.** Fix that message, clear `ERROR` from `parade_response_id`. Expect:
      the row processes and `error` goes blank.
- [ ] **In-progress marker.** During a reprocess (a slow one, or watch closely), `error`
      briefly reads `Processing...` with `parade_response_id` still blank, then both
      settle to the outcome. A row left showing `Processing...` with a blank id is a run
      that was killed mid-flight.
- [ ] **Batch recovery.** Leave one or more rows with a blank `parade_response_id`, then
      run **Extensions → Macros → reprocessPendingRows** (or `reprocessPendingRows()` from
      the editor). Expect: every still-blank row processes; no "script function not
      found". Rows already at a key or `ERROR` are untouched.
- [ ] **Bulk-clear guard.** Select 25 `parade_response_id` cells and press Delete.
      Expect: nothing processes, and one execution-log line naming the 20-row cap.
      (Do this on rows you are willing to reprocess afterwards.)

## 6. The WhatsApp endpoint

- [ ] POST a real message body to `<web app URL>?route=paradestate` with the ingest
      token. Expect `{"ok":true,"appended":true,...}` and one new row, processed within
      the same execution.
- [ ] POST the **same** `messageId` again. Expect `{"ok":true,"appended":false,...}` and
      no second row. If the first row already processed to a key, expect no second AI
      call — this is the dedup that stops a Baileys redelivery or an Apps Script 302 from
      costing twice. If the first row is still blank (its run was killed), the redelivery
      reprocesses it instead of dropping it.
- [ ] POST with a wrong token. Expect `{"ok":false,"error":"unauthorised"}` and no row.

## 7. The FormSG route still works

Untouched by this change, but it shares the one `doPost`, so it is worth one check.

- [ ] Submit the real form, or POST a Plumber-shaped body to
      `<web app URL>?route=reportsick`. Expect one new row on
      **Report Sick FormSG Responses**.

## 7a. CSV-paste timestamps self-correct

Needs `installTriggers` (README §4) to have been run at least once — this rides the
same `onEdit` trigger as the parade-state pipeline.

- [ ] Paste a few rows of FormSG's CSV export (header included) into
      **Report Sick FormSG Responses**, with the `Timestamp` column landing as plain
      text (e.g. `07 May 2026 19:21:00`). Within the paste's own execution, the cells
      should turn into real, right-aligned dates formatted `dd mmm yyyy hh:mm:ss` —
      no macro run needed.
- [ ] Check **Executions** in the script editor for `FormSgTimestamps.onEditHandler`;
      confirm it logged a converted count and, if the paste had one, an unparsed row.
- [ ] Edit an unrelated cell (a different column, or a different sheet). Confirm
      nothing in `Report Sick FormSG Responses`'s `Timestamp` column changes and no
      matching log line appears.

## 8. The dashboard feed

The feed reads two more tabs and one projection than it used to, so this needs a
**new deployment**, not just a push.

- [ ] Set `DASHBOARD_PASSWORD` under **Project Settings → Script properties** if it is not
      already set. The route fails closed without it, so an unset property refuses every
      request rather than waving one through.
- [ ] POST `{"password":"<the password>"}` to `<web app URL>?route=dashboard` with
      `Content-Type: text/plain`. Expect `ok: true` and a `tabs` object.
- [ ] **The projection.** In that reply, find `tabs["Parade State Responses"]`. Its header
      row must read exactly `["Timestamp","parade_response_id"]`. Search the whole reply
      for a `T`-prefixed NRIC and for the string `Drop your Parade State here`; both must
      be absent. This is the one check worth doing by hand every time the feed changes —
      the message body is free text a duty commander typed, and it carries NRICs.
- [ ] **Before** creating the two settings tabs, confirm `tabs["Public Holidays"]` and
      `tabs["Rotations"]` are absent and the dashboard's Settings page names them as
      missing, with the header row to paste. **After** creating them, confirm both load.
- [ ] POST with a wrong password. Expect `{"ok":false,"error":"unauthorised"}` and no
      `tabs` key at all — not an empty one.

## 9. The published dashboard

- [ ] After the Pages workflow runs, open the site. Confirm it loads (a blank page with a
      404 on an asset means the Vite `base` setting and the Pages sub-path disagree).
- [ ] Log in, then switch light/dark from the sidebar. Confirm the charts re-tint rather
      than staying in the old palette.
