/**
 * Privacy guard on what the dashboard asks the feed for.
 *
 * The NRIC columns and the parade-state message body must never be requested. The
 * upstream cross-checks that used to live here went with the Apps Script parser.
 */

import { describe, expect, test } from 'bun:test';
import {
  FORBIDDEN_HEADERS,
  FORBIDDEN_SUBMISSION_HEADERS,
  FORMSG_HEADERS,
  SUBMISSION_HEADERS,
} from '../../src/data/tabs.js';

describe('sensitive columns are never requested', () => {
  test('no NRIC column appears in the FormSG request', () => {
    FORBIDDEN_HEADERS.forEach((header) => expect(FORMSG_HEADERS).not.toContain(header));
  });

  test('the message body does not appear in the submissions request', () => {
    FORBIDDEN_SUBMISSION_HEADERS.forEach((header) => expect(SUBMISSION_HEADERS).not.toContain(header));
  });
});
