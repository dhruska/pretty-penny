import { createServer } from 'node:http';
import { createFakePlaid, LOGIN_REQUIRED } from '../../server/src/bank/fake-plaid';

/**
 * A stand-in for Plaid's API during browser tests, with a made-up bank. Tests control it
 * through the /fake routes: resetting it, and making the bank want you to sign in again.
 */
const port = Number(process.env.FAKE_PLAID_PORT ?? 3103);
const plaid = createFakePlaid();

const server = createServer((request, response) => {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  let text = '';
  request.on('data', (chunk) => (text += chunk));
  request.on('end', () => {
    const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    switch (request.url) {
      case '/health':
        return send(200, { ok: true });
      case '/fake/reset':
        plaid.reset();
        return send(200, { ok: true });
      case '/fake/login-required':
        plaid.setItemError(body.on ? LOGIN_REQUIRED : null);
        return send(200, { ok: true });
      default: {
        const answer = plaid.handle(request.url ?? '', body);
        return send(answer.status, answer.body);
      }
    }
  });
});

server.listen(port, '127.0.0.1');
