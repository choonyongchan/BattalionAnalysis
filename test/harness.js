/**
 * Loads Apps Script sources under Bun with stubbed Google globals.
 *
 * Three loaders, one mechanism:
 *   - `loadFormSg()` — the `src/formsg` sources plus `src/WebApp.js`, the single
 *     `doPost` that fronts all three routes.
 *   - `loadParser()` — the `src/parser` sources, the parade-state pipeline.
 *   - `loadDashboard()` — the `src/dashboard` sources plus `src/WebApp.js`, the
 *     read-only feed the dashboard reads through.
 *
 * The sources are plain Apps Script: no imports, no exports, just `class` and `const`
 * declarations that Apps Script resolves through a single shared global lexical
 * scope. Those declarations do NOT become properties of `globalThis`, so the files
 * are concatenated into one `vm` script — which reproduces that shared scope exactly
 * — with a trailing expression that hands the bindings back.
 *
 * The point of doing it this way is that the sources need no test-only modification:
 * no module wrapper, no build step, no bundler between the editor and the deployed
 * script.
 *
 * `loadFormSg` does not load the parade-state pipeline, because none of it is needed
 * to prove the routing: a recording stub stands in for `Parser` so a test can assert
 * which branch a request took. See `triggerCalls`. The pipeline gets its own fakes in
 * `loadParser`, where `ParserAi.extract` is stubbed per test so no request is ever
 * made and the row lifecycle can be driven directly.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/** Directory holding the FormSG Apps Script sources under test. @type {string} */
const SOURCE_DIR = join(import.meta.dir, '..', 'legacy', 'formsg');

/** Directory holding the parade-state parser sources under test. @type {string} */
const PARSER_DIR = join(import.meta.dir, '..', 'legacy', 'parser');

/** Directory holding the dashboard feed sources under test. @type {string} */
const DASHBOARD_DIR = join(import.meta.dir, '..', 'legacy', 'dashboard');

/** The web-app router, loaded alongside the FormSG and dashboard sources. @type {string} */
const WEB_APP_SOURCE = join(import.meta.dir, '..', 'legacy', 'WebApp.js');

/** Intrinsics shared into every vm context, so `instanceof` holds across the boundary. */
const SHARED_INTRINSICS = { Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, Math };

/** The ingest token the FormSG fixtures and loader agree on. @type {string} */
const FORMSG_TEST_TOKEN = 'the-right-token';

/** The dashboard password `loadDashboard` seeds by default. @type {string} */
export const DASHBOARD_TEST_PASSWORD = 'correct-horse-battery-staple';

/**
 * A rectangular view over a FakeSheet's cells, mimicking Spreadsheet.Range.
 */
class FakeRange {
  /**
   * @param {!FakeSheet} sheet The sheet this range belongs to.
   * @param {number} row 1-based first row.
   * @param {number} column 1-based first column.
   * @param {number} numRows Number of rows spanned.
   * @param {number} numColumns Number of columns spanned.
   */
  constructor(sheet, row, column, numRows, numColumns) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    // Sheets defaults a range to one cell when the span is omitted, and the parser
    // relies on that for its single-cell reads.
    this.numRows = numRows === undefined ? 1 : numRows;
    this.numColumns = numColumns === undefined ? 1 : numColumns;
  }

  /**
   * Returns the range's first row, as Range.getRow does.
   * @returns {number} The 1-based row.
   */
  getRow() {
    return this.row;
  }

  /**
   * Reads the range's top-left cell, as Range.getValue does.
   * @returns {*} The cell value, or '' when unset.
   */
  getValue() {
    return this.getValues()[0][0];
  }

  /**
   * Writes the range's top-left cell, as Range.setValue does.
   * @param {*} value The value to write.
   * @returns {!FakeRange} This range, for chaining.
   */
  setValue(value) {
    return this.setValues([[value]]);
  }

  /**
   * Reads the range's cells.
   * @returns {!Array<!Array<*>>} A copy of the cell values, row-major.
   */
  getValues() {
    const values = [];
    for (let r = 0; r < this.numRows; r++) {
      const source = this.sheet.rows[this.row - 1 + r] || [];
      const row = [];
      for (let c = 0; c < this.numColumns; c++) {
        row.push(source[this.column - 1 + c] === undefined ? '' : source[this.column - 1 + c]);
      }
      values.push(row);
    }
    return values;
  }

  /**
   * Writes the range's cells.
   * @param {!Array<!Array<*>>} values Cell values, row-major.
   * @returns {!FakeRange} This range, for chaining.
   */
  setValues(values) {
    values.forEach((row, r) => {
      const target = this.sheet.rows[this.row - 1 + r] || (this.sheet.rows[this.row - 1 + r] = []);
      row.forEach((value, c) => {
        target[this.column - 1 + c] = value;
      });
    });
    return this;
  }

  /**
   * Records a number-format assignment so tests can assert it was applied.
   * @param {string} format The Sheets number format string.
   * @returns {!FakeRange} This range, for chaining.
   */
  setNumberFormat(format) {
    this.sheet.numberFormats.push(format);
    return this;
  }
}

