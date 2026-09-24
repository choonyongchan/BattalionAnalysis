/**
 * Self-Regulated Fitness Training: who trained, where, doing what, and in how big a group.
 *
 * One record is one SFT session a soldier filed on the FormSG form. A soldier is counted by
 * normalised name (the form has no 4D question). A *group* is everyone who named the same
 * Group IC on the same day; the IC's name is typed free-hand, so "3SG Tan Wei Ming",
 * "TAN WEI MING" and "tan wei minh" are consolidated by fuzzy matching before counting.
 *
 * Every function here is pure.
 */

import Fuse from 'fuse.js';
import { COMPANIES } from './domain.js';
import { normaliseName } from './identity.js';
import { nameTokens, namesMatch } from './reconcile.js';
import { toIsoDate, toText } from './values.js';

/** @type {string} How the form joins a checkbox answer's selections. */
const EXERCISE_SEPARATOR = /\s*;\s*/;

/**
 * How far apart two name *tokens* may be, as a Fuse score (0 exact, 1 anything), and still
 * be one word. Scored per token, not per name: over a whole name two shared words outweigh a
 * third that differs, so "TAN WEI MING" and "TAN WEI LIANG" would merge. Per token, a
 * one-letter slip (LIM/LIMM, MINH/MING) scores 0.25 and a different word (MING/LIANG) 0.4+.
 * @type {number}
 */
const TOKEN_THRESHOLD = 0.25;

/**
 * Normalises SFT Responses rows into records.
 * @param {Array<!Object>} rows Records keyed by `SFT_HEADERS`.
 * @returns {Array<{date: string, timestamp: string, rank: string, name: string, key: string,
 *     company: string, groupIc: string, pes: string, exercises: string[], sfabt: string,
 *     location: string}>} One record per session, undated rows dropped.
 */
export function toSftRecords(rows) {
  return (rows || [])
    .map((row) => ({
      date: toIsoDate(row.date),
      timestamp: toText(row.Timestamp),
      rank: toText(row.RANK),
      name: toText(row.name),
      key: normaliseName(row.name),
      company: COMPANIES.includes(toText(row.company)) ? toText(row.company) : '',
      groupIc: toText(row.group_ic),
      pes: toText(row['PES Status']),
      exercises: toText(row.exercises).split(EXERCISE_SEPARATOR).filter(Boolean),
      sfabt: toText(row.sfabt_type),
      location: toText(row.location),
    }))
    .filter((record) => record.date);
}

/**
 * Counts the distinct soldiers among some sessions.
 * @param {Array<!Object>} records SFT records.
 * @returns {number} Unique soldiers; a nameless session counts once on its own.
 */
export function soldierCount(records) {
  return new Set(records.map((record, index) => record.key || '#' + index)).size;
}

/**
 * Sessions and soldiers per company, every company listed.
 * @param {Array<!Object>} records SFT records.
 * @returns {Array<{company: string, sessions: number, soldiers: number}>} In `COMPANIES` order.
 */
export function byCompany(records) {
  return COMPANIES.map((company) => {
    const mine = records.filter((record) => record.company === company);
    return { company, sessions: mine.length, soldiers: soldierCount(mine) };
  });
}

/**
 * Counts labels, merging case and spacing variants under the first spelling seen.
 * @param {Array<string>} labels Raw labels, blanks allowed.
 * @param {number} limit How many to keep.
 * @returns {Array<{label: string, count: number}>} Most common first; ties by label.
 */
