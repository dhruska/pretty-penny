import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';

const run = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Postgres 17's own tools, from Homebrew, which match the server's version. */
export const DEFAULT_PG_BIN = '/opt/homebrew/opt/postgresql@17/bin';
/** Homebrew's Postgres listens on this socket, where the Mac's own user can sign in. */
export const DEFAULT_PG_SOCKET = '/tmp/.s.PGSQL.5432';
/** Every backup from the last 30 days, plus the first of each month for 12 months. */
export const RETENTION = { days: 30, months: 12 };

const NAME = /^pretty-penny-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/;
const pad = (value: number) => String(value).padStart(2, '0');
const monthKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

/**
 * A backup's file name from its local time, such as pretty-penny-2026-11-21-030000.dump. Seconds
 * keep two backups in the same minute, such as restore's safety backup, from sharing a name.
 */
export function backupFileName(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `pretty-penny-${day}-${time}.dump`;
}

/** When a backup was made, from its file name, or null for any other file. */
export function backupDate(name: string): Date | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds] = match.map(Number);
  return new Date(year!, month! - 1, day!, hours!, minutes!, seconds!);
}

/**
 * Which backups to delete from a folder: all but those from the last 30 days, the first of each
 * of the last 12 months, and the newest. Files that aren't backups are never deleted.
 */
