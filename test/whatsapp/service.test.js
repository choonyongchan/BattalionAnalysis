/**
 * Tests for the PowerShell behind `bun run whatsapp:service`.
 *
 * Registering a real scheduled task needs elevation, so it is exercised by hand
 * (see whatsapp/README.md); these cover the generated scripts.
 */

import { describe, expect, test } from 'bun:test';
import { installScript, scripts } from '../../whatsapp/scripts/service.js';

const BUN = String.raw`C:\bun\bun.exe`;
const ROOT = String.raw`C:\it's repo`;
const LOG = String.raw`C:\it's repo\whatsapp\data\bridge.log`;

describe('installScript', () => {
  const ps = installScript(BUN, ROOT, LOG);

  test('runs the supervisor with the whatsapp env file, logging to the data dir', () => {
    expect(ps).toContain(String.raw`""C:\bun\bun.exe" --env-file=.env.whatsapp whatsapp\src\supervisor.js >> "C:\it''s repo\whatsapp\data\bridge.log" 2>&1"`);
  });

  test('runs from the repo root so --env-file resolves, escaping quotes', () => {
    expect(ps).toContain(String.raw`-WorkingDirectory 'C:\it''s repo'`);
  });

  test('runs as SYSTEM at boot with a watchdog and no time limit', () => {
    expect(ps).toContain("-UserId 'SYSTEM'");
    expect(ps).toContain('-AtStartup');
    expect(ps).toContain('-MultipleInstances IgnoreNew');
    expect(ps).toContain('-ExecutionTimeLimit ([TimeSpan]::Zero)');
  });
});

describe('scripts', () => {
  const all = scripts(BUN, ROOT, LOG);

  test('stop disables the watchdog before killing the bridge', () => {
    expect(all.stop.indexOf('Disable-ScheduledTask')).toBeLessThan(all.stop.indexOf('Stop-Process'));
  });

  test('kills only bridge bun processes', () => {
    const pattern = String.raw`whatsapp[\\/]src[\\/](supervisor|index)\.js`;
    expect(all.stop).toContain(pattern);
    const re = new RegExp(pattern);
    expect(re.test(String.raw`bun.exe --env-file=.env.whatsapp whatsapp\src\supervisor.js`)).toBe(true);
    expect(re.test('bun.exe C:/repo/whatsapp/src/index.js')).toBe(true);
    expect(re.test('bun.exe run dev')).toBe(false);
  });
});