function topLabels_(labels, limit) {
  const counts = new Map();
  labels.forEach((raw) => {
    const label = toText(raw).replace(/\s+/g, ' ');
    if (!label) {
      return;
    }
    const key = label.toUpperCase();
    const entry = counts.get(key) || { label, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  });
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * The most common training locations.
 * @param {Array<!Object>} records SFT records.
 * @param {number} limit How many to keep.
 * @returns {Array<{label: string, count: number}>} Sessions per location.
 */
export function topLocations(records, limit) {
  return topLabels_(records.map((record) => record.location), limit);
}

/**
 * The most common exercises; a session doing three counts once for each.
 * @param {Array<!Object>} records SFT records.
 * @param {number} limit How many to keep.
 * @returns {Array<{label: string, count: number}>} Sessions per exercise.
 */
export function topExercises(records, limit) {
  return topLabels_(records.flatMap((record) => record.exercises), limit);
}

/**
 * An IC name reduced to its identifying words, ranks and punctuation gone.
 * @param {string} name The typed IC name.
 * @returns {string} Upper-case tokens joined by spaces, or '' for a blank.
 */
function icTokens_(name) {
  return nameTokens(name).join(' ');
}

/**
 * Fuse's score for finding `needle` in `haystack`.
 * @param {string} needle One token.
 * @param {string} haystack Another token.
 * @returns {number} 0 for exact, up to 1; 1 when Fuse finds nothing.
 */
function fuseScore_(needle, haystack) {
  const [hit] = new Fuse([haystack], { includeScore: true, threshold: 1, ignoreLocation: true }).search(needle);
  return hit ? hit.score : 1;
}

/**
 * Whether two tokens are one word, typos allowed.
 *
 * Scored both ways and the worse kept, because Fuse is a substring search: on its own,
 * "TAN" is found inside "TANG" at 0.001.
 * @param {string} a One token.
 * @param {string} b Another token.
 * @returns {boolean} Whether they match.
 */
function tokensMatch_(a, b) {
  return a === b || Math.max(fuseScore_(a, b), fuseScore_(b, a)) <= TOKEN_THRESHOLD;
}

/**
 * Whether two typed names plausibly name the same person, tolerating typos.
 *
 * `namesMatch` from `reconcile.js` with its token equality relaxed to `tokensMatch_`: every
 * word of the shorter name (at least two) matching, or a 60% overlap.
 * @param {string} a One name.
 * @param {string} b The other name.
 * @returns {boolean} Whether they match.
 */
export function fuzzyNamesMatch(a, b) {
  if (namesMatch(a, b)) {
    return true;
  }
  const tokensA = [...new Set(nameTokens(a))];
  const unmatched = [...new Set(nameTokens(b))];
  const sizeB = unmatched.length;
  if (tokensA.length === 0 || sizeB === 0) {
    return false;
  }
  let shared = 0;
  tokensA.forEach((token) => {
    const index = unmatched.findIndex((other) => tokensMatch_(token, other));
    if (index >= 0) {
      unmatched.splice(index, 1);
      shared += 1;
    }
  });
  const smaller = Math.min(tokensA.length, sizeB);
  return (smaller >= 2 && shared === smaller) || shared / (tokensA.length + sizeB - shared) >= 0.6;
}

/**
 * Finds the cluster an IC name belongs to.
 * @param {Array<{label: string}>} clusters The day's clusters so far.
 * @param {string} name The typed IC name.
 * @returns {?Object} The matching cluster, or null for a new IC.
 */
function findCluster_(clusters, name) {
  return clusters.find((cluster) => fuzzyNamesMatch(cluster.label, name)) || null;
}

/**
 * Consolidates each day's IC names into clusters, one per person.
 * @param {Array<!Object>} records SFT records.
 * @returns {Array<{date: string, label: string, tokens: string, members: Array<!Object>}>}
 *     One cluster per (day, IC); `label` is the first spelling seen. Sessions with a blank
 *     IC belong to no cluster.
 */
export function groupIcClusters(records) {
  const byDay = new Map();
  records.forEach((record) => {
    const tokens = icTokens_(record.groupIc);
    if (!tokens) {
      return;
    }
    const clusters = byDay.get(record.date) || [];
    byDay.set(record.date, clusters);
    let cluster = findCluster_(clusters, record.groupIc);
    if (!cluster) {
      cluster = { date: record.date, label: record.groupIc, tokens, members: [] };
      clusters.push(cluster);
    }
    cluster.members.push(record);
  });
  return [...byDay.values()].flat();
}

/**
 * The most common company among a group's members.
 * @param {Array<!Object>} members SFT records.
 * @returns {string} A company, or '' when none is known.
 */
function majorityCompany_(members) {
  const [top] = topLabels_(members.map((member) => member.company), 1);
  return top ? top.label : '';
}

/**
 * Sizes every group: its distinct members, plus the IC when the IC did not file too.
 * @param {Array<!Object>} records SFT records.
 * @returns {Array<{date: string, ic: string, company: string, size: number}>} One per group.
 */
export function groupSizes(records) {
  return groupIcClusters(records).map((cluster) => {
    const icFiled = cluster.members.some((member) => fuzzyNamesMatch(member.name, cluster.label));
    return {
      date: cluster.date,
      ic: cluster.label,
      company: majorityCompany_(cluster.members),
      size: soldierCount(cluster.members) + (icFiled ? 0 : 1),
    };
  });
}

/**
 * The mean size of some groups.
 * @param {Array<{size: number}>} groups From `groupSizes`.
 * @returns {?number} The mean, or null when there are no groups.
 */
export function averageGroupSize(groups) {
  if (groups.length === 0) {
    return null;
  }
  return groups.reduce((sum, group) => sum + group.size, 0) / groups.length;
}

/**
 * How many groups there were of each size.
 * @param {Array<{size: number}>} groups From `groupSizes`.
 * @returns {Array<{size: number, count: number}>} Every size from 1 to the largest, empty
 *     sizes included so the axis has no gaps.
 */
export function groupSizeDistribution(groups) {
  const largest = groups.reduce((max, group) => Math.max(max, group.size), 0);
  return Array.from({ length: largest }, (_, index) => ({
    size: index + 1,
    count: groups.filter((group) => group.size === index + 1).length,
  }));
}