/**
 * An in-memory stand-in for Spreadsheet.Sheet.
 */
class FakeSheet {
  /**
   * @param {string} name The tab name.
   */
  constructor(name) {
    this.name = name;
    /** @type {!Array<!Array<*>>} Cells, row-major, index 0 being sheet row 1. */
    this.rows = [];
    /** @type {string[]} Every number format applied, in order. */
    this.numberFormats = [];
  }

  /**
   * @returns {number} The 1-based index of the last row holding data, or 0.
   */
  getLastRow() {
    return this.rows.length;
  }

  /**
   * @param {number} row 1-based first row.
   * @param {number} column 1-based first column.
   * @param {number} numRows Number of rows spanned.
   * @param {number} numColumns Number of columns spanned.
   * @returns {!FakeRange} The requested range.
   */
  getRange(row, column, numRows, numColumns) {
    return new FakeRange(this, row, column, numRows, numColumns);
  }

  /**
   * Appends a row below the last row holding data.
   * @param {!Array<*>} row The values to append.
   * @returns {void}
   */
  appendRow(row) {
    this.rows.push(row.slice());
  }

  /**
   * Deletes one row, shifting everything below it up.
   * @param {number} rowIndex 1-based row to delete.
   * @returns {void}
   */
  deleteRow(rowIndex) {
    this.rows.splice(rowIndex - 1, 1);
  }

  /**
   * @returns {number} The 1-based index of the last column holding data, or 0.
   */
  getLastColumn() {
    return this.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  }
}

/**
 * Builds a loaded Apps Script environment for one test.
 *
 * @param {{lockAcquired: (boolean|undefined), token: (string|null|undefined)}=} options
 *     Behaviour switches. `lockAcquired` defaults to true; set it false to simulate
 *     lock contention. `token` seeds the FORMSG_INGEST_TOKEN script property and
 *     defaults to the value the fixtures send; pass `null` to leave it unset (so the
 *     endpoint fails closed) or `''` to simulate an empty property.
 * @returns {{globals: !Object, logs: !Array<string>, sheetOf: function(string): ?FakeSheet,
 *     sheets: !Object<string, !FakeSheet>, triggerCalls: !Array<!Object>}} The loaded
 *     bindings plus the fakes behind them, so a test can inspect what was written.
 *     `triggerCalls` records every event the parade-state stub received, and
 *     `dashboardCalls` every event the dashboard-feed stub received.
 */
