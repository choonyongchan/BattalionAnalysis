/**
 * The report-sick flow Sankey: parade-state reports -> FormSG submissions -> type -> outcome -> Status bucket.
 * The first link is not reconciled (two plain counts poured into each other); everything after
 * "Reported sick" follows each submission's own answers, so nothing downstream outnumbers submissions.
 */

import { DUTY_CLASS, type DutyClass } from './classify.ts';
import { withinRange } from './dateRange.ts';
import type { Episode } from './episodes.ts';
import { REPORT_SICK_TYPES, reportSickTypeOf, type Submission } from './formsg.ts';
import { STATUS_BUCKETS, bucketsFor } from './statusBuckets.ts';

const TYPE_NOT_RECORDED = 'Type not recorded';
const NODE_REPORTING = 'Reporting sick';
const NODE_UNACCOUNTED = 'Unaccounted';
const NODE_REPORTED = 'Reported sick';
const NODE_NO_FORMSG = 'No FormSG submission';

/** Outcome nodes in column order; `None` is last and also takes a blank or unknown outcome. */
const NO_OUTCOME_NODE = { outcome: 'None', name: 'Outcome: No MC or Status' } as const;
const OUTCOME_NODES = [
  { outcome: 'MC', name: 'Outcome: MC' },
  { outcome: 'Status', name: 'Outcome: Status' },
  { outcome: 'Both', name: 'Outcome: MC and Status' },
  NO_OUTCOME_NODE,
] as const;

/** Outcomes carrying a Status, which flow on to a bucket. */
const STATUS_OUTCOMES = new Set(['Status', 'Both']);

/** A flow between two nodes. */
export interface Link {
  source: string;
  target: string;
  value: number;
}

/** A node and the stage (column) it belongs to. */
export interface FlowNode {
  name: string;
  stage: string;
}

/** Counts behind the stages. */
export interface FlowCoverage {
  reportingSick: number;
  reportedSick: number;
  mc: number;
  status: number;
  both: number;
  none: number;
}

/** Pours ordered sources into ordered targets, filling each target before the next; leftovers yield no link. */
function channel(sources: { name: string; count: number }[], targets: { name: string; count: number }[]): Link[] {
  const remaining = targets.map((target) => target.count);
  const links: Link[] = [];
  let index = 0;
  for (const source of sources) {
    let left = source.count;
    while (left > 0 && index < targets.length) {
      const value = Math.min(left, remaining[index]!);
      if (value > 0) links.push({ source: source.name, target: targets[index]!.name, value });
      left -= value;
      remaining[index]! -= value;
      if (remaining[index] === 0) index += 1;
    }
  }
  return links;
}

/** Episodes of a duty class starting (or first seen) within the range. */
function episodesInRange(episodes: Episode[], dutyClass: DutyClass, from: string | null, to: string | null): Episode[] {
  return episodes.filter((episode) => {
    const date = episode.startDate ?? episode.paradeDates[0] ?? null;
    return episode.dutyClass === dutyClass && withinRange(date, from, to);
  });
}

/** A submission's type node. */
function typeNodeOf(submission: Submission): string {
  const code = reportSickTypeOf(submission);
  return 'Type: ' + (REPORT_SICK_TYPES.find((entry) => entry.name === code)?.label ?? TYPE_NOT_RECORDED);
}

/** A submission's outcome node; blank or unknown reads as none. */
function outcomeNodeOf(submission: Submission): string {
  return (OUTCOME_NODES.find((entry) => entry.outcome === submission.outcome) ?? NO_OUTCOME_NODE).name;
}

/** The bucket of a submission's first Status answer, so it is carried once. */
function bucketNodeOf(submission: Submission): string {
  return 'Status: ' + (bucketsFor(submission.statuses[0])[0] ?? 'Other');
}

/** One link per source-target pair the items map to. */
function followLinks(items: Submission[], sourceOf: (item: Submission) => string, targetOf: (item: Submission) => string): Link[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = sourceOf(item) + '\u0000' + targetOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([key, value]) => {
    const [source = '', target = ''] = key.split('\u0000');
    return { source, target, value };
  });
}

/** The stage a node name belongs to. */
function stageOf(name: string): string {
  if (name === NODE_REPORTING || name === NODE_UNACCOUNTED) return 'reporting';
  if (name === NODE_REPORTED || name === NODE_NO_FORMSG) return 'reported';
  return name.split(':')[0]!.toLowerCase();
}

/** Submissions per stored outcome; `none` takes every blank or unknown one. */
function outcomeCounts(submissions: Submission[]): Omit<FlowCoverage, 'reportingSick' | 'reportedSick'> {
  const count = (outcome: string) => submissions.filter((submission) => submission.outcome === outcome).length;
  const mc = count('MC');
  const status = count('Status');
  const both = count('Both');
  return { mc, status, both, none: submissions.length - mc - status - both };
}

/** Builds the report-sick Sankey: nodes, links and the stage counts behind them. */
export function reportSickFlow({
  episodes,
  submissions,
  from,
  to,
}: {
  episodes: Episode[];
  submissions: Submission[];
  from: string | null;
  to: string | null;
}): { nodes: FlowNode[]; links: Link[]; coverage: FlowCoverage } {
  const reportingSick = episodesInRange(episodes, DUTY_CLASS.REPORT_SICK, from, to).length;
  const inRange = submissions.filter((submission) => withinRange(submission.date, from, to));
  const reportedSick = inRange.length;

  const reportLinks = channel(
    [
      { name: NODE_REPORTING, count: reportingSick },
      { name: NODE_UNACCOUNTED, count: Math.max(0, reportedSick - reportingSick) },
    ],
    [
      { name: NODE_REPORTED, count: reportedSick },
      { name: NODE_NO_FORMSG, count: Math.max(0, reportingSick - reportedSick) },
    ],
  );
  const order = [
    NODE_REPORTED,
    ...REPORT_SICK_TYPES.map((type) => 'Type: ' + type.label),
    'Type: ' + TYPE_NOT_RECORDED,
    ...OUTCOME_NODES.map((node) => node.name),
    ...STATUS_BUCKETS.map((bucket) => 'Status: ' + bucket),
  ];
  const rank = (name: string) => order.indexOf(name);
  const answerLinks = [
    ...followLinks(inRange, () => NODE_REPORTED, typeNodeOf),
    ...followLinks(inRange, typeNodeOf, outcomeNodeOf),
    ...followLinks(inRange.filter((submission) => STATUS_OUTCOMES.has(submission.outcome)), outcomeNodeOf, bucketNodeOf),
  ].sort((a, b) => rank(a.source) - rank(b.source) || rank(a.target) - rank(b.target));

  const links = [...reportLinks, ...answerLinks];
  const names = Array.from(new Set(links.flatMap((link) => [link.source, link.target])));
  return {
    nodes: names.map((name) => ({ name, stage: stageOf(name) })),
    links,
    coverage: { reportingSick, reportedSick, ...outcomeCounts(inRange) },
  };
}
