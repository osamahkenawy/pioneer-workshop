// Integration API (/api/v1) smoke test. LOCAL ONLY; cleans up by id baseline.
import { createRequire } from 'module'; import fs from 'fs'; import crypto from 'crypto';
import { fileURLToPath } from 'url';
const BE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(BE + '/package.json');
const mysql = require('mysql2/promise'); const bcrypt = require('bcryptjs');
const env = Object.fromEntries(fs.readFileSync(BE + '/.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (!['localhost', '127.0.0.1'].includes(env.DB_HOST)) throw new Error('local only');
const db = await mysql.createConnection({ host: '127.0.0.1', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const q = async (s, p = []) => (await db.query(s, p))[0];
const API = 'http://localhost:4000/api';
const out = []; const expect = (w, ok, d) => out.push(`${ok ? 'PASS' : 'FAIL'}  ${w}${d ? '  — ' + d : ''}`);
const call = async (method, path, headers, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j };
};
const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`)).map(r => r.t);
const baseline = {}; for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;
try {
  const pw = 'Qa' + crypto.randomBytes(8).toString('hex') + '1';
  const mk = async (username, role, slug) => {
    const [r] = slug ? await q('SELECT id FROM roles WHERE slug = ?', [slug]) : [null];
    await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, role_id, is_active) VALUES (1,?,?,?,?,?,?,1)`, [`QA ${role}`, username, `${username}@example.invalid`, await bcrypt.hash(pw, 10), role, r?.id || null]);
    return (await call('POST', '/auth/login', {}, { username, password: pw })).json?.data?.token;
  };
  const mgr = await mk('qa_api_manager', 'workshop_manager', 'workshop_manager');
  const disp = await mk('qa_api_dispatcher', 'dispatcher');
  const dk = await call('POST', '/integrations', { Authorization: `Bearer ${disp}` }, { name: 'QA disp key', permissions: 'full' });
  expect('dispatcher cannot mint a full-access API key', dk.status === 403, `HTTP ${dk.status}`);
  const k = await call('POST', '/integrations', { Authorization: `Bearer ${mgr}` }, { name: 'QA key', permissions: 'full' });
  const key = k.json?.data?.api_key; const H = { 'X-API-Key': key };
  expect('manager can create an API key', k.status === 201 && !!key, `HTTP ${k.status}`);
  const created = await call('POST', '/v1/work_orders', H, { customer_name: 'QA API Customer', customer_phone: '+971500000444', description: 'QA API brake check', service_fee: 80, items: [{ name: 'Brake pads', quantity: 1, unit_price: 150 }] });
  const wo = created.json?.data;
  expect('create work order via API (was a 500 on every call)', created.status === 201 && wo?.id, `HTTP ${created.status} ${created.json?.message || ''}`);
  expect('API job card is priced by the server (80 + 150 + VAT 11.50 = 241.50)', Number(wo?.total_amount) === 241.5 && wo?.items?.length === 1, `total ${wo?.total_amount}`);
  const bad = await call('POST', '/v1/work_orders', H, { customer_name: 'x' });
  expect('missing fields give a 400', bad.status === 400, `HTTP ${bad.status}`);
  const list = await call('GET', '/v1/work_orders?limit=2', H);
  expect('list work orders via API (was a 500)', list.status === 200 && list.json?.data?.length === 2 && list.json.pagination.total > 18000, `HTTP ${list.status}, total ${list.json?.pagination?.total}`);
  const one = await call('GET', `/v1/work_orders/${wo?.id}`, H);
  expect('get one by id', one.status === 200 && one.json?.data?.status_history?.length >= 1, `HTTP ${one.status}`);
  const tr = await call('GET', `/v1/service-status/${wo?.service_status_token}`, H);
  expect('status lookup by token (was a 500)', tr.status === 200 && tr.json?.data?.id === wo?.id, `HTTP ${tr.status}`);
  const cx = await call('PATCH', `/v1/work_orders/${wo?.id}/cancel`, H, { reason: 'QA test' });
  const [after] = await q('SELECT status, cancellation_reason FROM work_orders WHERE id = ?', [wo?.id]);
  expect('cancel via API records the reason', cx.status === 200 && after.status === 'cancelled' && after.cancellation_reason === 'QA test', `HTTP ${cx.status}, ${after.status}`);
  // a throwaway job card marked completed — never a real one
  const second = (await call('POST', '/v1/work_orders', H, { customer_name: 'QA API Customer', customer_phone: '+971500000444', description: 'QA API second' })).json?.data;
  await q("UPDATE work_orders SET status = 'completed' WHERE id = ? AND id > ?", [second.id, baseline.work_orders]);
  const done = second;
  const cx2 = await call('PATCH', `/v1/work_orders/${done.id}/cancel`, H, {});
  const [still] = await q('SELECT status FROM work_orders WHERE id = ?', [done.id]);
  expect('completed job cannot be cancelled via API', cx2.status === 409 && still.status === 'completed', `HTTP ${cx2.status}`);
  const cs = await call('GET', '/v1/customers', H);
  expect('list customers via API', cs.status === 200 && cs.json?.data?.length > 1000, `HTTP ${cs.status}, ${cs.json?.data?.length} customers ${cs.json?.message || ''}`);
  const nokey = await call('GET', '/v1/work_orders', {});
  expect('API needs a key', nokey.status === 401, `HTTP ${nokey.status}`);
} catch (e) { out.push('ERROR ' + e.stack); }
finally {
  await q('SET FOREIGN_KEY_CHECKS = 0'); const removed = {};
  for (const t of idTables) { const r = await q(`DELETE FROM \`${t}\` WHERE id > ?`, [baseline[t]]); if (r.affectedRows) removed[t] = r.affectedRows; }
  await q('SET FOREIGN_KEY_CHECKS = 1'); await db.end();
  console.log(out.join('\n')); console.log(`\n${out.filter(l => l.startsWith('PASS')).length} passed, ${out.filter(l => l.startsWith('FAIL')).length} failed · cleanup ${JSON.stringify(removed)}`);
}
