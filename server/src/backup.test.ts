import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupDate,
  backupFileName,
  backupsToDelete,
  checkBackup,
  newestBackups,
  parseBackupDirs,
  runBackup,
} from './backup.js';
import { createDb } from './db/client.js';
import { addDemoData } from './demo.js';
import { getTestDatabaseUrl } from './env.js';
import { resetDb } from './test/reset-db.js';

const databaseUrl = getTestDatabaseUrl();
const { db, close } = createDb(databaseUrl);

/** A backup's name for a local date and time. */
const named = (year: number, month: number, day: number, hours = 3) =>
  backupFileName(new Date(year, month - 1, day, hours, 0));

describe('backup names', () => {
  it('are made from the local time and read back', () => {
    const date = new Date(2026, 10, 21, 3, 5, 9);
    expect(backupFileName(date)).toBe('pretty-penny-2026-11-21-030509.dump');
    expect(backupDate('pretty-penny-2026-11-21-030509.dump')).toEqual(date);
    expect(backupDate('pretty-penny-2026-11-21-030509.dump.partial')).toBeNull();
    expect(backupDate('pretty-penny-2026-11-21-0305.dump')).toBeNull();
    expect(backupDate('notes.txt')).toBeNull();
  });
});

describe('which backups to keep', () => {
  const now = new Date(2026, 10, 21, 12);

  it('keeps every backup from the last 30 days', () => {
    const recent = Array.from({ length: 30 }, (_, index) => named(2026, 10, 23 + index));
    expect(backupsToDelete(recent, now)).toEqual([]);
  });

  it('keeps the first backup of each of the last 12 months, and deletes the rest', () => {
    const names = [
      named(2025, 10, 1), // 13 months back: deleted
      named(2025, 12, 1),
      named(2025, 12, 2), // not the first in its month: deleted
      named(2026, 3, 15), // the first in March, even though not on the 1st
      named(2026, 3, 20),
      named(2026, 9, 30),
      named(2026, 10, 1),
      named(2026, 10, 20), // older than 30 days: deleted
      named(2026, 10, 25),
    ];
    expect(backupsToDelete(names, now)).toEqual([
      named(2025, 10, 1),
      named(2025, 12, 2),
      named(2026, 3, 20),
      named(2026, 10, 20),
    ]);
  });

  it('always keeps the newest, and never touches other files', () => {
    const names = [named(2024, 1, 5), named(2024, 2, 5), 'notes.txt', 'x.dump.partial'];
    expect(backupsToDelete(names, now)).toEqual([named(2024, 1, 5)]);
    expect(backupsToDelete(['notes.txt'], now)).toEqual([]);
  });
});

describe('backup folders', () => {
  it('are read from BACKUP_DIRS, with ~ for the home folder', () => {
    expect(
      parseBackupDirs(
        ' /Volumes/Backup Drive/Pretty Penny : ~/Library/Mobile Documents/x ::',
        '/Users/me',
      ),
    ).toEqual(['/Volumes/Backup Drive/Pretty Penny', '/Users/me/Library/Mobile Documents/x']);
    expect(parseBackupDirs(undefined)).toEqual([]);
  });
});

describe('backing up and restoring', () => {
  let folders: string[] = [];

  beforeEach(async () => {
    await resetDb(db);
    await addDemoData(db, '2026-11');
    folders = [
      await mkdtemp(join(tmpdir(), 'pp-backup-a-')),
      await mkdtemp(join(tmpdir(), 'pp-backup-b-')),
    ];
  });

  afterEach(async () => {
    for (const folder of folders) await rm(folder, { recursive: true, force: true });
  });

  afterAll(() => close());

  it('saves to every folder, prunes old backups, and reports a missing folder', async () => {
    await writeFile(join(folders[0]!, named(2024, 1, 1)), 'old');
    await writeFile(join(folders[0]!, 'notes.txt'), 'mine');
    const missing = join(folders[1]!, 'unplugged-drive');
    const now = new Date(2026, 10, 21, 3, 0);

    const results = await runBackup({ databaseUrl, dirs: [...folders, missing], now });
    expect(results).toEqual([
      { dir: folders[0], ok: true, deleted: [named(2024, 1, 1)] },
      { dir: folders[1], ok: true, deleted: [] },
      {
        dir: missing,
        ok: false,
        error: 'The folder doesn’t exist. If it’s on a drive, is the drive connected?',
        deleted: [],
      },
    ]);
    expect((await readdir(folders[0]!)).sort()).toEqual([
      'notes.txt',
      'pretty-penny-2026-11-21-030000.dump',
    ]);

    const newest = await newestBackups([folders[1]!, missing]);
    expect(newest[0]).toMatchObject({ name: 'pretty-penny-2026-11-21-030000.dump' });
    expect(newest[1]).toMatchObject({ name: null, error: expect.stringContaining('connected') });
  });

  it('restores a backup into a throwaway database that matches the live data', async () => {
    await runBackup({ databaseUrl, dirs: [folders[0]!] });
    const [name] = await readdir(folders[0]!);

    const result = await checkBackup({ databaseUrl, file: join(folders[0]!, name!) });
    expect(result.matches).toBe(true);
    expect(result.tables.find((table) => table.name === 'accounts')).toEqual({
      name: 'accounts',
      live: 6,
      restored: 6,
    });
    expect(result.tables.map((table) => table.name)).not.toContain('sessions');
  });

  it('explains a folder it isn’t allowed to write to, or a file in place of a folder', async () => {
    const locked = join(folders[0]!, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o500);
    const file = join(folders[0]!, 'a-file');
    await writeFile(file, 'not a folder');

    const results = await runBackup({ databaseUrl, dirs: [locked, file] });
    await chmod(locked, 0o700);
    expect(results.map((result) => result.error)).toEqual([
      'Not allowed to write there. See docs/self-hosting.md, Backups, about Full Disk Access.',
      `${file} isn’t a folder.`,
    ]);
  });

  it('refuses to run with no folders set', async () => {
    await expect(runBackup({ databaseUrl, dirs: [] })).rejects.toThrow('Add BACKUP_DIRS to .env');
  });
});
