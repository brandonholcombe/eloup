import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeForHash,
  parseLapMonitorTxt,
  parseLapTimeMs,
  txtHash,
} from '@/lib/rc/import-txt';

const FIXTURE_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'Agents',
  'fixtures',
  'lap-monitor-sample.txt',
);

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf8');
}

describe('parseLapTimeMs', () => {
  it('parses 0:15.23 as 15230 ms', () => {
    expect(parseLapTimeMs('0:15.23')).toBe(15230);
  });

  it('parses 5:10.70 as 310700 ms', () => {
    expect(parseLapTimeMs('5:10.70')).toBe(310700);
  });

  it('parses 0:07.41 (the initial cumulative shape) as 7410 ms', () => {
    expect(parseLapTimeMs('0:07.41')).toBe(7410);
  });

  it('parses 12:34.56 as 754560 ms (multi-digit minutes)', () => {
    expect(parseLapTimeMs('12:34.56')).toBe(754560);
  });

  it('parses 0:00.01 as 10 ms', () => {
    expect(parseLapTimeMs('0:00.01')).toBe(10);
  });

  it('rejects malformed inputs', () => {
    expect(parseLapTimeMs('0:0.0')).toBeNull();
    expect(parseLapTimeMs('15:23')).toBeNull();
    expect(parseLapTimeMs('garbage')).toBeNull();
    expect(parseLapTimeMs('')).toBeNull();
  });

  it('tolerates leading/trailing whitespace', () => {
    expect(parseLapTimeMs('  0:15.23  ')).toBe(15230);
  });
});

describe('normalizeForHash + txtHash', () => {
  it('is stable across \\r\\n vs \\n line endings', () => {
    const lf = 'R2\n\nRace    May 17, 2026 at 2:54:26 PM\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(txtHash(lf)).toBe(txtHash(crlf));
  });

  it('is stable across trailing whitespace on lines', () => {
    const clean = 'R2\nRace    May 17, 2026 at 2:54:26 PM\n';
    const dirty = 'R2  \t\nRace    May 17, 2026 at 2:54:26 PM   \n';
    expect(txtHash(clean)).toBe(txtHash(dirty));
  });

  it('is stable across collapsed multi-blank-line runs', () => {
    const single = 'R2\n\nRace\n';
    const triple = 'R2\n\n\n\nRace\n';
    expect(txtHash(single)).toBe(txtHash(triple));
  });

  it('produces distinct hashes for content changes', () => {
    expect(txtHash('R2')).not.toBe(txtHash('R3'));
  });

  it('strips leading/trailing blank lines', () => {
    expect(normalizeForHash('\n\nR2\n\n')).toBe('R2');
  });
});

describe('parseLapMonitorTxt — happy path against the real fixture', () => {
  it('parses race header, kind, started_at, and driver count', () => {
    const result = parseLapMonitorTxt(loadFixture());
    if ('error' in result) {
      throw new Error(`unexpected error: ${result.error}`);
    }
    expect(result.raceName).toBe('R2');
    expect(result.raceKind).toBe('race');
    expect(result.raceStartedAt).toBe('2026-05-17T14:54:26');
    expect(result.drivers).toHaveLength(2);
    expect(result.drivers.map((d) => d.name)).toEqual(['Sean', 'Brandon']);
  });

  it('parses 21 laps per driver with the right magnitudes', () => {
    const result = parseLapMonitorTxt(loadFixture());
    if ('error' in result) throw new Error(result.error);
    expect(result.drivers[0]!.laps).toHaveLength(21);
    expect(result.drivers[1]!.laps).toHaveLength(21);
    // Sean lap 0 is initial (lapTimeMs = 0, endTimestampMs = 7410).
    expect(result.drivers[0]!.laps[0]).toMatchObject({
      kind: 'initial',
      lapTimeMs: 0,
      endTimestampMs: 7410,
      userIndex: 0,
    });
    // Sean lap 1 is normal, 0:15.23 = 15230 ms.
    expect(result.drivers[0]!.laps[1]).toMatchObject({
      kind: 'normal',
      lapTimeMs: 15230,
      userIndex: 1,
    });
    // Brandon lap 15 is normal, 0:28.96 = 28960 ms (the crash lap).
    expect(result.drivers[1]!.laps[15]).toMatchObject({
      kind: 'normal',
      lapTimeMs: 28960,
      userIndex: 15,
    });
  });
});

