/**
 * The extraction call: prompt, response schema, the one `UrlFetchApp` request,
 * and defensive parsing of what comes back.
 *
 * The intake carries a single free-text message — company, date and parade
 * session are not separate structured fields anywhere, so this file is
 * responsible for reading them out of the message text itself alongside the
 * strength figures and personnel entries.
 *
 * Unlike the service this replaces, every failure path here **throws**. The
 * caller writes the reason onto the row that caused it, so there is no error
 * sink to log to and no placeholder key to invent for one.
 */
class ParserAi {
  /**
   * Extracts a structured parade-state object from one raw message.
   *
   * A single retry absorbs transient call/parse failures (a network blip, an
   * occasional malformed response) without failing the submission. Both attempts
   * failing is a real failure and propagates.
   * @param {string} rawText The raw parade-state free text.
   * @returns {!Object} The parsed extraction ({company, date, session, platoons,
   *     command_team, personnel}).
   * @throws {Error} If both attempts fail; the message is written to the row.
   */
  static extract(rawText) {
    const prompt = ParserAi.buildPrompt_(rawText);
    const schema = ParserAi.buildResponseSchema_();

    let lastError = null;
    for (const attempt of [1, 2]) {
      try {
        return ParserAi.parseResponse_(ParserAi.call_(prompt, schema));
      } catch (e) {
        lastError = e;
        Logger.log(`ParserAi.extract attempt ${attempt} failed: ${e.message}`);
      }
    }
    throw new Error(`AI extraction failed after 2 attempts: ${lastError.message}`);
  }

