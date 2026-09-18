/**
 * The numbers the dashboard puts on screen.
 *
 * Three rules run through this module, each learned from the data rather than assumed:
 *
 * **Counts are of soldiers, not rows.** A company that files both FPS and LPS lists the
 * same absentee twice, so every headcount deduplicates on identity within a date.
 *
 * **Comparisons are rates, not counts.** In the real data Braves shows 40 MC
 * rows against Hercules' 7, which says nothing until divided by strength — Braves is the
 * larger company. Anything compared across units is expressed as a percentage of the
 * days that unit was observed.
 *
 * **A missing company is stated, never absorbed.** If five of six companies have filed,
 * the battalion total is a total of five companies and the dashboard says so. A headline
 * that quietly omits a company is worse than no headline.
 *
 * Every function here is pure.
 */

import { classify, DUTY_CLASS, extractSymptoms, isAbsent, isRestricted } from './classify.js';
import { identityOf } from './identity.js';
import { COMPANIES, PLATOONS, UNIT_TYPE_COMPANY } from './domain.js';
import { inclusiveDaySpan } from './dates.js';
import { toIsoDate, toNumber, toText } from './values.js';
import { eachDay, withinRange } from './dateRange.js';

/** @type {number} Absolute z-score at or above which a unit is flagged as an outlier. */
export const OUTLIER_Z = 2;

/** @type {string} Bucket label for rows that name no platoon. */
export const UNASSIGNED = 'Unassigned';

/**
 * Sums a list of numbers, ignoring nulls.
 * @param {Array<?number>} values Values to sum.
 * @returns {number} The sum; 0 when the list is empty or all null.
 */
function sum_(values) {
  return values.reduce((total, value) => total + (value === null ? 0 : value), 0);
}

/**
 * The middle value of a list of numbers.
 *
 * Preferred over the mean wherever a single extreme unit or episode would drag the
 * summary away from the typical case — the median moves with the bulk of the data, not
 * with its tail.
 * @param {Array<?number>} values Values to summarise; nulls are dropped, input not mutated.
 * @returns {?number} The median, or null when nothing remains to summarise.
 */
