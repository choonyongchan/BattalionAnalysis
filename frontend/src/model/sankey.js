/**
 * The report-sick flow: a Sankey from the parade state through FormSG to the doctor's
 * outcome and, for a Status outcome, which restriction it became.
 *
 * Five stages, columns:
 *
 *   Reporting sick / Unaccounted                 (parade-state report-sick episodes)
 *     -> Reported sick / No FormSG submission     (FormSG submissions)
 *     -> Type (RSO / RSI / FFI / Medical Review / not recorded)
 *     -> Outcome (MC / Status / MC and Status / No MC or Status / not recorded)
 *     -> Status bucket, for submissions whose outcome includes a Status
 *
 * **The first link is not reconciled.** No name, 4D or company matching links the parade
 * state to FormSG; each side is a plain count, poured into the other in order (`channel_`).
 * So when fewer soldiers report sick on the parade state than on FormSG, every `Reporting
 * sick` flows into `Reported sick` and the surplus submissions come from `Unaccounted`;
 * when more do, the surplus parade-state reports end at `No FormSG submission`.
 *
 * **Everything after `Reported sick` is one submission's own answers.** Type, outcome and
 * Status are all fields of the same FormSG response, so each submission is followed
 * exactly and nothing downstream can outnumber the submissions. A submission filed before
 * the soldier saw the MO has no outcome yet and ends at `Outcome: Not recorded`.
 *
 * Every function here is pure.
 */

import { DUTY_CLASS } from './classify.js';
import { withinRange } from './dateRange.js';
import { REPORT_SICK_TYPES, reportSickTypeOf } from './formsg.js';
import { STATUS_BUCKETS, bucketsFor } from './statusBuckets.js';

/** @type {string} The type-stage label for a submission with no recorded type. */
const TYPE_NOT_RECORDED = 'Type not recorded';

/** @type {string} The reporting-stage node for parade-state report-sick episodes. */
const NODE_REPORTING = 'Reporting sick';

/** @type {string} The reporting-stage node for submissions past the parade-state count. */
const NODE_UNACCOUNTED = 'Unaccounted';

/** @type {string} The reported-stage node for FormSG submissions. */
const NODE_REPORTED = 'Reported sick';

/** @type {string} The reported-stage node for parade-state reports past the FormSG count. */
const NODE_NO_FORMSG = 'No FormSG submission';

/**
 * The outcome-stage nodes in column order, keyed by the stored FormSG outcome; '' is a
 * submission whose outcome is still blank, and must stay last as the fallback.
 * @type {!Array<{outcome: string, name: string}>}
 */
const OUTCOME_NODES = [
  { outcome: 'MC', name: 'Outcome: MC' },
  { outcome: 'Status', name: 'Outcome: Status' },
  { outcome: 'Both', name: 'Outcome: MC and Status' },
  { outcome: 'None', name: 'Outcome: No MC or Status' },
  { outcome: '', name: 'Outcome: Not recorded' },
];

/** @type {!Set<string>} Outcomes that carry a Status, and so flow on to a bucket. */
const STATUS_OUTCOMES = new Set(['Status', 'Both']);

/**
 * Pours ordered sources into ordered targets, filling each target before the next.
 *
 * The flow carried is the smaller of the two totals: whatever source or target capacity
 * is left over has nowhere to go and yields no link.
 * @param {Array<{name: string, count: number}>} sources Source nodes and their totals.
 * @param {Array<{name: string, count: number}>} targets Target nodes and their capacities.
 * @returns {Array<{source: string, target: string, value: number}>} Positive links only.
 */
function channel_(sources, targets) {
  const remaining = targets.map((target) => target.count);
  const links = [];
  let targetIndex = 0;
  sources.forEach((source) => {
    let left = source.count;
    while (left > 0 && targetIndex < targets.length) {
      const value = Math.min(left, remaining[targetIndex]);
      if (value > 0) {
        links.push({ source: source.name, target: targets[targetIndex].name, value });
      }
      left -= value;
      remaining[targetIndex] -= value;
      if (remaining[targetIndex] === 0) {
        targetIndex += 1;
      }
    }
  });
  return links;
}

/**
 * Counts in-range episodes of one duty class, by the date each starts.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {string} dutyClass A DUTY_CLASS value.
 * @param {?string} from Inclusive ISO start, or null for unbounded.
 * @param {?string} to Inclusive ISO end, or null for unbounded.
 * @returns {Array<!Object>} The matching episodes.
 */
function episodesInRange_(episodes, dutyClass, from, to) {
  return (episodes || []).filter((episode) => {
    const date = episode.startDate || episode.paradeDates[0] || null;
    return episode.dutyClass === dutyClass && date !== null && withinRange(date, from, to);
  });
}

/**
 * The type-stage node a submission belongs to.
 * @param {!Object} submission A normalised submission.
 * @returns {string} A `Type: ...` node name.
 */
function typeNodeOf_(submission) {
  const code = reportSickTypeOf(submission);
  const type = REPORT_SICK_TYPES.find((entry) => entry.name === code);
  return 'Type: ' + (type ? type.label : TYPE_NOT_RECORDED);
}

/**
 * The outcome-stage node a submission belongs to; an unknown value reads as not recorded.
 * @param {!Object} submission A normalised submission.
 * @returns {string} An `Outcome: ...` node name.
 */
