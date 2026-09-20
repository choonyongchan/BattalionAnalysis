/**
 * Checking that an extraction is structurally sound, and shaping it into sheet
 * row arrays.
 *
 * Two things are deliberately NOT done here, both for the same reason — the
 * messages' own arithmetic cannot be trusted, so computing from it would
 * manufacture data rather than record it:
 *
 * 1. No reconciliation of personnel entry counts against
 *    total_strength - total_present. Real messages have internally inconsistent
 *    header counts, so this would flag most of them and defeat the automation.
 * 2. No deriving `num_days` from the start/end date pair. This looks like an
 *    easy win and is not: across real messages, every entry carrying both dates
 *    already states its own day-count, so a derivation would fire only where
 *    none is stated — and
 *    the shape where none is stated is the overnight duty
 *    ("DATE & TIME: 180626 1630 - 190626 0800"), which is one duty, not the two
 *    days an inclusive count produces. The prompt states that rule instead, so
 *    the figure stays something read from the message rather than invented here.
 *
 * Validation is therefore limited to required fields being present, correctly
 * typed, and drawn from the right enum.
 */
class ParserRows {
  /**
   * The six rank-tier field names, in STRENGTH_DATA_COLUMNS order.
   * @returns {string[]} The field names.
   */
  static rankTierKeys_() {
    return [
      'officer_strength',
      'officer_present',
      'wospec_strength',
      'wospec_present',
      'enlistee_strength',
      'enlistee_present',
    ];
  }

  /**
   * Checks that a rank-tier figure is either absent (the tier was not stated) or
   * a non-negative finite number.
   * @param {*} value Candidate rank-tier field value.
   * @returns {boolean} True if the value is a valid optional count.
   */
  static isValidOptionalCount_(value) {
    return value === null || value === undefined || (Number.isFinite(value) && value >= 0);
  }

  /**
   * Checks that an optional date field is either absent or a usable ISO date.
   * @param {*} value Candidate date value.
   * @returns {boolean} True if the value is absent or a valid ISO date.
   */
  static isValidOptionalDate_(value) {
    return value === null || value === undefined || value === '' || ParserSchema.isIsoDate_(value);
  }

  /**
   * Validates one platoons[] entry.
   * @param {*} platoon Candidate entry.
   * @returns {boolean} True if the entry is well-formed.
   */
  static isValidPlatoon_(platoon) {
    return Boolean(
      platoon &&
        platoon.platoon &&
        Object.values(UNIT_TYPES).includes(platoon.unit_type) &&
        Number.isFinite(platoon.total_strength) &&
        Number.isFinite(platoon.total_present) &&
        platoon.total_strength >= 0 &&
        platoon.total_present >= 0 &&
        ParserRows.rankTierKeys_().every((key) => ParserRows.isValidOptionalCount_(platoon[key]))
    );
  }

  /**
   * Validates one personnel entry.
   * @param {*} person Candidate entry.
   * @returns {boolean} True if the entry is well-formed.
   */
  static isValidPerson_(person) {
    return Boolean(
      person &&
        person.name &&
        person.reason &&
        REASON_CATEGORIES.includes(person.reason_category) &&
        ParserRows.isValidOptionalDate_(person.start_date) &&
        ParserRows.isValidOptionalDate_(person.end_date) &&
        ParserRows.isValidOptionalCount_(person.num_days)
    );
  }

  /**
   * Validates one extraction, structurally.
   *
   * Company, date and session are checked on equal footing with the strength and
   * personnel data because they *are* the `parade_response_id`: an unrecognized
   * value there would file a whole day's data under the wrong key.
   * @param {*} extraction The object returned by ParserAi.extract().
   * @returns {string} '' when the extraction is usable; otherwise a short
   *     human-readable reason, written verbatim to the row's `error` column.
   */
  static validate(extraction) {
    if (!extraction || typeof extraction !== 'object') {
      return 'Extraction result is missing or not an object.';
    }

    if (!extraction.company || !COMPANIES.includes(extraction.company)) {
      return 'Company could not be determined or is not a recognized company.';
    }
    if (!ParserSchema.isIsoDate_(extraction.date)) {
      return 'Date could not be determined from the message, or is not a plausible date.';
    }
    if (extraction.session !== SESSIONS.FPS && extraction.session !== SESSIONS.LPS) {
      return 'Parade session (first/last) could not be determined from the message.';
    }

    if (!Array.isArray(extraction.platoons)) {
      return 'Missing platoons array.';
    }
    if (!extraction.platoons.every(ParserRows.isValidPlatoon_)) {
      return 'One or more platoon entries missing a label, a valid unit_type, or valid strength figures.';
    }
    if (!extraction.platoons.some((platoon) => platoon.unit_type === UNIT_TYPES.COMPANY)) {
      return 'Missing the mandatory company-total row (a platoons[] entry with unit_type "Company").';
    }

    if (!Array.isArray(extraction.command_team)) {
      return 'Missing command_team array.';
    }
    if (!extraction.command_team.every((member) => member && member.name && COMMAND_ROLES.includes(member.role))) {
      return 'One or more command_team entries missing a name or a valid role.';
    }

    if (!Array.isArray(extraction.personnel)) {
      return 'Missing personnel array.';
    }
    if (!extraction.personnel.every(ParserRows.isValidPerson_)) {
      return 'One or more personnel entries missing name, reason, a valid reason_category, or carrying an invalid date.';
    }

    return '';
  }

