import { passwordProblem } from './auth.js';
import { createDb } from './db/client.js';
import { getDatabaseUrl } from './env.js';
import { setPassword } from './routes/auth.js';

/** Reads a line from the terminal without showing what's typed. */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(new Error('Run this in a terminal, so the password isn’t shown.'));
  }
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    let value = '';
    const finish = (result: string | null) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (result === null) process.exit(130);
      resolve(result);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish(value);
        if (char === '\u0003') return finish(null); // Ctrl-C
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const password = await readHidden('New password: ');
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if ((await readHidden('Type it again: ')) !== password) {
    throw new Error('The passwords don’t match. Nothing was changed.');
  }

  const { db, close } = createDb(getDatabaseUrl());
  try {
    await setPassword(db, password);
  } finally {
    await close();
  }
  console.log('Password set. Every device is signed out and will need it to sign in again.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
