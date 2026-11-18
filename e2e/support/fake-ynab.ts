import { createServer } from 'node:http';
import { sampleYnabPlan } from '../../server/src/test/ynab-plan';

/**
 * A stand-in for YNAB's API during browser tests, serving the made-up sample plan. It accepts
 * only the token below, so tests can also check how a rejected token is shown.
 */
const FAKE_YNAB_TOKEN = 'fake-ynab-token';
const port = Number(process.env.FAKE_YNAB_PORT ?? 3102);

const server = createServer((request, response) => {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  if (request.url === '/health') return send(200, { ok: true });
  if (request.headers.authorization !== `Bearer ${FAKE_YNAB_TOKEN}`) {
    return send(401, { error: { id: '401', name: 'unauthorized' } });
  }

  const plan = sampleYnabPlan();
  if (request.url === '/v1/plans') {
    return send(200, {
      data: { plans: [{ id: plan.id, name: plan.name, last_modified_on: null }] },
    });
  }
  if (request.url === `/v1/plans/${plan.id}`) {
    return send(200, { data: { plan, server_knowledge: 1 } });
  }
  return send(404, { error: { id: '404', name: 'not_found' } });
});

server.listen(port, '127.0.0.1');