export function loadFormSg(options) {
  const settings = options || {};
  const lockAcquired = settings.lockAcquired !== false;

  const properties = {};
  const seededToken = settings.token === undefined ? FORMSG_TEST_TOKEN : settings.token;
  if (seededToken !== null) {
    properties.FORMSG_INGEST_TOKEN = seededToken;
  }

  /** @type {!Object<string, !FakeSheet>} */
  const sheets = {};
  /** @type {!Array<string>} */
  const logs = [];
  /** @type {!Array<!Object>} Events routed to the parade-state pipeline. */
  const triggerCalls = [];
  /** @type {!Array<!Object>} Events routed to the dashboard feed. */
  const dashboardCalls = [];

  const sandbox = {
    // Stands in for the parade-state pipeline, which this loader does not load.
    // Recording the call is enough to prove WebApp routed there; loadParser
    // exercises what the pipeline then does.
    Parser: {
      handlePost: (e) => {
        triggerCalls.push(e);
        return {
          getContent: () => JSON.stringify({ ok: true, routedTo: 'paradestate' }),
        };
      },
    },
    // Same arrangement for the dashboard feed: `loadDashboard` loads the real thing.
    DashboardFeed: {
      handlePost: (e) => {
        dashboardCalls.push(e);
        return {
          getContent: () => JSON.stringify({ ok: true, routedTo: 'dashboard' }),
        };
      },
    },
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: (name) => sheets[name] || null,
        insertSheet: (name) => (sheets[name] = new FakeSheet(name)),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => lockAcquired,
        releaseLock: () => {},
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key in properties ? properties[key] : null),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        setMimeType() {
          return this;
        },
        getContent: () => text,
      }),
    },
    Logger: { log: (message) => logs.push(String(message)) },
  };

  const context = vm.createContext(sandbox);

  // Share the host realm's intrinsics with the context. Apps Script runs everything
  // in a single realm, so a Date the module constructs and a Date a test constructs
  // must be the same Date — otherwise `value instanceof Date` in
  // FormSgTimestamps.onEditHandler fails across the vm boundary, which would be an
  // artifact of this harness rather than a fault in the code under test.
  Object.assign(context, SHARED_INTRINSICS);

  const sources = readdirSync(SOURCE_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => readFileSync(join(SOURCE_DIR, file), 'utf8'));
  sources.push(readFileSync(WEB_APP_SOURCE, 'utf8'));

  // The trailing expression is the script's completion value, which is how the
  // lexically-scoped class and const bindings escape the vm script.
  const epilogue = `;({
    FormSgSchema, FormSgSheet, FormSgTimestamps, doPost, WEB_APP_ROUTES,
    formSgVerifySetup,
    FORMSG_COLUMNS, FORMSG_SHEET_NAME, FORMSG_TIMESTAMP_HEADER, FORMSG_RESPONSE_ID_HEADER,
  })`;

  const globals = vm.runInContext(sources.join('\n') + epilogue, context, { filename: 'formsg-bundle.js' });
  return {
    globals,
    logs,
    sheets,
    triggerCalls,
    dashboardCalls,
    sheetOf: (name) => sheets[name] || null,
  };
}

/**
 * Loads the whole src/parser pipeline with in-memory Google fakes.
 *
 * Every collaborator is real except the network: `ParserAi.extract` is left in place
 * but has no key and no reachable endpoint, so a test that exercises the row lifecycle
 * replaces it (see `stubExtraction`) and a test that exercises the call itself drives
 * the `UrlFetchApp` fake instead. Nothing here reaches the internet.
 *
 * The Form-owned responses tab is seeded with a correct header row by default, since
 * `ParserSheets.readText` refuses to do anything without one; pass `header` to seed a
 * wrong one and prove that guard fires.
 *
 * @param {{token: (string|undefined), lockAcquired: (boolean|undefined),
 *     header: (Array<*>|null|undefined), rawRows: (Array<Array<*>>|undefined),
 *     apiKey: (string|undefined), fetchResponse: (!Object|undefined)}=} options
 *     Behaviour switches. `token` seeds WHATSAPP_INGEST_TOKEN (omit to simulate an
 *     unset property); `lockAcquired` defaults to true; `header` overrides the seeded
 *     header row (null seeds no responses tab at all); `rawRows` seeds data rows
 *     beneath it; `apiKey` defaults to a dummy so ParserAi gets past its key check;
 *     `fetchResponse` is what the UrlFetchApp fake returns.
 * @returns {{globals: !Object, logs: !Array<string>, sheets: !Object<string, !FakeSheet>,
 *     fetches: !Array<!Object>, sheetOf: function(string): ?FakeSheet,
 *     rawRow: function(number): !Array<*>, stubExtraction: function(*): !Array<string>}}
 *     The loaded bindings plus the fakes behind them.
 */
