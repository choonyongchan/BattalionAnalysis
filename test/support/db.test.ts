/**
 * The guard that stops the DB suites from truncating a real database: every test empties the
 * tables, so a test URL that reaches the app's own Neon endpoint must be refused.
 */
import { describe, expect, test } from 'bun:test';
import { assertSafeTestUrl, endpointOf } from './db.ts';

const MAIN = 'postgresql://owner:pw@ep-main-123-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const MAIN_DIRECT = 'postgresql://owner:pw@ep-main-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const BRANCH = 'postgresql://owner:pw@ep-test-456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

describe('assertSafeTestUrl', () => {
  test('pooled and direct URLs of one endpoint are the same endpoint', () => {
    expect(endpointOf(MAIN)).toBe(endpointOf(MAIN_DIRECT));
  });

  test.each([
    ['DATABASE_URL', MAIN],
    ['DATABASE_URL', MAIN_DIRECT],
    ['DATABASE_URL_DIRECT', MAIN_DIRECT],
    ['DASHBOARD_DATABASE_URL', MAIN.replace('owner', 'dashboard_read')],
  ])('refuses a test URL on the same endpoint as %s', (name, url) => {
    expect(() => assertSafeTestUrl(url, { [name]: MAIN })).toThrow(name);
  });

  test('accepts a separate branch endpoint', () => {
    expect(() => assertSafeTestUrl(BRANCH, { DATABASE_URL: MAIN, DASHBOARD_DATABASE_URL: MAIN })).not.toThrow();
  });
});
