/**
 * The report-sick flow: parade state to FormSG, then type, then outcome, and — for a
 * Status outcome — which restriction it became.
 *
 * Five stages, columns:
 *
 *   Reporting sick / Unaccounted                 (parade state, aggregate)
 *     -> Reported sick / No FormSG submission     (FormSG, aggregate)
 *     -> Type (RSI / RSO / FFI / Medical Review / not recorded)
 *     -> Outcome (MC / Status / none recorded)
 *     -> Status bucket, for the Status outcome only
 *
 * **The left join is aggregate, not event-level.** It hands the in-range report-sick
 * episodes and the in-range FormSG submissions to `reconcile.js`'s `reconcileReportSick`,
 * which lines the two sources up *per company* — distinct soldiers on the parade state
 * against distinct soldiers on the form, matched by token-set name — and this diagram
 * sums those per-company rows. So
 * `Reporting sick -> Reported sick` is the soldiers seen in both sources,
 * `Reporting sick -> No FormSG submission` the parade-state-only remainder, and
 * `Unaccounted -> Reported sick` the soldiers who filed a form with no parade-state line
 * behind it. These three numbers are distinct soldiers, not events.
 *
 * **The right side stays event-level and hangs off the FormSG side only.** Every in-range
 * submission is one flow: through its `Report Sick Type` answer, then forward to whatever
 * MC or Status followed it within two days (`outcomeFor_`, which needs only the soldier's
 * own personnel rows in that window, not the parade<->FormSG match). Because one soldier
 * can file several submissions, the FormSG branch's throughput can exceed the
 * `Reported sick` node's inflow; `coverage.submissionFanout` flags exactly that. The
 * parade-only branch terminates at `No FormSG submission` — no form, so no type and no
 * outcome.
 *
 * **Nothing is dropped to make the diagram tidy.** An unmatched soldier or submission
 * gets its own branch rather than being discarded. A company that files zero FormSG
 * submissions is named in `coverage.companiesWithNoFormSg` — a fact about a missing form
 * channel, not about that company's health. A Status row naming several restrictions fans
 * out to several bucket links, so the Status stage's outflow can exceed its inflow;
 * `coverage.statusMultiLabelled` flags that rather than letting the diagram imply the
 * parts sum to the whole.
 *
 * Every function here is pure.
 */

import { classify, DUTY_CLASS } from './classify.js';
import { COMPANIES } from './domain.js';
import { addDays } from './dates.js';
import { withinRange } from './dateRange.js';
import { namesMatch } from './reconcile.js';
import { bucketsFor } from './statusBuckets.js';
import { toIsoDate, toText } from './values.js';
import { reconcileReportSick } from './reconcile.js';

/** @type {number} Earliest an outcome may start after the report-sick event, inclusive. */
export const OUTCOME_MATCH_MIN_DAYS = 0;

/** @type {number} Latest an outcome may start after the report-sick event, inclusive. */
export const OUTCOME_MATCH_MAX_DAYS = 2;

/** @type {string} The type-stage label for a submission with no recorded type. */
const TYPE_NOT_RECORDED = 'Type not recorded';

/** @type {!Object<string, string>} FormSG's verbatim type answers, shortened. */
const TYPE_LABELS = {
  'Report Sick In-Camp (RSI)': 'RSI',
  'Report Sick Outside (RSO)': 'RSO',
  'Medical Review': 'Medical Review',
  FFI: 'FFI',
};

/** @type {string} The outcome-stage label for an MC outcome. */
const OUTCOME_MC = 'MC';

/** @type {string} The outcome-stage label for a Status outcome. */
const OUTCOME_STATUS = 'Status';

/** @type {string} The outcome-stage label when nothing followed. */
const OUTCOME_NONE = 'None recorded';

/** @type {string} The reporting-stage node for soldiers on the parade state. */
const NODE_REPORTING = 'Reporting sick';