export function loadParser(options) {
  const settings = options || {};
  const lockAcquired = settings.lockAcquired !== false;

  /** @type {!Object<string, !FakeSheet>} */
  const sheets = {};
  /** @type {!Array<string>} */
  const logs = [];
  /** @type {!Array<!Object>} Every UrlFetchApp request made. */
  const fetches = [];

  const properties = {
    OPENAI_API_KEY: settings.apiKey === undefined ? 'dummy-key' : settings.apiKey,
  };
  if (settings.token !== undefined) {
    properties.WHATSAPP_INGEST_TOKEN = settings.token;
  }

  const sandbox = {
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: (name) => sheets[name] || null,
        insertSheet: (name) => (sheets[name] = new FakeSheet(name)),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (!lockAcquired) {
            throw new Error('Could not acquire script lock');
          }
        },
        releaseLock: () => {},
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key in properties ? properties[key] : null),
      }),
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        fetches.push({ url, params });
        const response = settings.fetchResponse || {};
        return {
          getResponseCode: () => (response.code === undefined ? 200 : response.code),
          getContentText: () => (response.body === undefined ? '{}' : response.body),
        };
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        setMimeType() {
          return this;
        },
        getContent: () => text,
      }),
    },
    // Referenced only by install/remove, which these tests never call.
    ScriptApp: { getProjectTriggers: () => [] },
    Logger: { log: (message) => logs.push(String(message)) },
  };

  const context = vm.createContext(sandbox);
  Object.assign(context, SHARED_INTRINSICS);

  const sources = readdirSync(PARSER_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => readFileSync(join(PARSER_DIR, file), 'utf8'));

  const epilogue = `;({
    Parser, ParserAi, ParserRows, ParserSchema, ParserSheets,
    onFormSubmitHandler, reprocessRow, reprocessPendingRows, installTriggers, removeTriggers,
    SHEET_NAMES, RAW_RESPONSES_COLUMNS, STRENGTH_DATA_COLUMNS, PERSONNEL_DATA_COLUMNS,
    COMMAND_ROSTER_COLUMNS, SCRIPT_OWNED_SHEETS, PARADE_ERROR_SENTINEL, PARADE_PROCESSING_SENTINEL,
    COMPANIES, SESSIONS, REASON_CATEGORIES, UNIT_TYPES, COMMAND_ROLES,
    MAX_ONEDIT_REPROCESS_ROWS, PLAUSIBLE_YEARS, OPENAI_MODEL,
  })`;

  const globals = vm.runInContext(sources.join('\n') + epilogue, context, { filename: 'parser-bundle.js' });

  // Seed the Form-owned tab. ParserSchema.sheet_ creates the three script-owned tabs
  // on demand, which is behaviour under test, so those are deliberately not seeded.
  if (settings.header !== null) {
    const sheet = new FakeSheet(globals.SHEET_NAMES.RAW_RESPONSES);
    sheet.rows.push((settings.header || globals.RAW_RESPONSES_COLUMNS).slice());
    (settings.rawRows || []).forEach((row) => sheet.rows.push(row.slice()));
    sheets[sheet.name] = sheet;
  }

  return {
    globals,
    logs,
    sheets,
    fetches,
    sheetOf: (name) => sheets[name] || null,
    rawRow: (rowIndex) => sheets[globals.SHEET_NAMES.RAW_RESPONSES].rows[rowIndex - 1],
    /**
     * Replaces ParserAi.extract for this environment.
     *
     * Assigning onto the loaded class works because Apps Script resolves the binding
     * through the shared global scope at call time, not at load time — the same
     * property that lets these files reach each other with no imports.
     * @param {*} result The extraction to return, or an Error to throw.
     * @returns {!Array<string>} The texts extract was called with, as they arrive.
     */
    stubExtraction: (result) => {
      const calls = [];
      globals.ParserAi.extract = (text) => {
        calls.push(text);
        if (result instanceof Error) {
          throw result;
        }
        return typeof result === 'function' ? result(text) : JSON.parse(JSON.stringify(result));
      };
      return calls;
    },
  };
}

/**
 * Builds a fake edited range for onEditHandler.
 *
 * `oldValue` mirrors what Apps Script actually supplies: the value a cell held before
 * the edit, and only ever for a single-cell edit. The handler relies on that
 * distinction, so this helper does not invent one for a multi-cell range.
 *
 * @param {{sheetName: string, column: number, lastColumn?: number, row: number,
 *     lastRow?: number, oldValue?: *, cells?: !Object<string, *>}} spec The range's
 *     shape, plus `cells` keyed "row,col" for what the handler will read back.
 * @returns {!Object} An Apps Script onEdit event object.
 */