  /**
   * Renders an optional value as a cell value, blanking anything absent.
   * @param {*} value The value to render.
   * @returns {*} The value, or '' when null/undefined.
   */
  static cell_(value) {
    return value === null || value === undefined ? '' : value;
  }

  /**
   * The `num_days` to write for a personnel entry.
   *
   * A permanent Status entry — `reason_category` "Status" whose `reason` names it
   * permanent — is written with the PERM_STATUS_NUM_DAYS sentinel regardless of
   * what it stated, so "no expiry" is one integer check downstream. This is a
   * keyword-to-sentinel map, not a derivation from the date pair, so it does not
   * cross the line this file's header draws.
   * @param {!Object} person A validated personnel entry.
   * @returns {*} The sentinel, or the entry's own `num_days`.
   */
  static personNumDays_(person) {
    const isPermStatus =
      person.reason_category === 'Status' && /\bperm/i.test(String(person.reason || ''));
    return isPermStatus ? PERM_STATUS_NUM_DAYS : person.num_days;
  }

  /**
   * Shapes a validated extraction into Strength Data rows: one per platoons[]
   * entry, including the mandatory company-total row.
   * @param {!Object} extraction A validated extraction object.
   * @param {string} paradeResponseId The shared key for every row from this submission.
   * @returns {Array<Array<*>>} Rows matching STRENGTH_DATA_COLUMNS order.
   */
  static buildStrengthRows(extraction, paradeResponseId) {
    return extraction.platoons.map((platoon) =>
      [
        paradeResponseId,
        extraction.date,
        extraction.session,
        extraction.company,
        platoon.platoon,
        platoon.unit_type,
        platoon.total_strength,
        platoon.total_present,
      ].concat(ParserRows.rankTierKeys_().map((key) => ParserRows.cell_(platoon[key])))
    );
  }

  /**
   * Shapes a validated extraction into Command Roster rows: one per command_team
   * entry. Empty when the message has no command-team block.
   * @param {!Object} extraction A validated extraction object.
   * @param {string} paradeResponseId The shared key for every row from this submission.
   * @returns {Array<Array<*>>} Rows matching COMMAND_ROSTER_COLUMNS order.
   */
  static buildCommandRosterRows(extraction, paradeResponseId) {
    return extraction.command_team.map((member) => [
      paradeResponseId,
      extraction.date,
      extraction.session,
      extraction.company,
      member.role,
      ParserRows.cell_(member.rank),
      member.name,
    ]);
  }

  /**
   * Shapes a validated extraction into Personnel Data rows: one per personnel
   * entry. `platoon` is blank for company/HQ-level entries not inside any
   * platoon block.
   * @param {!Object} extraction A validated extraction object.
   * @param {string} paradeResponseId The shared key for every row from this submission.
   * @returns {Array<Array<*>>} Rows matching PERSONNEL_DATA_COLUMNS order.
   */
  static buildPersonnelRows(extraction, paradeResponseId) {
    return extraction.personnel.map((person) => [
      paradeResponseId,
      extraction.date,
      extraction.session,
      extraction.company,
      ParserRows.cell_(person.platoon),
      ParserRows.cell_(person.four_d),
      person.name,
      ParserRows.cell_(person.rank),
      person.reason_category,
      ParserRows.cell_(person.start_date),
      ParserRows.cell_(person.end_date),
      ParserRows.cell_(ParserRows.personNumDays_(person)),
      person.reason,
      ParserRows.cell_(person.location),
      ParserRows.cell_(person.in_camp),
    ]);
  }
}
