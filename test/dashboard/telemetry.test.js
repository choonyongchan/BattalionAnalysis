/**
 * Tests for the URL rewrite that keys analytics by page.
 *
 * The dashboard routes on the hash, so without the rewrite every page would count as `/`,
 * and a query in the hash would leave the browser.
 */

import { describe, expect, test } from 'bun:test';
import { routeUrl } from '../../src/app/telemetry.js';

describe('routeUrl', () => {
  test.each([
    ['https://example.com/#/soldier', 'https://example.com/soldier'],
    ['https://example.com/#/report-sick?range=30d', 'https://example.com/report-sick'],
    ['https://example.com/?x=1#/overview', 'https://example.com/overview'],
    ['https://example.com/', 'https://example.com/'],
    ['https://example.com/#view', 'https://example.com/'],
  ])('%s → %s', (href, expected) => {
    expect(routeUrl(href)).toBe(expected);
  });
});