describe('parseLapMonitorTxt — whole-file-fatal validation', () => {
  it('rejects an empty file', () => {
    const result = parseLapMonitorTxt('');
    expect(result).toEqual({ error: 'empty file' });
  });

  it('rejects a file with only whitespace', () => {
    const result = parseLapMonitorTxt('   \n\n   \t  \n');
    expect(result).toEqual({ error: 'empty file' });
  });

  it('rejects a malformed date row', () => {
    const txt = 'R2\n\nRace    May the 17th, 2026 at 2:54 PM\n';
    const result = parseLapMonitorTxt(txt);
    if (!('error' in result)) throw new Error('expected error');
    expect(result.error).toMatch(/date row/);
  });

  it('rejects an unknown race kind', () => {
    const txt = 'R2\n\nFunRun    May 17, 2026 at 2:54:26 PM\n\nSean:\nLap 0: 0:07.41\n';
    const result = parseLapMonitorTxt(txt);
    if (!('error' in result)) throw new Error('expected error');
    expect(result.error).toMatch(/race kind/);
  });

  it('rejects a missing date row', () => {
    const txt = 'R2\n\nSean:\nLap 0: 0:07.41\n';
    const result = parseLapMonitorTxt(txt);
    if (!('error' in result)) throw new Error('expected error');
    expect(result.error).toMatch(/date row/);
  });

  it('rejects a malformed lap line', () => {
    const txt = 'R2\n\nRace    May 17, 2026 at 2:54:26 PM\n\nSean:\nLap 1: bogus 0:22.64\n';
    const result = parseLapMonitorTxt(txt);
    if (!('error' in result)) throw new Error('expected error');
    expect(result.error).toMatch(/lap/);
  });

  it('rejects an empty driver section', () => {
    const txt =
      'R2\n\nRace    May 17, 2026 at 2:54:26 PM\n\nSean:\n\nBrandon:\nLap 0: 0:06.73\n';
    const result = parseLapMonitorTxt(txt);
    if (!('error' in result)) throw new Error('expected error');
    expect(result.error).toMatch(/empty driver section/);
  });
});

describe('parseLapMonitorTxt — tolerant summary-table skip', () => {
  it('correctly skips a summary table with `| Laps  |` (two spaces)', () => {
    // This is the exact fixture shape — proves the tolerant regex works.
    const txt = `R2

Race    May 17, 2026 at 2:54:26 PM

 Timing data provided by LapMonitor lap counting system (https://lapmonitor.com)


    Driver     | Laps  |    Time    |  Best Lap
=================================================
Sean           |    20 |    5:00.47 |    0:13.03
Brandon        |    20 |    5:10.70 |    0:12.88


Sean:
Lap     0:             0:07.41
Lap     1:   0:15.23   0:22.64

Brandon:
Lap     0:             0:06.73
Lap     1:   0:14.07   0:20.81
`;
    const result = parseLapMonitorTxt(txt);
    if ('error' in result) throw new Error(result.error);
    expect(result.drivers).toHaveLength(2);
  });
});

describe('parseLapMonitorTxt — race kind dispatch', () => {
  it('parses Practice as practice', () => {
    const txt = 'R2\n\nPractice    May 17, 2026 at 2:54:26 PM\n\nSean:\nLap 0: 0:07.41\n';
    const result = parseLapMonitorTxt(txt);
    if ('error' in result) throw new Error(result.error);
    expect(result.raceKind).toBe('practice');
  });

  it('parses Qualif as qualif', () => {
    const txt = 'R2\n\nQualif    May 17, 2026 at 2:54:26 PM\n\nSean:\nLap 0: 0:07.41\n';
    const result = parseLapMonitorTxt(txt);
    if ('error' in result) throw new Error(result.error);
    expect(result.raceKind).toBe('qualif');
  });

  it('is case-insensitive on kind', () => {
    const txt = 'R2\n\nRACE    May 17, 2026 at 2:54:26 PM\n\nSean:\nLap 0: 0:07.41\n';
    const result = parseLapMonitorTxt(txt);
    if ('error' in result) throw new Error(result.error);
    expect(result.raceKind).toBe('race');
  });
});