/** @type {string} The reporting-stage node for form-only soldiers. */
const NODE_UNACCOUNTED = 'Unaccounted';

/** @type {string} The reported-stage node for soldiers on the form. */
const NODE_REPORTED = 'Reported sick';

/** @type {string} The reported-stage node for the parade-state-only remainder. */
const NODE_NO_FORMSG = 'No FormSG submission';

/**
 * The date a report-sick episode's flow is measured from.
 * @param {!Object} episode An episode from `buildEpisodes`.
 * @returns {?string} ISO 'yyyy-MM-dd', or null when the episode names no date at all.
 */
function episodeEventDate_(episode) {
  return episode.startDate || episode.paradeDates[0] || null;
}

/**
 * The short type label for a FormSG type answer.
 * @param {string} reportSickType Raw 'Report Sick Type' answer.
 * @returns {string} A TYPE_LABELS value, or TYPE_NOT_RECORDED.
 */
function shortType_(reportSickType) {
  return TYPE_LABELS[toText(reportSickType)] || TYPE_NOT_RECORDED;
}

/**
 * Finds what followed a report-sick event: an MC, a Status, or nothing.
 *
 * MC wins when both occur, because Att C means excused all duties — the more
 * consequential outcome — and a single flow cannot fork.
 * @param {string} name The event's reported name.
 * @param {string} eventDate The event's ISO date.
 * @param {Array<!Object>} personnel Normalised Personnel Data records.
 * @returns {{outcome: string, buckets: string[]}} The outcome, and — for Status — every
 *     bucket its reason names.
 */
function outcomeFor_(name, eventDate, personnel) {
  const windowStart = addDays(eventDate, OUTCOME_MATCH_MIN_DAYS);
  const windowEnd = addDays(eventDate, OUTCOME_MATCH_MAX_DAYS);

  const candidates = personnel.filter((row) => {
    if (!namesMatch(name, row.name)) {
      return false;
    }
    const dutyClass = classify(row);
    if (dutyClass !== DUTY_CLASS.ATT_C && dutyClass !== DUTY_CLASS.STATUS) {
      return false;
    }
    const candidateDate = toIsoDate(row.start_date) || toIsoDate(row.date);
    return candidateDate !== null && candidateDate >= windowStart && candidateDate <= windowEnd;
  });

  const mc = candidates.find((row) => classify(row) === DUTY_CLASS.ATT_C);
  if (mc) {
    return { outcome: OUTCOME_MC, buckets: [] };
  }

  const status = candidates
    .filter((row) => classify(row) === DUTY_CLASS.STATUS)
    .sort((a, b) => (toIsoDate(a.start_date) || toIsoDate(a.date)).localeCompare(toIsoDate(b.start_date) || toIsoDate(b.date)))[0];
  if (status) {
    return { outcome: OUTCOME_STATUS, buckets: bucketsFor(status.reason) };
  }

  return { outcome: OUTCOME_NONE, buckets: [] };
}

/**
 * Adds to a link's running total, creating it at 0 if new.
 * @param {!Map<string, number>} links Link totals keyed by "source|target".
 * @param {string} source Source node name.
 * @param {string} target Target node name.
 * @param {number=} amount Amount to add; defaults to 1.
 * @returns {void}
 */
function addLink_(links, source, target, amount) {
  const key = source + '|' + target;
  links.set(key, (links.get(key) || 0) + (amount === undefined ? 1 : amount));
}

/**
 * Builds the report-sick Sankey: nodes, links, and the coverage a reader is owed.
 * @param {{personnel: Array<!Object>, episodes: Array<!Object>, submissions:
 *     Array<!Object>, from: ?string, to: ?string}} args The dataset's personnel rows and
 *     episodes, its FormSG submissions, and the date range to draw.
 * @returns {{nodes: Array<{name: string, stage: string}>, links: Array<{source: string,
 *     target: string, value: number}>, coverage: !Object}} The diagram and its coverage.
 */