  /**
   * Assembles the extraction prompt: task framing, identification rules,
   * strength-field rules, the reason_category mapping table, the
   * start_date/end_date/num_days splitting rules, and four few-shot examples
   * anchoring the trickiest edge cases without overfitting the model to one
   * message shape.
   *
   * Kept deliberately lean — each rule stated once, no restated caveats — per
   * current prompting guidance, which favours concise, non-redundant
   * instructions over heavily scaffolded prompts.
   *
   * Every rule here is a rule about *reading*, never about computing: real
   * messages contain entries whose stated day-count disagrees with their own
   * date range, and overnight duties whose range spans two dates but count as
   * one day. So the prompt asks for what the message says and `ParserRows`
   * derives nothing — see its header.
   * @param {string} rawText The raw parade-state text to extract from.
   * @returns {string} The complete prompt text.
   */
  static buildPrompt_(rawText) {
    return `You are extracting structured attendance data from a Singapore Army parade-state message (unstructured free text, formatting varies by author). Only record what's explicitly stated — never invent platoons, personnel, or command-team entries, and never guess a value that isn't stated; leave it null instead. Don't summarize, deduplicate, or infer an absence unless it's explicitly listed under a category section.

IDENTIFICATION
- "company": one of ${COMPANIES.join(', ')}, matched however it appears (e.g. "40 SAR ARCHER COMPANY" -> Archer, "BRAVES HQ" -> Braves). This battalion's own HQ element is called "Hercules": if the message says "HQ Company" (or similar) and names none of the other five, company is Hercules.
- "date": normalize any format (e.g. "220626", "22/06/26") to ISO "yyyy-MM-dd".
- "session": "FIRST PARADE STATE"/"FP" -> FPS; "LAST PARADE STATE"/"LP" -> LPS.

STRENGTH (platoons[])
- "platoons" always has exactly one entry with "platoon": "Company" and "unit_type": "Company", holding the message's overall total_strength/total_present — there is no separate top-level total field, the company total is just another platoons[] row.
- total_strength/total_present (on the Company row and every other row): resolve either a "present/total" fraction (e.g. "220/274" -> present 220, strength 274) or two separately labeled lines (e.g. "TOTAL STRENGTH: 136"/"CURRENT STRENGTH: 120") to two integers.
- Beyond the mandatory Company row, add one "platoons" entry per platoon/HQ/command-block the message actually breaks out (label it "1", "2", "HQ", etc.), each with its own total_strength/total_present. Add no further entries if the message has no such breakdown.
- "unit_type": "Company" for the mandatory total row, "PLATOON" for a numbered platoon, "HQ" for a headquarters block, "COMMAND_ELEMENT" for a company-wide command headcount not tied to a platoon number (e.g. "COMMANDERS: 20/25") — never "PLATOON" for that, it would double-count.
- Rank tiers ("Officer"/"OFFICER", "WOSPEC"/"WOSpec", "Enlistee"/"ENLISTEE"/"Men"/"TROOPERS" — same three tiers under different labels): whenever a block states a strength/present pair for one, fill officer_/wospec_/enlistee_strength+present. Leave null if that block doesn't state it.

PERSONNEL
- One entry per person/line-item under each category section (numbered "S/N", bulleted, or plain lists). The count next to a header (e.g. "OTHERS: 02") is frequently wrong in either direction — a header reading "00" may still have entries listed beneath it. Always count the actual listed entries and ignore the header's number; skip only headers with genuinely nothing beneath them.
- "platoon": the same label used in "platoons" if the entry sits inside that platoon's block, else null (company-wide/HQ-level entries).
- "reason_category": map the section heading to exactly one of:
  - Att C: "ATTC"/"ATT C"/"MC"
  - Status: "STATUS"/"MEDICAL STATUS"/"ON STATUS"
  - Off/Leave: "OFF/LEAVE"/"AL/OIL"/"LEAVE/OFF", and any leave entry — annual leave, off in lieu, hospitalisation leave
  - Report Sick: "REPORT SICK"/"REPORTING SICK"/"MR"
  - MA: "MA"/"MEDICAL APPT"/"MEDICAL APPOINTMENT"/"UPCOMING MA"
  - Others: anything else (DUTY, GUARD DUTY, OTHERS, UFD, courses, attachments, etc.)
  If a heading mixes concepts (e.g. "LEAVE/MA/OFF/COURSE"), classify each entry by its own reason text rather than the whole section at once.
- Split descriptive text into separate fields, never one combined remarks string:
  - "start_date"/"end_date": ISO "yyyy-MM-dd" bounds of any day-count and/or date range (e.g. "7D MC (170626-300626)" -> start "2026-06-17", end "2026-06-30"). A single date with no range (an appointment date, e.g. "Date: 220626") -> start_date = end_date = that date. Open-ended with only a start date (e.g. "...from 130526 onwards", "Permanent") -> start_date "2026-05-13", end_date null. Open-started with only an end date (e.g. "Excuse Stay-in until 260626") -> start_date null, end_date "2026-06-26". Null/null if no date at all is stated. A permanent Status entry: start_date as stated or null, end_date null.
  - "num_days": the entry's own stated day-count as an integer, taken exactly as written (e.g. "7D ..." -> 7) even when it disagrees with the date range it sits next to — the stated figure is what the unit tracks. 1 for a single-date appointment. 1 for a duty stated with times that runs overnight into the next morning (e.g. "DATE & TIME: 180626 1630 - 190626 0800" -> 1, one duty, not two days). 999 for a permanent Status entry — one whose reason_category is Status and whose text says "Permanent" or "Perm" — as a "no expiry" marker, not a real day count. Null whenever no day-count is stated and the entry is not one of those shapes — including other open-ended and open-started entries. Never infer a count from the length of a date range.
  - "reason": the condition/appointment/duty text with the day-count, date range, and location removed (e.g. "7D MC (...)" -> "MC"; a stated time-of-day like "1100 Hrs" stays folded into reason, e.g. "Medical Appt (1100 Hrs)", since there's no separate time field). Keep a "Permanent"/"Perm" qualifier in the reason (e.g. "Permanent Excuse (...)"). Never empty — repeat a short label here too if there's nothing beyond the duration.
  - "location": a place name explicitly stated anywhere in the entry — a "LOCATION:" line, or named in the reason prose (e.g. "Attached to Pulau Tekong Medical Centre ..." -> "Pulau Tekong Medical Centre"). Null if no place is named.
  - "in_camp": true/false only when explicitly stated as such (e.g. "Camp: In camp"/"Camp: Outside camp"); otherwise null. Never infer it from a location name, however obvious it seems.
  - "four_d": 3-6 digit unit ID (often "4D:"), else null. "rank" (e.g. "REC", "3SG"), else null.
- Multiple concurrent statuses under one S/N (e.g. several "21D Excuse ..." lines, or "14D X ... & 2D Y ..." on one line) must become separate personnel entries — one per status, repeating that person's name/rank/four_d/platoon/reason_category, varying only start_date/end_date/num_days/reason.

COMMAND TEAM
Lines like "CDO: 2LT RYAN" through "PDS 4: ..." each become one "command_team" entry: "role" normalized to CDO/CDS/COS/PDS1..PDS4 (no space before the number), "rank", "name" (text after the rank; if no rank prefix, rank null and name is the full text). Skip a role label with nothing after its colon. Empty array if the message has no such block.

FEW-SHOT EXAMPLES
Four varied examples, each anchoring one edge case above — read the rules first; don't copy these as a single template.

Example 1 (baseline: mandatory Company row + one platoon row, command team, one plain Att C entry):
Input: """
40 SAR ARCHER COMPANY FIRST PARADE STATE
CAA: 190626 0830
CDO: 2LT RYAN
Total Strength: 220/274
Officer: 05/05
...
PLT 3: 59/69
Officer: 01/01
MC: 01
S/N: 01
R & N: REC TAN JUN HAO, DARREN
4D: 3203
Status: 28D MC (080626 - 050726)
"""
Output: {
  "company": "Archer", "date": "2026-06-19", "session": "FPS",
  "platoons": [
    {"platoon": "Company", "unit_type": "Company", "total_strength": 274, "total_present": 220, "officer_strength": 5, "officer_present": 5, "wospec_strength": null, "wospec_present": null, "enlistee_strength": null, "enlistee_present": null},
    {"platoon": "3", "unit_type": "PLATOON", "total_strength": 69, "total_present": 59, "officer_strength": 1, "officer_present": 1, "wospec_strength": null, "wospec_present": null, "enlistee_strength": null, "enlistee_present": null}
  ],
  "command_team": [{"role": "CDO", "rank": "2LT", "name": "RYAN"}],
  "personnel": [{"name": "TAN JUN HAO, DARREN", "rank": "REC", "four_d": "3203", "platoon": "3", "reason_category": "Att C", "start_date": "2026-06-08", "end_date": "2026-07-05", "num_days": 28, "reason": "MC", "location": null, "in_camp": null}]
}

Example 2 (split concurrent statuses; open-ended permanent status; open-started "until" status):
Input: """
STATUS: 05
S/N: 01
R & N: REC LOW JIA HAO
4D: 3110
Status: Permanent Excuse (Throwing Grenades, Pyrotechnics) from 130526 onwards

S/N: 02
R & N: REC KEVIN NG
4D: 3310
Status:
21D Excuse Heavy Loads (040626 - 240626)
21D Excuse Kneeling (040626 - 240626)

S/N: 03
R & N: PTE JOEL WONG KAI XIN
Status: Excuse Stay-in until 260626
"""
Output "personnel" (all three in platoon "3" from the surrounding block): [
  {"name": "LOW JIA HAO", "rank": "REC", "four_d": "3110", "platoon": "3", "reason_category": "Status", "start_date": "2026-05-13", "end_date": null, "num_days": 999, "reason": "Permanent Excuse (Throwing Grenades, Pyrotechnics)", "location": null, "in_camp": null},
  {"name": "KEVIN NG", "rank": "REC", "four_d": "3310", "platoon": "3", "reason_category": "Status", "start_date": "2026-06-04", "end_date": "2026-06-24", "num_days": 21, "reason": "Excuse Heavy Loads", "location": null, "in_camp": null},
  {"name": "KEVIN NG", "rank": "REC", "four_d": "3310", "platoon": "3", "reason_category": "Status", "start_date": "2026-06-04", "end_date": "2026-06-24", "num_days": 21, "reason": "Excuse Kneeling", "location": null, "in_camp": null},
  {"name": "JOEL WONG KAI XIN", "rank": "PTE", "four_d": null, "platoon": "3", "reason_category": "Status", "start_date": null, "end_date": "2026-06-26", "num_days": null, "reason": "Excuse Stay-in", "location": null, "in_camp": null}
]

Example 3 (header counts wrong in both directions; explicit in-camp signal; location named in prose; single-date appointment):
Input: """
MEDICAL APPT: 07
S/N: 01
R/N: REC SIM YONG QI, SHANE C1205
Reason: Medical Appt
Location: Care Hub
Date: 220626
Time: 1100 Hrs
Camp: In camp

LEAVE/MA/OFF/COURSE: 00
S/N: 01
R&N: REC MUHAMMAD IRFAN
4D: 1103
REASON: Injured Arm

OTHERS: 04
• CPT (DR) GOH KENG WEE: Attached to Pulau Tekong Medical Centre for BN medical support until 070926

GUARD DUTY: 01
S/N: 01
R & N: REC ONG WEI LIANG
4D: 4205
LOCATION: Tekong
REASON: Guard Duty
DATE & TIME: 180626 1630 - 190626 0800
"""
Output "personnel" (the first header says 07 but lists 1; the second says 00 but still lists a person — trust the listed entries in both directions. "Injured Arm" is classified Others by its own reason text, not by the mixed heading. The guard duty spans two dates but is one overnight duty, so num_days is 1): [
  {"name": "SIM YONG QI, SHANE", "rank": "REC", "four_d": "C1205", "platoon": null, "reason_category": "MA", "start_date": "2026-06-22", "end_date": "2026-06-22", "num_days": 1, "reason": "Medical Appt (1100 Hrs)", "location": "Care Hub", "in_camp": true},
  {"name": "MUHAMMAD IRFAN", "rank": "REC", "four_d": "1103", "platoon": null, "reason_category": "Others", "start_date": null, "end_date": null, "num_days": null, "reason": "Injured Arm", "location": null, "in_camp": null},
  {"name": "GOH KENG WEE", "rank": "CPT (DR)", "four_d": null, "platoon": null, "reason_category": "Others", "start_date": null, "end_date": "2026-09-07", "num_days": null, "reason": "Attached to Pulau Tekong Medical Centre for BN medical support", "location": "Pulau Tekong Medical Centre", "in_camp": null},
  {"name": "ONG WEI LIANG", "rank": "REC", "four_d": "4205", "platoon": null, "reason_category": "Others", "start_date": "2026-06-18", "end_date": "2026-06-19", "num_days": 1, "reason": "Guard Duty (1630-0800)", "location": "Tekong", "in_camp": null}
]

Example 4 (only the mandatory Company row, no other platoon breakdown, no command team):
Input: """
COUGAR COMPANY
FIRST PARADE STATE
DATE: 220626 @ 0715 Hrs
TOTAL STRENGTH: 136
CURRENT STRENGTH: 120
"""
Output: {
  "company": "Cougar", "date": "2026-06-22", "session": "FPS",
  "platoons": [{"platoon": "Company", "unit_type": "Company", "total_strength": 136, "total_present": 120, "officer_strength": null, "officer_present": null, "wospec_strength": null, "wospec_present": null, "enlistee_strength": null, "enlistee_present": null}],
  "command_team": [], "personnel": []
}

Now extract from this message:
"""
${rawText}
"""`;
  }

