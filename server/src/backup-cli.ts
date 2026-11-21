import { checkBackup, newestBackups, parseBackupDirs, runBackup } from './backup.js';
import { getBackupDirsSetting, getDatabaseUrl, getPgBin } from './env.js';

/** A backup older than this means the nightly job has missed a night. */
const STALE_HOURS = 36;

const dirs = parseBackupDirs(getBackupDirsSetting());
const pgBin = getPgBin();

function age(date: Date) {
  const hours = (Date.now() - date.getTime()) / (60 * 60 * 1000);
  if (hours < 1) return 'under an hour old';
  return hours < 48 ? `${Math.round(hours)} hours old` : `${Math.round(hours / 24)} days old`;
}

/** `npm run backup`: backs up now, to every folder. */
async function backup() {
  const stamp = new Date().toISOString();
  const results = await runBackup({ databaseUrl: getDatabaseUrl(), dirs, pgBin });
  for (const result of results) {
    if (result.ok) {
      const pruned = result.deleted.length > 0 ? `, removed ${result.deleted.length} old` : '';
      console.log(`${stamp} OK    ${result.dir}${pruned}`);
    } else {
      console.error(`${stamp} FAIL  ${result.dir}: ${result.error}`);
    }
  }
  return results.every((result) => result.ok);
}

/** `npm run backup:check`: restores the newest backup into a throwaway database to prove it works. */
async function check(file?: string) {
  let path = file;
  if (!path) {
    const newest = (await newestBackups(dirs))
      .filter((item) => item.name !== null)
      .sort((a, b) => b.date!.getTime() - a.date!.getTime())[0];
    if (!newest) throw new Error('No backups found. Run npm run backup first.');
    path = `${newest.dir}/${newest.name}`;
  }
  console.log(`Restoring ${path} into a throwaway database…`);
  const result = await checkBackup({ databaseUrl: getDatabaseUrl(), file: path, pgBin });
  for (const table of result.tables) {
    const mark = table.live === table.restored ? 'OK  ' : 'DIFF';
    console.log(`  ${mark} ${table.name}: ${table.restored} restored, ${table.live} live`);
  }
  console.log(
    result.matches
      ? 'The backup restores completely. The throwaway database is deleted.'
      : 'Some tables differ. If you changed data since the backup, that explains it; otherwise back up again and check.',
  );
  return result.matches;
}

/** Used by deploy/status.sh: each folder's newest backup, failing if one is missing or stale. */
async function status() {
  if (dirs.length === 0) {
    console.log('SKIP  Backups aren’t set up (BACKUP_DIRS in .env)');
    return true;
  }
  let ok = true;
  for (const item of await newestBackups(dirs)) {
    const fresh = item.date && Date.now() - item.date.getTime() < STALE_HOURS * 60 * 60 * 1000;
    if (item.error) console.log(`FAIL  Backups in ${item.dir}: ${item.error}`);
    else if (!item.date) console.log(`FAIL  No backups yet in ${item.dir}`);
    else
      console.log(`${fresh ? 'OK  ' : 'FAIL'}  Newest backup in ${item.dir} is ${age(item.date)}`);
    ok &&= Boolean(fresh) && !item.error;
  }
  return ok;
}

const [command, argument] = process.argv.slice(2);
const commands: Record<string, () => Promise<boolean>> = {
  backup,
  check: () => check(argument),
  status,
};

try {
  const action = commands[command ?? ''];
  if (!action) throw new Error('Use one of: backup, check [file], status');
  process.exitCode = (await action()) ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