export function editEvent(spec) {
  const cells = spec.cells || {};
  const sheet = {
    getName: () => spec.sheetName,
    getRange: (row, column) => ({
      getValue: () => {
        const key = `${row},${column}`;
        return key in cells ? cells[key] : '';
      },
    }),
  };
  const event = {
    range: {
      getSheet: () => sheet,
      getColumn: () => spec.column,
      getLastColumn: () => (spec.lastColumn === undefined ? spec.column : spec.lastColumn),
      getRow: () => spec.row,
      getLastRow: () => (spec.lastRow === undefined ? spec.row : spec.lastRow),
    },
  };
  if (spec.oldValue !== undefined) {
    event.oldValue = spec.oldValue;
  }
  return event;
}

/**
 * Loads the dashboard feed with in-memory Google fakes.
 *
 * The real `DashboardFeed` this time, with recording stubs standing in for the two
 * intakes — the mirror image of `loadFormSg`, which stubs the feed and loads the real
 * FormSG intake. Between them the router's three branches are covered without either
 * loader having to load code it is not testing.
 *
 * @param {{password: (string|null|undefined), tabs: (!Object<string, !Array<!Array<*>>>|undefined),
 *     timeZone: (string|undefined), failures: (number|undefined)}=} options
 *     Behaviour switches. `password` seeds DASHBOARD_PASSWORD and defaults to
 *     DASHBOARD_TEST_PASSWORD; pass `null` to leave the property unset, so the
 *     endpoint fails closed. `tabs` seeds sheets by name. `timeZone` is the
 *     spreadsheet timezone, defaulting to the project's Asia/Singapore. `failures`
 *     preloads the failed-attempt counter, to reach the lockout without guessing
 *     against it ten times.
 * @returns {{globals: !Object, logs: !Array<string>, cache: !Object<string, string>,
 *     cachePuts: !Array<!Object>, parserCalls: !Array<!Object>,
 *     formSgCalls: !Array<!Object>, sheets: !Object<string, !FakeSheet>}} The loaded
 *     bindings plus the fakes behind them. `sheets` is exposed so a test can assert
 *     the feed wrote nothing — FakeSheet records every write it receives.
 */
export function loadDashboard(options) {
  const settings = options || {};
  const timeZone = settings.timeZone || 'Asia/Singapore';

  const properties = {};
  const seeded = settings.password === undefined ? DASHBOARD_TEST_PASSWORD : settings.password;
  if (seeded !== null) {
    properties.DASHBOARD_PASSWORD = seeded;
  }

  /** @type {!Object<string, !FakeSheet>} */
  const sheets = {};
  Object.keys(settings.tabs || {}).forEach((name) => {
    const sheet = new FakeSheet(name);
    (settings.tabs[name] || []).forEach((row) => sheet.appendRow(row));
    sheets[name] = sheet;
  });

  /** @type {!Array<string>} */
  const logs = [];
  /** @type {!Object<string, string>} The script cache's contents. */
  const cache = {};
  /** @type {!Array<!Object>} Every cache write, so a test can assert the expiry. */
  const cachePuts = [];
  /** @type {!Array<!Object>} Events routed to the parade-state intake. */
  const parserCalls = [];
  /** @type {!Array<!Object>} Events routed to the FormSG intake. */
  const formSgCalls = [];

  if (settings.failures) {
    cache.dashboard_failed_attempts = String(settings.failures);
  }

  const sandbox = {
    Parser: {
      handlePost: (e) => {
        parserCalls.push(e);
        return { getContent: () => JSON.stringify({ ok: true, routedTo: 'paradestate' }) };
      },
    },
    FormSgSheet: {
      handlePost: (e) => {
        formSgCalls.push(e);
        return { getContent: () => JSON.stringify({ ok: true, routedTo: 'reportsick' }) };
      },
    },
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: (name) => sheets[name] || null,
        getSpreadsheetTimeZone: () => timeZone,
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key in properties ? properties[key] : null),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => (key in cache ? cache[key] : null),
        put: (key, value, seconds) => {
          cache[key] = value;
          cachePuts.push({ key, value, seconds });
        },
        remove: (key) => {
          delete cache[key];
        },
      }),
    },
    Utilities: { formatDate: fakeFormatDate },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        setMimeType() {
          return this;
        },
        getContent: () => text,
      }),
    },
    Logger: { log: (message) => logs.push(String(message)) },
  };

  const context = vm.createContext(sandbox);
  Object.assign(context, SHARED_INTRINSICS);

  const sources = readdirSync(DASHBOARD_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => readFileSync(join(DASHBOARD_DIR, file), 'utf8'));
  sources.push(readFileSync(WEB_APP_SOURCE, 'utf8'));

  const epilogue = `;({
    DashboardFeed, doPost, WEB_APP_ROUTES,
    DASHBOARD_TABS, DASHBOARD_TAB_PROJECTIONS,
    DASHBOARD_PASSWORD_KEY, FAILURE_LIMIT, LOCKOUT_SECONDS,
  })`;

  const globals = vm.runInContext(sources.join('\n') + epilogue, context, {
    filename: 'dashboard-bundle.js',
  });
  return { globals, logs, cache, cachePuts, parserCalls, formSgCalls, sheets };
}