function outcomeNodeOf_(submission) {
  const node = OUTCOME_NODES.find((entry) => entry.outcome === submission.outcome);
  return (node || OUTCOME_NODES[OUTCOME_NODES.length - 1]).name;
}

/**
 * The Status bucket a submission flows to: the first bucket its first "Status Given"
 * answer names, so each submission is carried once even when it lists several.
 * @param {!Object} submission A normalised submission whose outcome includes a Status.
 * @returns {string} A `Status: ...` node name; `Other` when no Status was written.
 */
function bucketNodeOf_(submission) {
  const buckets = bucketsFor((submission.statuses || [])[0]);
  return 'Status: ' + (buckets[0] || 'Other');
}

/**
 * Groups items into links by the source and target each maps to.
 * @param {Array<!Object>} items Items to follow.
 * @param {function(!Object): string} sourceOf The item's source node.
 * @param {function(!Object): string} targetOf The item's target node.
 * @returns {Array<{source: string, target: string, value: number}>} One link per pair.
 */
function followLinks_(items, sourceOf, targetOf) {
  const counts = new Map();
  items.forEach((item) => {
    const key = sourceOf(item) + '\u0000' + targetOf(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts, ([key, value]) => {
    const [source, target] = key.split('\u0000');
    return { source, target, value };
  });
}

/**
 * Orders links by where their source and target sit in column order, so the diagram
 * lists its nodes the same way whatever order the submissions came in.
 * @param {Array<{source: string, target: string}>} links Links to sort.
 * @param {Array<string>} order Node names in column order.
 * @returns {Array<!Object>} The links, sorted.
 */
function sortLinks_(links, order) {
  const rank = (name) => order.indexOf(name);
  return links.slice().sort((a, b) => rank(a.source) - rank(b.source) || rank(a.target) - rank(b.target));
}

/**
 * Lists the nodes the links touch, each with the stage its name belongs to.
 * @param {Array<{source: string, target: string}>} links The diagram's links.
 * @returns {Array<{name: string, stage: string}>} Nodes, in first-seen order.
 */
function nodesOf_(links) {
  const stageOf = (name) => {
    if (name === NODE_REPORTING || name === NODE_UNACCOUNTED) return 'reporting';
    if (name === NODE_REPORTED || name === NODE_NO_FORMSG) return 'reported';
    return name.split(':')[0].toLowerCase();
  };
  const names = Array.from(new Set(links.flatMap((link) => [link.source, link.target])));
  return names.map((name) => ({ name, stage: stageOf(name) }));
}

/**
 * Counts submissions per stored outcome, for the coverage line.
 * @param {Array<!Object>} submissions In-range submissions.
 * @returns {{mc: number, status: number, both: number, none: number, notRecorded: number}}
 *     Submissions per outcome; `notRecorded` takes every blank or unknown one.
 */
function outcomeCounts_(submissions) {
  const count = (outcome) => submissions.filter((submission) => submission.outcome === outcome).length;
  const mc = count('MC');
  const status = count('Status');
  const both = count('Both');
  const none = count('None');
  return { mc, status, both, none, notRecorded: submissions.length - mc - status - both - none };
}

/**
 * Builds the report-sick Sankey: nodes, links, and the stage counts behind them.
 * @param {{episodes: Array<!Object>, submissions: Array<!Object>, from: ?string, to:
 *     ?string}} args The dataset's episodes, its FormSG submissions, and the date range.
 * @returns {{nodes: Array<{name: string, stage: string}>, links: Array<{source: string,
 *     target: string, value: number}>, coverage: !Object}} The diagram and its counts.
 */
export function reportSickFlow({ episodes, submissions, from, to }) {
  const reportingSick = episodesInRange_(episodes, DUTY_CLASS.REPORT_SICK, from, to).length;
  const subsInRange = (submissions || []).filter(
    (submission) => submission.date && withinRange(submission.date, from, to)
  );
  const reportedSick = subsInRange.length;

  const reportLinks = channel_(
    [
      { name: NODE_REPORTING, count: reportingSick },
      { name: NODE_UNACCOUNTED, count: Math.max(0, reportedSick - reportingSick) },
    ],
    [
      { name: NODE_REPORTED, count: reportedSick },
      { name: NODE_NO_FORMSG, count: Math.max(0, reportingSick - reportedSick) },
    ]
  );
  const typeLinks = followLinks_(subsInRange, () => NODE_REPORTED, typeNodeOf_);
  const outcomeLinks = followLinks_(subsInRange, typeNodeOf_, outcomeNodeOf_);
  const bucketLinks = followLinks_(
    subsInRange.filter((submission) => STATUS_OUTCOMES.has(submission.outcome)),
    outcomeNodeOf_,
    bucketNodeOf_
  );
  const order = [
    NODE_REPORTED,
    ...REPORT_SICK_TYPES.map((type) => 'Type: ' + type.label),
    'Type: ' + TYPE_NOT_RECORDED,
    ...OUTCOME_NODES.map((node) => node.name),
    ...STATUS_BUCKETS.map((bucket) => 'Status: ' + bucket),
  ];

  const links = [...reportLinks, ...sortLinks_([...typeLinks, ...outcomeLinks, ...bucketLinks], order)];
  return {
    nodes: nodesOf_(links),
    links,
    coverage: { reportingSick, reportedSick, ...outcomeCounts_(subsInRange) },
  };
}