export function backupsToDelete(names: string[], now: Date, retention = RETENTION): string[] {
  const backups = names
    .map((name) => ({ name, date: backupDate(name) }))
    .filter((backup): backup is { name: string; date: Date } => backup.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (backups.length === 0) return [];

  const keep = new Set([backups.at(-1)!.name]);
  const cutoff = now.getTime() - retention.days * DAY_MS;
  for (const backup of backups) if (backup.date.getTime() >= cutoff) keep.add(backup.name);

  const months = new Set<string>();
  for (let index = 0; index < retention.months; index += 1) {
    months.add(monthKey(new Date(now.getFullYear(), now.getMonth() - index, 1)));
  }
  const firstOfMonth = new Map<string, string>();
  for (const backup of backups) {
    const key = monthKey(backup.date);
    if (!firstOfMonth.has(key)) firstOfMonth.set(key, backup.name);
  }
  for (const [key, name] of firstOfMonth) if (months.has(key)) keep.add(name);

  return backups.filter((backup) => !keep.has(backup.name)).map((backup) => backup.name);
}

/** The backup folders from BACKUP_DIRS: separated by colons, with ~ for the home folder. */
export function parseBackupDirs(value: string | undefined, home = homedir()): string[] {
  return (value ?? '')
    .split(':')
    .map((dir) => dir.trim())
    .filter((dir) => dir !== '')
    .map((dir) => (dir === '~' || dir.startsWith('~/') ? home + dir.slice(1) : dir));
}

export interface BackupOptions {
  databaseUrl: string;
  dirs: string[];
  pgBin?: string;
  now?: Date;
}

export interface DestinationResult {
  dir: string;
  ok: boolean;
  error?: string;
  deleted: string[];
}

/** Why a folder can't take a backup, in words. */
function folderProblem(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT')
    return 'The folder doesn’t exist. If it’s on a drive, is the drive connected?';
  if (code === 'EPERM' || code === 'EACCES') {
    return 'Not allowed to write there. See docs/self-hosting.md, Backups, about Full Disk Access.';
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Saves a backup of the database into each folder and prunes old ones. A folder that's missing,
 * such as on an unplugged drive, is reported without stopping the others.
 */
export async function runBackup(options: BackupOptions): Promise<DestinationResult[]> {
  if (options.dirs.length === 0)
    throw new Error('No backup folders are set. Add BACKUP_DIRS to .env.');
  const pgBin = options.pgBin ?? DEFAULT_PG_BIN;
  const now = options.now ?? new Date();
  const workDir = await mkdtemp(join(tmpdir(), 'pretty-penny-backup-'));
  try {
    const file = join(workDir, backupFileName(now));
    // Sessions aren't kept, so a restored backup signs every device out.
    await run(join(pgBin, 'pg_dump'), [
      '--format=custom',
      '--exclude-table-data=sessions',
      `--file=${file}`,
      `--dbname=${options.databaseUrl}`,
    ]);
    // Reading the file's contents list back proves it isn't truncated or corrupt.
    await run(join(pgBin, 'pg_restore'), ['--list', file]);

    const results: DestinationResult[] = [];
    for (const dir of options.dirs) {
      try {
        if (!(await stat(dir)).isDirectory()) throw new Error(`${dir} isn’t a folder.`);
        // Copied under a temporary name first, so a half-written file never looks like a backup.
        const target = join(dir, basename(file));
        await copyFile(file, `${target}.partial`);
        await rename(`${target}.partial`, target);
        const deleted = backupsToDelete(await readdir(dir), now);
        for (const name of deleted) await unlink(join(dir, name));
        results.push({ dir, ok: true, deleted });
      } catch (error) {
        results.push({ dir, ok: false, error: folderProblem(error), deleted: [] });
      }
    }
    return results;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export interface NewestBackup {
  dir: string;
  name: string | null;
  date: Date | null;
  error?: string;
}

/** Each folder's newest backup, for the status check. */
export async function newestBackups(dirs: string[]): Promise<NewestBackup[]> {
  return Promise.all(
    dirs.map(async (dir) => {
      try {
        const names = (await readdir(dir)).filter((name) => backupDate(name) !== null).sort();
        const name = names.at(-1) ?? null;
        return { dir, name, date: name ? backupDate(name) : null };
      } catch (error) {
        return { dir, name: null, date: null, error: folderProblem(error) };
      }
    }),
  );
}

export interface CheckResult {
  tables: { name: string; live: number; restored: number }[];
  matches: boolean;
}

async function rowCounts(sql: postgres.Sql) {
  const tables = await sql<{ name: string }[]>`
    select table_name as name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'sessions'
    order by table_name`;
  const counts = new Map<string, number>();
  for (const { name } of tables) {
    const [row] = await sql<{ count: number }[]>`select count(*)::int as count from ${sql(name)}`;
    counts.set(name, row!.count);
  }
  return counts;
}

/**
 * Proves a backup can be restored: restores it into a throwaway database, as the Mac's own
 * Postgres user, compares each table's row count with the live data, then deletes it.
 */
export async function checkBackup(options: {
  databaseUrl: string;
  file: string;
  pgBin?: string;
  socket?: string;
}): Promise<CheckResult> {
  const pgBin = options.pgBin ?? DEFAULT_PG_BIN;
  const socket = options.socket ?? DEFAULT_PG_SOCKET;
  const socketDir = socket.slice(0, socket.lastIndexOf('/'));
  const name = `pretty_penny_restore_check_${Date.now()}`;
  const connection = ['--host', socketDir];

  await run(join(pgBin, 'createdb'), [...connection, name]);
  const live = postgres(options.databaseUrl, { onnotice: () => {} });
  const restored = postgres({ path: socket, database: name, onnotice: () => {} });
  try {
    await run(join(pgBin, 'pg_restore'), [
      ...connection,
      '--no-owner',
      `--dbname=${name}`,
      options.file,
    ]);
    const liveCounts = await rowCounts(live);
    const restoredCounts = await rowCounts(restored);
    const names = [...new Set([...liveCounts.keys(), ...restoredCounts.keys()])].sort();
    const tables = names.map((table) => ({
      name: table,
      live: liveCounts.get(table) ?? 0,
      restored: restoredCounts.get(table) ?? 0,
    }));
    return { tables, matches: tables.every((table) => table.live === table.restored) };
  } finally {
    await live.end();
    await restored.end();
    await run(join(pgBin, 'dropdb'), [...connection, '--if-exists', name]);
  }
}