/**
 * Stands in for `Utilities.formatDate`, for the patterns the feed actually uses.
 *
 * A fixed offset per zone is enough and is honest about its limits: this project's
 * timezone is Asia/Singapore, which has had no daylight saving since 1935, so there
 * is no transition for a fake to get wrong. An unknown zone throws rather than
 * quietly formatting in UTC, which would turn a timezone bug in the code under test
 * into a passing test.
 *
 * @param {!Date} date The instant to render.
 * @param {string} timeZone An IANA zone name this fake knows a fixed offset for.
 * @param {string} pattern A Java-style pattern, as Apps Script takes.
 * @returns {string} The formatted date.
 * @throws {Error} If the zone is not one this fake knows.
 */
function fakeFormatDate(date, timeZone, pattern) {
  const offsets = { 'Asia/Singapore': 8, UTC: 0, 'Etc/GMT': 0 };
  if (!(timeZone in offsets)) {
    throw new Error(`harness: fakeFormatDate has no fixed offset for "${timeZone}".`);
  }
  const shifted = new Date(date.getTime() + offsets[timeZone] * 3600000);
  const pad = (value, width) => String(value).padStart(width, '0');
  const tokens = {
    yyyy: pad(shifted.getUTCFullYear(), 4),
    MM: pad(shifted.getUTCMonth() + 1, 2),
    dd: pad(shifted.getUTCDate(), 2),
    HH: pad(shifted.getUTCHours(), 2),
    mm: pad(shifted.getUTCMinutes(), 2),
    ss: pad(shifted.getUTCSeconds(), 2),
  };
  // Quoted literals pass through, as Java's SimpleDateFormat defines them.
  return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (match, quoted) =>
    quoted === undefined ? tokens[match] : quoted
  );
}

/**
 * Wraps a JSON body in the shape Apps Script's doPost delivers.
 *
 * The route defaults to `reportsick` because that is the intake these tests
 * exercise; pass it explicitly to drive another branch of the router.
 * @param {*} body The value to send as the request body; objects are stringified.
 * @param {string=} route The `route` query parameter. Defaults to 'reportsick'.
 *     Pass null to omit it entirely, as an unrouted caller would.
 * @returns {!Object} An Apps Script doPost event object.
 */
export function postEvent(body, route) {
  const parameter = route === null ? {} : { route: route === undefined ? 'reportsick' : route };
  return {
    parameter: parameter,
    postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) },
  };
}

/**
 * A realistic Plumber payload: the variables its FormSG trigger exposes, plus the
 * shared ingest token Plumber adds to the request body so the endpoint can
 * authenticate it.
 * @param {!Object=} overrides Fields to merge over the defaults.
 * @returns {!Object} A submission body.
 */
export function samplePayload(overrides) {
  return Object.assign(
    {
      token: FORMSG_TEST_TOKEN,
      submissionId: '90fb87fbc8ad7733e37726a5',
      submittedAt: '2026-08-31T14:47:26.417+08:00',
      answers: {
        RANK: 'LTA',
        '[Myinfo] Name': 'PHUA CHU KANG',
        '4D Number (REC Only)': 'astrum tego crux',
        'Unit & Coy': '8 SAB',
        'Report Sick Type': 'Report Sick In-Camp (RSI)',
        'Reason for Reporting Sick (Keep Brief)': 'Debilito communis demonstro hic arcus.',
        'I am experiencing _____________________ symptoms.':
          'Dermatology Related (Skin Rashes/Abrasion/Eczema/Burns and Cuts)',
        'My symptoms are genuine and I have updated my Commander of my condition.': 'Yes',
        'SingPass Validated NRIC': 'S1234568B',
      },
    },
    overrides || {}
  );
}

export { FakeSheet, FakeRange };