export function median(values) {
  const sorted = values.filter((value) => value !== null && value !== undefined).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Lists the distinct parade dates present in a set of rows, most recent last.
 * @param {Array<!Object>} rows Rows carrying a `date` field.
 * @returns {string[]} Sorted ISO dates.
 */
export function datesPresent(rows) {
  const dates = new Set();
  rows.forEach((row) => {
    const date = toIsoDate(row.date);
    if (date) {
      dates.add(date);
    }
  });
  return Array.from(dates).sort();
}

/**
 * Battalion strength for one date and session.
 *
 * Sums only `unit_type === 'Company'` rows. Summing platoon rows instead would
 * double-count against the company total and would silently drop any company that files
 * no platoon breakdown — Hercules files one line in the samples.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session 'FPS' or 'LPS'.
 * @returns {!Object} Accountable and present strength, plus which companies reported.
 */
export function battalionStrength(strengthRows, isoDate, session) {
  const rows = strengthRows.filter(
    (row) =>
      toIsoDate(row.date) === isoDate &&
      toText(row.session) === session &&
      toText(row.unit_type) === UNIT_TYPE_COMPANY
  );

  const byCompany = new Map();
  rows.forEach((row) => {
    byCompany.set(toText(row.company), {
      company: toText(row.company),
      strength: toNumber(row.total_strength),
      present: toNumber(row.total_present),
    });
  });

  const reported = Array.from(byCompany.values());
  const accountable = sum_(reported.map((entry) => entry.strength));
  const present = sum_(reported.map((entry) => entry.present));
  const reporting = reported.map((entry) => entry.company);

  return {
    date: isoDate,
    session,
    accountable,
    present,
    absent: accountable - present,
    percentPresent: accountable > 0 ? (present / accountable) * 100 : null,
    byCompany: reported.sort((a, b) => a.company.localeCompare(b.company)),
    companiesReporting: reporting,
    companiesMissing: COMPANIES.filter((company) => !reporting.includes(company)),
    isComplete: reporting.length === COMPANIES.length,
  };
}

/**
 * Counts distinct soldiers per duty class on one date.
 *
 * Deduplicates on identity so a soldier listed in both FPS and LPS counts once. Rows
 * with neither a 4D nor a name cannot be attributed to a soldier and are counted
 * separately as `unattributable` rather than dropped.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {?string=} session Session to restrict to, or null for both.
 * @returns {!Object} Per-class distinct soldier counts and totals.
 */
export function dutyCountsOn(personnelRows, isoDate, session) {
  const rows = personnelRows.filter(
    (row) => toIsoDate(row.date) === isoDate && (!session || toText(row.session) === session)
  );

  const seen = new Map();
  let unattributable = 0;
  rows.forEach((row) => {
    const dutyClass = classify(row);
    const identity = identityOf(row);
    if (identity.key === '') {
      unattributable += 1;
      return;
    }
    const bucket = seen.get(dutyClass) || new Set();
    bucket.add(identity.key);
    seen.set(dutyClass, bucket);
  });

  const counts = {};
  let absentTotal = 0;
  let restrictedTotal = 0;
  Object.values(DUTY_CLASS).forEach((dutyClass) => {
    const size = (seen.get(dutyClass) || new Set()).size;
    counts[dutyClass] = size;
    if (isAbsent(dutyClass)) {
      absentTotal += size;
    }
    if (isRestricted(dutyClass)) {
      restrictedTotal += size;
    }
  });

  return { date: isoDate, session: session || null, counts, absentTotal, restrictedTotal, unattributable };
}

/**
 * Counts absence person-days per unit and the pax-days each unit was at risk for.
 *
 * Pax-days is the denominator that makes units of different sizes comparable: a platoon
 * of 55 observed over 4 days contributes 220 pax-days, and its absence person-days
 * divide into that. Company-total rows are excluded from the denominator so a company's
 * strength is not counted twice.
 *
 * `keyOf` decides the grain, which is the only difference between the company and
 * platoon views — both need the same arithmetic and the same z-score against the
 * battalion rate.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} dutyClass Duty class to measure, from DUTY_CLASS.
 * @param {function(!Object): string} keyOf Groups a row into a unit.
 * @returns {Array<!Object>} One entry per unit, with rate and z-score.
 * @private
 */
function rateRows_(personnelRows, strengthRows, dutyClass, keyOf) {
  const paxDays = new Map();
  strengthRows
    .filter((row) => toText(row.unit_type) !== UNIT_TYPE_COMPANY)
    .forEach((row) => {
      const key = keyOf(row);
      paxDays.set(key, (paxDays.get(key) || 0) + (toNumber(row.total_strength) || 0));
    });

  const personDays = new Map();
  // Distinct soldiers per unit, deduped on identity alone: the same soldier out on
  // ten parades is ten person-days but one person. This is the headcount the platoon
  // grid colours by, where `days` is the load a rate divides.
  const persons = new Map();
  personnelRows
    .filter((row) => classify(row) === dutyClass)
    .forEach((row) => {
      const key = keyOf(row);
      const identity = identityOf(row);
      const date = toIsoDate(row.date);
      const bucket = personDays.get(key) || new Set();
      bucket.add(identity.key + '@' + date);
      personDays.set(key, bucket);
      const heads = persons.get(key) || new Set();
      heads.add(identity.key);
      persons.set(key, heads);
    });

  const keys = new Set([...paxDays.keys(), ...personDays.keys()]);
  const rows = Array.from(keys).map((key) => ({
    key,
    days: (personDays.get(key) || new Set()).size,
    people: (persons.get(key) || new Set()).size,
    paxDays: paxDays.get(key) || 0,
  }));

  const totalPaxDays = sum_(rows.map((row) => row.paxDays));
  const battalionRate = totalPaxDays > 0 ? sum_(rows.map((row) => row.days)) / totalPaxDays : 0;

  return rows.map((row) => {
    // Bound to a local rather than read back as `row.z` inside the same object literal:
    // there, `row` is still the input row and `row.z` is undefined, which makes
    // `>= OUTLIER_Z` false for every unit however extreme. Silent, and caught only
    // because a test pins a known outlier.
    const z = zScore_(row.days, row.paxDays, battalionRate);
    return {
      ...row,
      per100: row.paxDays > 0 ? (row.days / row.paxDays) * 100 : null,
      z,
      // Elevated only, not two-tailed. "Is it localised here?" is a question about units
      // losing more days than the battalion, and flagging a unit for losing unusually
      // *few* would put it in a list captioned "worth asking about". The signed z-score
      // stays on every row, so a low outlier is still visible in the table.
      isOutlier: z !== null && z >= OUTLIER_Z,
    };
  });
}

/**
 * Absence rate per company and platoon, with elevated units flagged.
 *
 * Restricted to the `PLATOONS` roll on both sides of the fraction. Filtering the inputs
 * rather than the output is what keeps the z-score honest: the battalion rate this
 * scores against has to be the rate among the platoons being compared, and leaving a
 * command element's pax-days or a company's unattributed absences in the baseline would
 * measure each platoon against a battalion it is not part of.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} dutyClass Duty class to measure, from DUTY_CLASS.
 * @returns {Array<!Object>} One entry per company/platoon on the roll.
 */
export function unitRates(personnelRows, strengthRows, dutyClass) {
  const onRoll = (row) => PLATOONS.indexOf(toText(row.platoon)) >= 0;
  const keyOf = (row) => toText(row.company) + '|' + toText(row.platoon);
  return rateRows_(
    personnelRows.filter(onRoll),
    strengthRows.filter(onRoll),
    dutyClass,
    keyOf
  )
    .map((row) => {
      const [company, platoon] = row.key.split('|');
      return { ...row, company, platoon };
    })
    .sort((a, b) => a.company.localeCompare(b.company) || a.platoon.localeCompare(b.platoon));
}

/**
 * Absence rate per company, with elevated companies flagged.
 *
 * A separate roll-up rather than a sum of `unitRates`, because the z-score has to be
 * recomputed at this level: a company's denominator is the sum of its platoons', and a
 * z-score computed per platoon says nothing about the company that contains them.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} dutyClass Duty class to measure, from DUTY_CLASS.
 * @returns {Array<!Object>} One entry per company, highest rate first.
 */
export function companyRates(personnelRows, strengthRows, dutyClass) {
  return rateRows_(personnelRows, strengthRows, dutyClass, (row) => toText(row.company))
    .filter((row) => row.key !== '')
    .map((row) => ({ ...row, company: row.key }))
    .sort((a, b) => (b.per100 || 0) - (a.per100 || 0));
}

/**
 * Scores how far a unit's absence count sits from the battalion rate.
 *
 * A normal approximation to the binomial: with n pax-days at battalion rate p, a unit is
 * expected to lose n*p days with standard deviation sqrt(n*p*(1-p)). This is what
 * separates "a small platoon had three MCs" from "this platoon is an outlier" — the
 * former is noise in a small denominator and the z-score says so.
 * @param {number} days Observed absence person-days.
 * @param {number} paxDays The unit's pax-days.
 * @param {number} rate Battalion-wide rate, as a proportion.
 * @returns {?number} The z-score, or null when there is too little to compare.
 */
function zScore_(days, paxDays, rate) {
  if (paxDays <= 0 || rate <= 0 || rate >= 1) {
    return null;
  }
  const sd = Math.sqrt(paxDays * rate * (1 - rate));
  return sd > 0 ? (days - paxDays * rate) / sd : null;
}

/**
 * The absence reasons shown as a breakdown, in a fixed order.
 *
 * `Report Sick` is deliberately absent: it is an event, not a state — a soldier reports
 * sick and is then on MC, on status, or back on parade. Listing it beside the states
 * would count the same soldier twice in a breakdown that must sum.
 * @type {Array<{label: string, dutyClass: string}>}
 */
export const ABSENCE_REASONS = [
  { label: 'Att C', dutyClass: DUTY_CLASS.ATT_C },
  { label: 'Duty / course', dutyClass: DUTY_CLASS.OTHERS },
  { label: 'Medical appt', dutyClass: DUTY_CLASS.MA },
  { label: 'Off / leave', dutyClass: DUTY_CLASS.OFF_LEAVE },
];

/**
 * Composition of accountable strength for one parade: who can be employed today.
 *
 * Three parts that always sum to accountable strength, which is what makes this
 * answerable as one whole:
 *
 *   present, full duty  =  present  -  on status
 *   present, restricted =  on status          (Att B / LD: here, excused some activities)
 *   absent              =  accountable - present
 *
 * `Status` sits inside `present` rather than beside it. Folding it into absence would be
 * the single most misleading thing this dashboard could do — those soldiers are on
 * parade — so it is shown as its own part of the present block.
 *
 * The strength lines are authoritative for present and absent; the absentee list is
 * authoritative for reasons. The two are written by hand and need not agree, so the
 * difference is reported as `unaccounted` rather than hidden by trusting one of them.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @returns {!Object} The three parts, the named absence reasons, and the residual.
 */
export function employability(strengthRows, personnelRows, isoDate, session) {
  const strength = battalionStrength(strengthRows, isoDate, session);
  const duty = dutyCountsOn(personnelRows, isoDate, session);

  // Capped at present: a status count exceeding the present figure would drive
  // "full duty" negative, and a negative slice cannot be drawn or believed.
  const restricted = Math.min(duty.restrictedTotal, strength.present);
  const reasons = ABSENCE_REASONS.map((reason) => ({
    label: reason.label,
    dutyClass: reason.dutyClass,
    count: duty.counts[reason.dutyClass] || 0,
  }));
  const named = sum_(reasons.map((reason) => reason.count));

  return {
    date: isoDate,
    accountable: strength.accountable,
    present: strength.present,
    presentFull: strength.present - restricted,
    restricted,
    absent: strength.absent,
    percentPresent: strength.percentPresent,
    reasons,
    named,
    // Positive: absentees the strength lines count but the absentee list does not name.
    // Negative: more names than the strength gap accounts for.
    unaccounted: strength.absent - named,
    companiesReporting: strength.companiesReporting,
    companiesMissing: strength.companiesMissing,
    isComplete: strength.isComplete,
  };
}

/**
 * The sheet's own categories, in the fixed order the strength donut draws them.
 *
 * Order is part of the contract, not a presentation detail. The slices are drawn round
 * the ring in this sequence and take their colour from their position, so a category
 * keeps its colour whatever its size that day — the alternative, colouring by rank,
 * repaints every slice as soon as one company files.
 *
 * The sequence is also the story: the three that are on parade first, then the four that
 * are not, so the ring reads as one arc of present and one arc of absent rather than
 * seven unrelated wedges.
 *
 * `Full duty` carries no category because it is the residual — the soldiers the parade
 * state files nothing about, who are therefore on full duty.
 * @type {Array<{label: string, dutyClass: ?string, here: boolean}>}
 */
export const PARADE_MIX = [
  { label: 'Full duty', dutyClass: null, here: true },
  { label: 'Duty / course', dutyClass: DUTY_CLASS.OTHERS, here: true },
  { label: 'Att B / LD', dutyClass: DUTY_CLASS.STATUS, here: true },
  { label: 'Att C', dutyClass: DUTY_CLASS.ATT_C, here: false },
  { label: 'Report sick', dutyClass: DUTY_CLASS.REPORT_SICK, here: false },
  { label: 'MA', dutyClass: DUTY_CLASS.MA, here: false },
  { label: 'Off / leave', dutyClass: DUTY_CLASS.OFF_LEAVE, here: false },
];

/**
 * Which category wins when one soldier is filed under several on the same date.
 *
 * The real data needs this and a naive count gets it wrong: in the labelled examples
 * Archer files twelve soldiers under two or three categories at once — one under Status,
 * MA and Report Sick together — and 235 rows resolve to 201 soldiers. Counting rows
 * would inflate a whole-strength breakdown past the strength it is drawn against.
 *
 * Absence outranks presence, and within absence the longer commitment outranks the
 * shorter: a soldier on MC who also has an appointment logged is on MC. `Status` ranks
 * last because it is the one class that does not stop a soldier being somewhere else.
 * @type {string[]}
 */
const MIX_PRECEDENCE = [
  DUTY_CLASS.ATT_C,
  DUTY_CLASS.OFF_LEAVE,
  DUTY_CLASS.MA,
  DUTY_CLASS.REPORT_SICK,
  DUTY_CLASS.OTHERS,
  DUTY_CLASS.STATUS,
];

/**
 * Assigns each soldier on a date to exactly one category, by precedence.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @returns {!Object} Per-category distinct soldier counts, plus the uncategorised count.
 * @private
 */
function soleCategoryCounts_(personnelRows, isoDate, session) {
  // -1 marks a soldier seen only under a category this dashboard does not know, which
  // is how an upstream enum change arrives. They are counted rather than dropped, so a
  // rename upstream shows up as a stated figure instead of quietly swelling `Full duty`.
  const best = new Map();
  personnelRows
    .filter((row) => toIsoDate(row.date) === isoDate && toText(row.session) === session)
    .forEach((row) => {
      const identity = identityOf(row);
      if (identity.key === '') {
        return;
      }
      const rank = MIX_PRECEDENCE.indexOf(classify(row));
      const current = best.get(identity.key);
      if (current === undefined || (rank >= 0 && (current === -1 || rank < current))) {
        best.set(identity.key, rank);
      }
    });

  const counts = {};
  MIX_PRECEDENCE.forEach((dutyClass) => {
    counts[dutyClass] = 0;
  });
  let unknown = 0;
  best.forEach((rank) => {
    if (rank < 0) {
      unknown += 1;
    } else {
      counts[MIX_PRECEDENCE[rank]] += 1;
    }
  });
  return { counts, unknown };
}

/**
 * Accountable strength split by the sheet's own reason categories.
 *
 * Every soldier lands in exactly one slice and the slices sum to accountable strength,
 * which is what lets this be drawn as a whole. Two things make that true rather than
 * assumed:
 *
 * - **One category per soldier**, by `MIX_PRECEDENCE`. Without it the same soldier is
 *   counted under Status and MA and Report Sick, and the parts exceed the whole.
 * - **`Full duty` is the residual**, not a figure of its own: accountable strength less
 *   everyone the parade state filed a reason for. Soldiers filed under a category this
 *   dashboard does not recognise fall in here too, and are counted separately as
 *   `unknown` so the view can say so rather than let them pass as full duty.
 *
 * What it deliberately does not claim: that this present/absent split equals the one on
 * the strength line. It usually does not. `Others` is the reason — the category holds
 * guard duty, which is served in camp and counted present, alongside medical-centre
 * appointments, which are not, and the sheet records no `in_camp` value to separate them
 * (80 of 86 `Others` rows in the labelled data leave it blank). So the two figures are
 * both reported and their difference is returned as `parity`, for the view to state
 * rather than reconcile by picking a favourite.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @returns {!Object} The slices, the totals they roll up to, and the strength-line gap.
 */
export function strengthMix(strengthRows, personnelRows, isoDate, session) {
  const strength = battalionStrength(strengthRows, isoDate, session);
  const { counts, unknown } = soleCategoryCounts_(personnelRows, isoDate, session);

  const filed = PARADE_MIX.filter((entry) => entry.dutyClass !== null).map((entry) => ({
    ...entry,
    count: counts[entry.dutyClass] || 0,
  }));
  const named = sum_(filed.map((entry) => entry.count));

  // Clamped, because a company can file an absentee list without a strength line and
  // drive this negative. A negative slice cannot be drawn; the shortfall is reported as
  // `overflow` so the view can say the parts outrun the whole instead of hiding it.
  const fullDuty = Math.max(0, strength.accountable - named);
  const overflow = Math.max(0, named - strength.accountable);

  const slices = PARADE_MIX.map((entry) =>
    entry.dutyClass === null
      ? { ...entry, count: fullDuty }
      : { ...entry, count: counts[entry.dutyClass] || 0 }
  );

  const here = sum_(slices.filter((slice) => slice.here).map((slice) => slice.count));
  const away = sum_(slices.filter((slice) => !slice.here).map((slice) => slice.count));

  return {
    date: isoDate,
    session,
    accountable: strength.accountable,
    slices,
    here,
    away,
    named,
    unknown,
    overflow,
    // Signed. Positive: this breakdown puts more soldiers on parade than the strength
    // line does. The two are written by hand in different parts of the same message.
    parity: strength.present === null ? null : here - strength.present,
    presentLine: strength.present,
    companiesReporting: strength.companiesReporting,
    companiesMissing: strength.companiesMissing,
    isComplete: strength.isComplete,
  };
}

/**
 * The length of an episode in days, for the long-MC test.
 *
 * The stated day count wins when the message gave one, exactly as the rest of the Att
 * C section reads duration. With no stated count it is the start-to-end span, where a
 * missing `start_date` has already fallen back to the first parade date the soldier
 * was seen absent and a missing `end_date` to the last.
 * @param {!Object} episode An episode from `buildEpisodes`.
 * @returns {number} The length in whole days.
 */
function episodeDays_(episode) {
  if (episode.statedDays !== null && episode.statedDays > 0) {
    return episode.statedDays;
  }
  return inclusiveDaySpan(episode.startDate, episode.endDate);
}

/**
 * The long episodes of one duty class: length greater than `minDays`.
 * @param {Array<!Object>} episodes Episodes to filter.
 * @param {string} dutyClass Duty class to keep, from DUTY_CLASS.
 * @param {number} minDays Length a long episode must exceed.
 * @returns {Array<!Object>} The matching episodes.
 */
function longEpisodes_(episodes, dutyClass, minDays) {
  return episodes.filter(
    (episode) =>
      episode.dutyClass === dutyClass &&
      episode.startDate &&
      episode.endDate &&
      episodeDays_(episode) > minDays
  );
}

/**
 * How many distinct soldiers are on a long episode of `dutyClass` on each calendar day.
 *
 * A long MC is one that lasts more than `minDays` days. A soldier is counted on every
 * day their episode covers, `[startDate, endDate]` inclusive, so a fortnight's MC adds
 * one to fourteen days of the line. Two overlapping long episodes for the same soldier
 * still count once, because the question is how many people are away, not how many
 * certificates are open.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {?string} fromIso First day to report, ISO 'yyyy-MM-dd'.
 * @param {?string} toIso Last day to report, ISO 'yyyy-MM-dd'.
 * @param {string} dutyClass Duty class to trend, from DUTY_CLASS.
 * @param {number=} minDays Length a long episode must exceed; defaults to 4.
 * @returns {Array<{date: string, count: number}>} One entry per day, oldest first.
 */
export function longMcTrend(episodes, fromIso, toIso, dutyClass, minDays = 4) {
  const long = longEpisodes_(episodes, dutyClass, minDays);
  return eachDay(fromIso, toIso).map((day) => {
    const soldiers = new Set();
    long.forEach((episode) => {
      if (withinRange(day, episode.startDate, episode.endDate)) {
        soldiers.add(episode.key);
      }
    });
    return { date: day, count: soldiers.size };
  });
}

/**
 * One row per long episode of `dutyClass`, longest first.
 *
 * One person with two long episodes appears twice: each long MC is its own row, since
 * the table answers "which are the longest MCs, and whose". Ties break on the earlier
 * start date.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {string} dutyClass Duty class to list, from DUTY_CLASS.
 * @param {number=} minDays Length a long episode must exceed; defaults to 4.
 * @returns {Array<!Object>} One row per long episode, longest first.
 */
export function longMcRoster(episodes, dutyClass, minDays = 4) {
  return longEpisodes_(episodes, dutyClass, minDays)
    .map((episode) => ({
      key: episode.key,
      fourD: episode.fourD,
      name: episode.name,
      rank: episode.rank,
      company: episode.company,
      platoon: episode.platoon || UNASSIGNED,
      days: episodeDays_(episode),
      startDate: episode.startDate,
      endDate: episode.endDate,
    }))
    .sort((a, b) => b.days - a.days || a.startDate.localeCompare(b.startDate));
}

/**
 * Soldiers with the most episodes of one duty class.
 *
 * Ranked by number of separate episodes, then by days lost. Deliberately plain
 * arithmetic: it reports what was recorded and infers nothing about why, which is the
 * only claim a parade state can support. A soldier managing a chronic condition and a
 * soldier avoiding training appear the same way here, and the difference is a
 * conversation, not a number.
 * @param {Array<!Object>} episodes Episodes to rank.
 * @param {string} dutyClass Duty class to rank, from DUTY_CLASS.
 * @returns {Array<!Object>} One entry per soldier, most episodes first.
 */
export function leaderboard(episodes, dutyClass) {
  const bySoldier = new Map();
  episodes
    .filter((episode) => episode.dutyClass === dutyClass)
    .forEach((episode) => {
      const entry = bySoldier.get(episode.key) || {
        key: episode.key,
        fourD: episode.fourD,
        name: episode.name,
        rank: episode.rank,
        company: episode.company,
        platoon: episode.platoon || UNASSIGNED,
        episodes: 0,
        daysLost: 0,
        lastStart: null,
      };
      entry.episodes += 1;
      entry.daysLost += episode.daysLost;
      entry.name = episode.name || entry.name;
      entry.company = episode.company || entry.company;
      if (!entry.lastStart || (episode.startDate && episode.startDate > entry.lastStart)) {
        entry.lastStart = episode.startDate;
      }
      bySoldier.set(episode.key, entry);
    });

  return Array.from(bySoldier.values()).sort(
    (a, b) => b.episodes - a.episodes || b.daysLost - a.daysLost
  );
}

/**
 * Groups episodes by a key, counting episodes and distinct soldiers per group.
 *
 * Groups whose key is blank are dropped: an episode naming no company or no platoon has
 * no bar to stand on. It is still counted toward the battalion total by the caller.
 * @param {Array<!Object>} episodes Episodes to group.
 * @param {function(!Object): string} keyOf Reads the grouping key from an episode.
 * @returns {Array<{key: string, episodes: number, soldiers: number}>} One entry per key.
 */
function countGroups_(episodes, keyOf) {
  const groups = new Map();
  episodes.forEach((episode) => {
    const key = keyOf(episode);
    if (key === '') {
      return;
    }
    const group = groups.get(key) || { key, episodes: 0, soldiers: new Set() };
    group.episodes += 1;
    group.soldiers.add(episode.key);
    groups.set(key, group);
  });
  return Array.from(groups.values()).map((group) => ({
    key: group.key,
    episodes: group.episodes,
    soldiers: group.soldiers.size,
  }));
}

/**
 * The volume of one duty class split two ways: how many episodes, how many soldiers.
 *
 * The episode count answers "how many times did this unit go into this state"; the
 * soldier count answers "how many different people was that". The distance between the
 * two is the repeat load — six soldiers filing thirty MCs is a different problem from
 * thirty soldiers filing one each.
 *
 * This is a raw volume, not a size-fair rate: a bigger unit sits higher on both counts
 * for being bigger. `companyRates` / `unitRates` are the comparison; this sits beside
 * them. The battalion and per-platoon soldier counts are taken from the episode list
 * whole, never summed from `byCompany`: a soldier who files under two companies across
 * the range is one soldier to the battalion but a member of two company groups.
 * @param {Array<!Object>} episodes Episodes to count, any duty class.
 * @param {string} dutyClass Duty class to keep, from DUTY_CLASS.
 * @returns {{byCompany: Array<{key: string, episodes: number, soldiers: number}>,
 *   byPlatoon: Array<{key: string, episodes: number, soldiers: number}>,
 *   total: {episodes: number, soldiers: number, perSoldier: ?number}}} Company groups
 *   most-episodes first, platoon groups in roll order, and the battalion total with
 *   episodes per soldier (null when no soldier was counted).
 */
export function episodeCounts(episodes, dutyClass) {
  const scoped = episodes.filter((episode) => episode.dutyClass === dutyClass);

  const byCompany = countGroups_(scoped, (episode) => toText(episode.company)).sort(
    (a, b) => b.episodes - a.episodes || a.key.localeCompare(b.key)
  );

  const byPlatoonKey = new Map(
    countGroups_(scoped, (episode) => toText(episode.platoon)).map((group) => [group.key, group])
  );
  const byPlatoon = PLATOONS.map((key) => byPlatoonKey.get(key)).filter(Boolean);

  const soldiers = new Set(scoped.map((episode) => episode.key)).size;
  return {
    byCompany,
    byPlatoon,
    total: {
      episodes: scoped.length,
      soldiers,
      perSoldier: soldiers > 0 ? scoped.length / soldiers : null,
    },
  };
}

/**
 * The most common reasons given for one duty class on one date.
 *
 * Answers "what are they reporting sick with today", which a bare count cannot. Reads
 * the symptom lexicon first and falls back to the raw reason text, so a wording the
 * lexicon has not learned still appears rather than vanishing into an "other" bucket.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @param {string} dutyClass Duty class to read, from DUTY_CLASS.
 * @param {number=} limit How many to return; defaults to 3.
 * @returns {Array<{label: string, count: number}>} Reasons, most common first.
 */
export function topReasonsOn(personnelRows, isoDate, session, dutyClass, limit) {
  const counts = new Map();
  personnelRows
    .filter(
      (row) =>
        toIsoDate(row.date) === isoDate &&
        toText(row.session) === session &&
        classify(row) === dutyClass
    )
    .forEach((row) => {
      const symptoms = extractSymptoms(row.reason);
      const labels = symptoms.length > 0 ? symptoms : [];
      labels.forEach((label) => counts.set(label, (counts.get(label) || 0) + 1));
    });

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit || 3);
}

/**
 * Measures how complete the personnel data is on the fields the dashboard depends on.
 *
 * Surfaced as a badge rather than kept quiet: an "unassigned" bar in the platoon heatmap
 * means something different when 5% of rows lack a platoon than when 40% do, and the
 * viewer cannot tell which without this.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @returns {!Object} Row count and the share present for each key field.
 */
export function dataQuality(personnelRows) {
  const total = personnelRows.length;
  const share = (predicate) => (total > 0 ? personnelRows.filter(predicate).length / total : null);
  return {
    total,
    platoon: share((row) => toText(row.platoon) !== ''),
    fourD: share((row) => toText(row.four_d) !== ''),
    startDate: share((row) => toIsoDate(row.start_date) !== null),
    numDays: share((row) => toNumber(row.num_days) !== null),
  };
}