export function reportSickFlow({ personnel, episodes, submissions, from, to }) {
  const reportSickEpisodes = (episodes || []).filter((episode) => {
    if (episode.dutyClass !== DUTY_CLASS.REPORT_SICK) {
      return false;
    }
    const date = episodeEventDate_(episode);
    return date !== null && withinRange(date, from, to);
  });
  const subsInRange = (submissions || []).filter(
    (submission) => submission.date && withinRange(submission.date, from, to)
  );

  // Left side: aggregate per-company reconcile, summed to battalion totals.
  const perCompanyRows = reconcileReportSick(reportSickEpisodes, subsInRange);
  const paradeCount = perCompanyRows.reduce((sum, row) => sum + row.paradeCount, 0);
  const formsgCount = perCompanyRows.reduce((sum, row) => sum + row.formsgCount, 0);
  const matched = perCompanyRows.reduce((sum, row) => sum + row.matched, 0);
  const paradeOnly = paradeCount - matched;
  const unaccounted = formsgCount - matched;

  const links = new Map();
  const nodeStage = new Map();

  /**
   * Registers a node/link only when the flow carries something, so empty inputs yield an
   * empty diagram.
   * @param {string} source Source node name.
   * @param {string} sourceStage Source node's stage.
   * @param {string} target Target node name.
   * @param {string} targetStage Target node's stage.
   * @param {number} value Flow value.
   * @returns {void}
   */
  function addFlow(source, sourceStage, target, targetStage, value) {
    if (value > 0) {
      nodeStage.set(source, sourceStage);
      nodeStage.set(target, targetStage);
      addLink_(links, source, target, value);
    }
  }

  addFlow(NODE_REPORTING, 'reporting', NODE_REPORTED, 'reported', matched);
  addFlow(NODE_REPORTING, 'reporting', NODE_NO_FORMSG, 'reported', paradeOnly);
  addFlow(NODE_UNACCOUNTED, 'reporting', NODE_REPORTED, 'reported', unaccounted);

  // Right side: event-level, one flow per in-range submission.
  let statusOutcomeTotal = 0;
  let statusBucketTotal = 0;

  subsInRange.forEach((submission) => {
    const typeNode = 'Type: ' + shortType_(submission.reportSickType);
    addFlow(NODE_REPORTED, 'reported', typeNode, 'type', 1);

    const { outcome, buckets } = outcomeFor_(submission.name, submission.date, personnel);
    const outcomeNode = 'Outcome: ' + outcome;
    addFlow(typeNode, 'type', outcomeNode, 'outcome', 1);

    if (outcome === OUTCOME_STATUS) {
      statusOutcomeTotal += 1;
      buckets.forEach((bucket) => {
        addFlow(outcomeNode, 'outcome', 'Status: ' + bucket, 'status', 1);
        statusBucketTotal += 1;
      });
    }
  });

  const nodes = Array.from(nodeStage.entries()).map(([name, stage]) => ({ name, stage }));
  const linkList = Array.from(links.entries()).map(([key, value]) => {
    const [source, target] = key.split('|');
    return { source, target, value };
  });

  return {
    nodes,
    links: linkList,
    coverage: {
      reportingSick: paradeCount,
      reportedSick: formsgCount,
      matched,
      paradeOnly,
      unaccounted,
      submissions: subsInRange.length,
      submissionFanout: subsInRange.length > formsgCount,
      byCompany: perCompanyRows,
      companiesWithNoFormSg: COMPANIES.filter((company) =>
        subsInRange.every((submission) => submission.company !== company)
      ),
      statusMultiLabelled: statusBucketTotal > statusOutcomeTotal,
      matchRule:
        'Reconciled per company by token-set name; left-side counts are distinct ' +
        'soldiers, not events. Type and outcome are per FormSG submission, so that branch ' +
        'can be wider. Outcomes cover the FormSG branch only.',
    },
  };
}
