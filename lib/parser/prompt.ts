/**
 * The extraction prompt.
 *
 * The model only sees what `deterministic.ts` was unsure of, so the prompt is written for
 * near-template messages with filing slips, and it follows the same rules as that parser
 * (`parade_state_template_new.md`) so both yield the same rows. Allowed values (companies,
 * sections, report-sick types, roles) are enforced by the response schema and not repeated here.
 *
 * NAMES IN THE EXAMPLES ARE SYNTHETIC. This file is committed; no real soldier's name,
 * 4D number or diagnosis may appear in it.
 */

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
  return `Extract a 40 SAR first parade state (a WhatsApp message) into the schema.
Record only what the message states. Never invent a unit, person or appointment; return null for anything not stated. Do not merge or summarise entries.

## 1. Reject
Set "rejected": true, a one-sentence "rejection_reason", and leave everything else null or empty when the message is:
- a LAST PARADE STATE ("LAST PARADE STATE", "LPS", "LP"). Still set session "LPS".
- not a parade state (chat, an acknowledgement, a caption).
- not in the standard format: it lacks the section headers ATT C, STATUS, REPORT SICK, MA, OFF/LEAVE, OTHERS.

## 2. Header
- "company": from line 1, "40 SAR ARCHER COMPANY" -> Archer.
- "session": FIRST PARADE STATE -> FPS.
- "date": "DATE: DDMMYY" -> "yyyy-MM-dd" ("180926" -> "2026-09-18"). Every date in the message is DDMMYY.
- "parade_time": "TIME: 0725" -> "07:25"; null if absent.
The message arrived ${today}. A date more than ~18 months from the parade date is a typo, usually the year digit ("190936" for "190926"): correct it to the nearest plausible year.

## 3. Units
One entry per strength block, in message order. First "Company" (the "COMPANY:" figures), then each block with its label copied verbatim ("COY HQ", "PL 7", "SIG", "OPR+ASA").
- "62/66" -> present 62, strength 66. A bare number ("PL 7: 39", "OFFICER: 0") -> present 39, strength null. An absent tier -> null.
- "section_counts": the number each section header states ("ATT C: 04" -> 4; nothing after the colon -> null), including zeros. This is the header's claim, not your count.

## 4. Personnel
One entry per line under a section, even when the header's number disagrees with the lines. "unit_label" is the block it sits under; "entry_index" the line's own number or null; "source_line" the line verbatim.

Line shape: <n>. <4D?> <RANK> <NAME> - <DESCRIPTION> (<DATES>) [OUT|IN] [@ <LOCATION>]
- "four_d": the ID before the rank ("1401", "S4407"); null if absent. "rank": the rank token; null if none. "name": without 4D or rank.
- "duty_type": what the person has ("MC", "LD", "EXCUSE FLEGS", "LEAVE", "OIL", "GUARD DUTY", "COURSE"), without day-count, dates, camp marker or location. A "PERM" prefix sets is_permanent and is not part of it.
- "sub_reason": the why, from a detail in brackets ("4D MC (Fever) (...)") or after a trailing dash ("3D MC (170926-190926) - Fever"). A condition with no duty ("Fever, Flu (160926-180926)" under ATT C) -> sub_reason, duty_type null; do not invent "MC". A bracket holding detail and dates ("(laceration on chin 170926-180926)") -> split them.
- "report_sick_type": under REPORT SICK only, from the token ("RSO", "RSI", "MR", "FFI", "PENDING").
- "num_days": the stated day-count ("32D" -> 32; "1.5D" -> 2). Never computed from dates; null if not written.
- "in_camp": OUT -> false, IN -> true, else null. "location": the text after "@".

Dates: "(300826-020926)" -> start and end. "(020926)" -> both that day. "(100926 1030)" -> that day, start_time "10:30"; "TBC" as the time -> start_time null. "(180626 1630-190626 0800)" -> one overnight duty, start 18th 16:30, end 19th. "(SINCE 100726)" -> start_date, end_date null, is_permanent true, num_days null. Dates without brackets still count.

One line, one entry, with one exception: two authorisations joined by a comma, each with its own dates ("5D MC (130926-170926), 2D MC (170926-180926)"), are two entries repeating the person. Several activities sharing one range ("30D EXCUSE HEAVY LOAD, RMJ, SQUATTING (010926-300926)") stay ONE entry with that whole text as duty_type.

An "S/N: 01 / R/N: PTE TAN AH KOW / REASON: Fever" block inside a section is one entry (R/N gives rank and name, REASON the detail); "S/N: 00" with no R/N is none.

## 5. Command team
Lines from "CDO:" to the last "PDS …:". "role_kind" CDO, CDS, COS or PDS; for a PDS, "unit_label" is the label after PDS ("PDS 7" -> "7"), else null. Split rank and name as above. An appointment written "-" or left empty -> "is_vacant": true, rank and name null.

## 6. Slips
Missing or extra spaces, a missing dash, a dash bullet or no number, "1.PTE", blank lines, mixed case and a header with no number are filing slips, not reasons to reject. Extract as usual.

Message:
"""
${rawText}
"""`;
}
