/**
 * The extraction prompt.
 *
 * Written for the standardised 40 SAR first-parade-state format, which all five companies
 * now file. It is not a port of the Apps Script prompt: that one had to absorb five
 * mutually incompatible company formats, and the compromises it made to do so are exactly
 * what this format removes. Three of its rules were actively lossy and are reversed here --
 * the old prompt folded appointment times into free text, recognised only one phrasing of
 * the in-camp marker, and had no field for a diagnosis at all.
 *
 * The rules below are ordered by how often getting them wrong would be silent rather than
 * loud. Rejection comes first, because a half-parsed message is worse than a refused one.
 *
 * NAMES IN THE EXAMPLES ARE SYNTHETIC. This file is committed; no real soldier's name,
 * 4D number or diagnosis may appear in it.
 */
import { COMPANIES, REASON_CATEGORIES, REPORT_SICK_TYPES } from '../domain.ts';

/**
 * Builds the complete prompt for one message.
 *
 * @param rawText The parade-state message, already passed through `cleanText`.
 * @param today The date the message was received, as `yyyy-MM-dd`. Used only to resolve
 *   two-digit years and to reject implausible dates; the parade's own `DATE:` header always
 *   wins over it.
 * @returns The prompt text.
 */
export function buildPrompt(rawText: string, today: string): string {
  return `You extract structured data from a 40 SAR parade-state message sent over WhatsApp.

Record only what the message states. Never invent a unit, a person or an appointment. Never guess a value that is not stated -- return null instead. Do not summarise and do not merge entries.

## 1. REJECT FIRST

Set "rejected": true and give a one-sentence "rejection_reason", leaving every other field null or empty, when the message is any of:
- a LAST PARADE STATE (header says "LAST PARADE STATE", "LPS" or "LP"). Only first parade states are ingested. Still report session "LPS" so the rejection records what it was.
- not a parade state at all (ordinary chat, a photo caption, an acknowledgement).
- a parade state in an older free-form layout, i.e. it does NOT use the six fixed section headers below. Signals of the old layout: labelled blocks such as "S/N:", "R & N:", "R/N:", "Reason:", "Duration:", "Status received:"; bracketed diagnoses before the name like "[SHOULDER INJURY] 1234 REC ..."; bullet lines like "- PTE NAME: condition until 010926"; section names such as "ATTC", "MEDICAL STATUS", "MEDICAL APPT", "AL/OIL", "REPORTING SICK", "GUARD DUTY".

Otherwise set "rejected": false and extract everything below.

## 2. HEADER

- "company": one of ${COMPANIES.join(', ')}. Read from the first line, e.g. "40 SAR ARCHER COMPANY" -> Archer. If the message names no company but says HQ, it is Hercules.
- "session": "FIRST PARADE STATE" -> FPS. "LAST PARADE STATE" -> LPS (and reject, per rule 1).
- "date": from "DATE: DDMMYY", converted to ISO "yyyy-MM-dd". DDMMYY always: "180926" -> "2026-09-18".
- "parade_time": from "TIME: HHMM" on the same line, as "HH:MM". "0725" -> "07:25". Null if absent.

Sanity-check every date you output against the parade date (${today} is when this arrived). A date more than about 18 months from the parade date is a typo in the message, almost always a wrong year digit -- "190936" where "190926" was meant. Correct the year to the nearest plausible one and keep going. Never emit a date in 2036.

## 3. UNITS (strength)

"units" is one entry per strength block, in the order the message lists them.

- The first entry is always the roll-up, with "unit_label": "Company". It holds the figures under the first "COMPANY:" line.
- Then one entry per block: "COY HQ", then each platoon or sub-unit exactly as labelled -- "PL 1" ... "PL 9", or named blocks "SIG", "OPR+ASA", "MED", "PNR", "SCR", "MTR". Copy the label verbatim; do not renumber or rename it.
- Every strength figure is present/strength: "62/66" -> total_present 62, total_strength 66. Leading zeros are not significant: "02/02" -> 2 and 2.
- Rank tiers are "OFFICER", "WOSPEC", "ENLISTEE". Fill the matching pair for each. If a tier is written as a bare number instead of a fraction ("OFFICER: 0"), treat it as present 0 and strength null -- do not assume they are equal. If a tier is absent, null.
- "section_counts": one entry per section header inside that block, recording the number the header states. "ATT C: 04" -> stated_count 4. A header with nothing after the colon -> stated_count null. Record all six whenever they appear, even when 0. This is only what the header CLAIMS; it is not your count of the entries.

## 4. PERSONNEL

The six section headers are fixed and always mean the same thing:
${REASON_CATEGORIES.map((c) => `- ${c}`).join('\n')}

Map the header to "reason_category" literally: "ATT C" -> "Att C", "STATUS" -> "Status", "REPORT SICK" -> "Report Sick", "MA" -> "MA", "OFF/LEAVE" -> "Off/Leave", "OTHERS" -> "Others".

One entry per listed line. The number a header states is frequently wrong in both directions -- a header reading "0" may still have lines beneath it, and a header reading "10" may list 8. Always extract the lines that are actually there. (The header's claim is recorded separately in section_counts, so the disagreement is preserved rather than resolved.)

"unit_label" is the block the entry sits under, copied verbatim.
"entry_index" is the line's own number, or null if it has none.
"source_line" is the entry's full text, verbatim, so a surprising row can be traced back.

### The line grammar

  <n>. <4D?> <RANK> <NAME> - <DUTY> (<SUB-REASON>) (<DATES>) [OUT|IN] [@ <LOCATION>]

Split it into fields. Never produce one combined remarks string.

- "four_d": the 3-6 character unit ID when present, e.g. "1401", "A2208". It appears before the rank. Null when absent -- some companies never write one.
- "rank": "REC", "PTE", "CPL", "3SG", "2SG", "1SG", "2LT", "ME2", "CPT", "CPT(DR)". Null if the line starts straight into a name.
- "name": the person's name, without the rank or the 4D.
- "duty_type": WHAT the person has. "MC", "LD", "UFD", "EXCUSE FLEGS", "EXCUSE STAY-IN", "EXCUSE HEAVY LOAD", "MA", "ANNUAL LEAVE", "COMPASSIONATE LEAVE", "OFF", "HOSPITALIZATION LEAVE", "IMT", "TP TEST", "EX WALLABY", "GUARD DUTY". Strip the day-count, the dates, the camp marker and the location from it.
- "sub_reason": WHY, from the parenthesised detail: "3D MC (Fever)" -> duty_type "MC", sub_reason "Fever". "MA (Sleep medicine)" -> duty_type "MA", sub_reason "Sleep medicine". Null when no detail is given.
  - If the line gives a condition but no duty at all -- "1401 PTE TAN AH KOW - High Fever, Flu, Tonsillitis (160926-180926) OUT" under ATT C -- put the condition in sub_reason and leave duty_type null. Do not invent "MC".
  - If a parenthesis contains BOTH a detail and the dates -- "2D MC (laceration on chin 170926-180926)" -- split them: sub_reason "laceration on chin", and the dates go to start_date/end_date.
- "report_sick_type": only under Report Sick. One of ${REPORT_SICK_TYPES.join(', ')}, read from a token like "(RSO)". Null elsewhere.

### Dates and days

- "(300826-020926)" -> start_date "2026-08-30", end_date "2026-09-02".
- "(020926)" alone -> start_date and end_date both "2026-09-02".
- "(100926 1030)" -> start_date and end_date "2026-09-10", start_time "10:30".
- "(180626 1630-190626 0800)" -> an overnight duty: start_date "2026-06-18", end_date "2026-06-19", start_time "16:30", num_days 1. One duty, not two days.
- "(SINCE 100726)" -> start_date "2026-07-10", end_date null, is_permanent true.
- No dates at all -> both null.
- "num_days": the day-count the line STATES, e.g. "32D EXCUSE SWIMMING" -> 32. Take it exactly as written even when it disagrees with the date range beside it; the stated figure is what the unit tracks. Null when no count is written. NEVER calculate it from the dates.
- "is_permanent": true when the line says "PERM", "PERMANENT" or "SINCE" with no end date. Leave num_days null in that case -- do not use 999 or any other sentinel.

### Camp and location

- "in_camp": false when the line ends with "OUT", true when it ends with "IN". Null when neither appears. The marker may sit before the "@ location", as in "(180926 1610) OUT @ National Skin Centre".
- "location": the text after "@". Null when absent.

### One line, one authorisation

Where a single line carries two authorisations joined by a comma -- "5D MC (130926-170926), 2D MC (170926-180926)" -- emit two personnel entries, repeating the person's 4D, rank, name, unit_label and reason_category, and varying only the duty fields and dates. Same for a line listing several excuses with one shared date range: one entry per excuse.

## 5. COMMAND TEAM

Lines from "CDO:" down to the last "PDS ...:" become "command_team" entries.

- "role_kind": CDO, CDS, COS or PDS.
- "unit_label": for a PDS, which sub-unit it commands, taken from the label: "PDS 7" -> "7", "PDS SIG" -> "SIG", "PDS OPR+ASA" -> "OPR+ASA". Null for CDO, CDS and COS.
- "rank" and "name": split as for personnel.
- "is_vacant": true when the appointment is written as "-" or left empty, with rank and name null. An unfilled appointment is a fact worth recording, not a line to skip.

## 6. TOLERANCES

Real messages deviate from the format. Extract them anyway; none of these is a reason to reject:
- missing space after the dash ("3SG WONG AH HUAT -2D MC (...)")
- no dash at all ("PTE LIM AH SENG 2D Compassionate leave (170926-180926)")
- a dash bullet instead of a number ("- 2208 PTE TAN AH KOW (RSO) (180926) OUT")
- an entry with no number and no dash ("2LT KUMAR - IMT")
- a line with dates but no description ("1. 2LT TAN AH KOW (130926 - 200926)") -- leave duty_type and sub_reason null
- spaces inside a date range ("(160926 - 180926)")
- inconsistent capitalisation ("Excuse stay in" and "Excuse Stay-In" are the same duty; keep each line's own text)
- a section header with no number after the colon
- blank lines inside a section

Now extract from this message:
"""
${rawText}
"""`;
}
