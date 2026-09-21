/**
 * Repository hygiene checks that are cheap to run and expensive to discover late.
 *
 * Both of these guard failures that are SILENT. A source file with a NUL byte is treated
 * by git as binary, so its diffs and history vanish without any error; that happened twice
 * while this migration was being written. A committed NRIC cannot be removed from history
 * in practice.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');

/**
 * Lists the repository's tracked files.
 *
 * Uses git rather than a directory walk so that ignored files -- which is where the real
 * personnel data lives -- are never read.
 *
 * @returns Tracked paths, relative to the repository root.
 */
function trackedFiles(): string[] {
  const result = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').filter(Boolean);
}

/** Extensions worth scanning: text formats where a NUL byte is always a mistake. */
const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|json|md|css|html|sql|yml|yaml)$/;

describe('source files are text', () => {
  test('the file listing actually found files', () => {
    // Without this, a failing `git ls-files` would make every check below pass vacuously.
    expect(trackedFiles().filter((p) => TEXT_EXTENSIONS.test(p)).length).toBeGreaterThan(50);
  });

  test('no tracked text file contains a NUL byte', () => {
    /*
     * A literal 0x00 in a source file makes git treat the blob as binary, so every future
     * diff of that file reads "Binary files differ" and its history becomes unreviewable.
     * It also means any editor or stream-edit round-trip can silently mangle the file.
     *
     * If a NUL is genuinely wanted as a value -- it was, as a Map-key separator -- write it
     * as the escape sequence rather than the byte.
     */
    const offenders = trackedFiles()
      .filter((path) => TEXT_EXTENSIONS.test(path))
      .filter((path) => {
        try {
          return readFileSync(join(REPO_ROOT, path)).includes(0x00);
        } catch {
          return false;
        }
      });

    expect(offenders).toEqual([]);
  });
});

describe('personnel data stays out of git', () => {
  test('the files holding real NRICs and names are ignored', () => {
    /*
     * formsg.csv holds 2,376 SingPass-validated NRICs; the parade-state samples and the
     * format template hold full names, 4D numbers and diagnoses. All were untracked and
     * unignored at one point, one `git add .` away from being permanent.
     */
    const mustBeIgnored = [
      'formsg.csv',
      'parade-state-example.txt',
      'parade_state_template_new.md',
    ];

    const notIgnored = mustBeIgnored.filter((path) => {
      const result = spawnSync('git', ['check-ignore', '-q', path], { cwd: REPO_ROOT });
      return result.status !== 0;
    });

    expect(notIgnored).toEqual([]);
  });

  test('no tracked file contains something shaped like a real NRIC', () => {
    /*
     * Test fixtures deliberately use NRIC-shaped placeholders, so this allows the two that
     * exist by name rather than by pattern. Anything else matching is a leak.
     */
    /*
     * Each of these exists so a test can prove an NRIC does NOT reach somewhere:
     *   S1234568B  a FormSG webhook fixture in the Apps Script harness
     *   T0573638I  asserted absent from the dashboard feed reply
     *   T0000001A  asserted absent from a mapped FormSG row
     * They have to be NRIC-shaped to be worth anything, so they are allowed by exact value
     * rather than by loosening the pattern.
     */
    const ALLOWED = new Set(['S1234568B', 'T0573638I', 'T0000001A']);
    const NRIC = /\b[STFGM]\d{7}[A-Z]\b/g;

    const found: string[] = [];
    for (const path of trackedFiles().filter((p) => TEXT_EXTENSIONS.test(p))) {
      let text: string;
      try {
        text = readFileSync(join(REPO_ROOT, path), 'utf8');
      } catch {
        continue;
      }
      for (const match of text.match(NRIC) ?? []) {
        if (!ALLOWED.has(match)) found.push(`${path}: ${match.slice(0, 2)}…`);
      }
    }

    expect(found).toEqual([]);
  });
});