  /**
   * Defines the strict JSON Schema (Structured Outputs, `strict: true`) passed to
   * the model so extraction output is always well-typed and machine-parseable.
   *
   * Strict mode requires every property to be listed in `required` and forbids a
   * separate "nullable" flag, so a nullable field is expressed as
   * `type: [<type>, 'null']` instead. `test/parser.schema.test.js` asserts both
   * invariants, and that every `enum` here matches its constant in ParserSchema.
   * @returns {!Object} A `response_format.json_schema` object.
   */
  static buildResponseSchema_() {
    const rankTierProperties = {
      officer_strength: { type: ['integer', 'null'] },
      officer_present: { type: ['integer', 'null'] },
      wospec_strength: { type: ['integer', 'null'] },
      wospec_present: { type: ['integer', 'null'] },
      enlistee_strength: { type: ['integer', 'null'] },
      enlistee_present: { type: ['integer', 'null'] },
    };

    const platoonSchema = {
      type: 'object',
      properties: {
        platoon: { type: 'string' },
        unit_type: {
          type: 'string',
          enum: [UNIT_TYPES.COMPANY, UNIT_TYPES.PLATOON, UNIT_TYPES.COMMAND_ELEMENT, UNIT_TYPES.HQ],
        },
        total_strength: { type: 'integer' },
        total_present: { type: 'integer' },
        ...rankTierProperties,
      },
      required: ['platoon', 'unit_type', 'total_strength', 'total_present', ...Object.keys(rankTierProperties)],
      additionalProperties: false,
    };

    const personnelSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        rank: { type: ['string', 'null'] },
        four_d: { type: ['string', 'null'] },
        platoon: { type: ['string', 'null'] },
        reason_category: { type: 'string', enum: REASON_CATEGORIES },
        start_date: { type: ['string', 'null'] },
        end_date: { type: ['string', 'null'] },
        num_days: { type: ['integer', 'null'] },
        reason: { type: 'string' },
        location: { type: ['string', 'null'] },
        in_camp: { type: ['boolean', 'null'] },
      },
      required: [
        'name',
        'rank',
        'four_d',
        'platoon',
        'reason_category',
        'start_date',
        'end_date',
        'num_days',
        'reason',
        'location',
        'in_camp',
      ],
      additionalProperties: false,
    };

    const commandTeamSchema = {
      type: 'object',
      properties: {
        role: { type: 'string', enum: COMMAND_ROLES },
        rank: { type: ['string', 'null'] },
        name: { type: 'string' },
      },
      required: ['role', 'rank', 'name'],
      additionalProperties: false,
    };

    return {
      name: 'parade_state_extraction',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          company: { type: ['string', 'null'] },
          date: { type: ['string', 'null'] },
          session: { type: ['string', 'null'], enum: [SESSIONS.FPS, SESSIONS.LPS, null] },
          platoons: { type: 'array', items: platoonSchema },
          command_team: { type: 'array', items: commandTeamSchema },
          personnel: { type: 'array', items: personnelSchema },
        },
        required: ['company', 'date', 'session', 'platoons', 'command_team', 'personnel'],
        additionalProperties: false,
      },
    };
  }

  /**
   * Calls the chat completions endpoint with the given prompt and response
   * schema, on the Flex processing tier.
   * @param {string} promptText The assembled prompt.
   * @param {!Object} schema The response schema from buildResponseSchema_().
   * @returns {!Object} The parsed top-level response body.
   * @throws {Error} If the API key is missing, the call fails, or the response is
   *     not a 2xx.
   */
  static call_(promptText, schema) {
    const apiKey = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROPERTY_KEYS.OPENAI_API_KEY);
    if (!apiKey) {
      throw new Error(
        `${SCRIPT_PROPERTY_KEYS.OPENAI_API_KEY} script property is not set. ` +
          'Set it in the Apps Script editor under Project Settings -> Script Properties.'
      );
    }

    const payload = {
      model: OPENAI_MODEL,
      service_tier: 'flex',
      messages: [{ role: 'user', content: promptText }],
      response_format: { type: 'json_schema', json_schema: schema },
    };

    const response = UrlFetchApp.fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${apiKey}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(`AI API returned HTTP ${code}: ${response.getContentText()}`);
    }
    return JSON.parse(response.getContentText());
  }

  /**
   * Extracts and defensively re-validates the extraction object from a raw
   * response body. Schema-constrained output is still re-checked here rather
   * than trusted blindly, because a provider outage can return a well-formed
   * envelope with a useless body.
   * @param {!Object} responseBody Parsed response body.
   * @returns {!Object} The extraction object.
   * @throws {Error} If the response has no usable choice or malformed JSON.
   */
  static parseResponse_(responseBody) {
    const text =
      responseBody &&
      responseBody.choices &&
      responseBody.choices[0] &&
      responseBody.choices[0].message &&
      responseBody.choices[0].message.content;

    if (!text) {
      throw new Error('AI response contained no message content.');
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const position = Number((/position (\d+)/.exec(e.message) || [])[1]);
      const snippet = Number.isFinite(position)
        ? text.slice(Math.max(0, position - 60), position + 60)
        : text.slice(0, 120);
      throw new Error(`AI response text was not valid JSON: ${e.message} | near: ${snippet}`);
    }

    if (
      !parsed ||
      !Array.isArray(parsed.platoons) ||
      !Array.isArray(parsed.command_team) ||
      !Array.isArray(parsed.personnel)
    ) {
      throw new Error('AI response JSON did not contain the expected platoons/command_team/personnel shape.');
    }
    return parsed;
  }
}
