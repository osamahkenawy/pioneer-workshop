// Regression test for the job-card leak fixes (process steps 4-6), LOCAL ONLY:
// localhost:4000 + the DB in car-workshop-backend/.env. Creates LEAKTEST
// records, asserts the fixed behaviour, then deletes everything it created.
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';

import { fileURLToPath } from 'url';
const BE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(BE + '/package.json');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const env = Object.fromEntries(fs.readFileSync(BE + '/.env', 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (env.DB_HOST !== 'localhost' && env.DB_HOST !== '127.0.0.1') throw new Error('refusing to run against a non-local DB');
const API = 'http://localhost:4000/api';
const db = await mysql.createConnection({ host: '127.0.0.1', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const q = async (sql, p = []) => (await db.query(sql, p))[0];

const out = [];
const expect = (scenario, what, ok, detail) => out.push({ scenario, what, result: ok ? 'PASS' : 'FAIL', detail });
let token = null;
async function api(method, path, body, { auth = true } = {}) {
  const r = await fetch(API + path, { method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const wo = async id => (await q('SELECT * FROM work_orders WHERE id = ?', [id]))[0];
const inv = async woId => (await q('SELECT * FROM invoices WHERE work_order_id = ?', [woId]))[0];
const invLines = async invId => q('SELECT item_type, description, quantity, unit_price, total FROM invoice_items WHERE invoice_id = ? ORDER BY id', [invId]);
const n = x => Number(x);

const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns
  WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`)).map(r => r.t);
const baseline = {};
for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;
const created = { users: [], customers: [], vehicles: [], mechanics: [], work_orders: [], service_estimates: [] };
let legacySnapshot = null;

try {
  const pw = crypto.randomBytes(18).toString('hex');
  const u = await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, is_active, is_owner)
    VALUES (1, 'LEAKTEST Admin', 'leaktest_admin', 'leaktest-admin@example.invalid', ?, 'admin', 1, 0)`, [await bcrypt.hash(pw, 10)]);
  created.users.push(u.insertId);
  const c = await q(`INSERT INTO customers (workshop_id, full_name, phone, email) VALUES (1, 'LEAKTEST Customer', '+971500000999', 'leaktest-customer@example.invalid')`);
  created.customers.push(c.insertId);
  const v = await q(`INSERT INTO vehicles (workshop_id, customer_id, make, model, plate_number, vin) VALUES (1, ?, 'Toyota', 'Camry', 'LEAKTEST', 'LEAKTEST000000001')`, [c.insertId]);
  created.vehicles.push(v.insertId);
  const m = await q(`INSERT INTO mechanics (workshop_id, full_name, phone, is_active, status) VALUES (1, 'LEAKTEST Technician', '+971500000998', 1, 'available')`);
  created.mechanics.push(m.insertId);
  token = (await api('POST', '/auth/login', { username: 'leaktest_admin', password: pw }, { auth: false })).json?.data?.token;
  if (!token) throw new Error('login failed');
  const mkUser = async (username, role) => {
    const r = await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, is_active, is_owner)
      VALUES (1, ?, ?, ?, ?, ?, 1, 0)`, [`LEAKTEST ${role}`, username, `${username}@example.invalid`, await bcrypt.hash(pw, 10), role]);
    created.users.push(r.insertId);
    return (await api('POST', '/auth/login', { username, password: pw }, { auth: false })).json?.data?.token;
  };
  const adminToken = token;
  const dispatcherToken = await mkUser('leaktest_dispatcher', 'service_advisor'); // the advisor prices labour (Step 5)
  const managerToken = await mkUser('leaktest_manager', 'workshop_manager');
  const as = async (t, fn) => { const prev = token; token = t; try { return await fn(); } finally { token = prev; } };
  const CUST = c.insertId, VEH = v.insertId, MECH = m.insertId;

  const LINES = [
    { line_type: 'labour', description: 'AC compressor - labour', quantity: 1, unit_price: 100 },
    { line_type: 'parts', description: 'AC compressor - Genuine', quantity: 1, unit_price: 500 },
    { line_type: 'parts', description: 'Shock absorber - Genuine', quantity: 1, unit_price: 300 },
    { line_type: 'labour', description: 'Brake pad - labour', quantity: 1.5, unit_price: 80 },   // 1.5 h → 120
    { line_type: 'parts', description: 'Brake pads - Genuine', quantity: 1, unit_price: 150 },
  ];
  const sendEst = async lines => {
    const id = (await api('POST', '/estimates', { customer_id: CUST, vehicle_id: VEH, lines })).json.estimateId;
    created.service_estimates.push(id);
    const tok = (await api('POST', `/estimates/${id}/send`, { email: 'leaktest-customer@example.invalid' })).json.approval_url.split('/').pop();
    const L = (await api('GET', `/public/estimates/${tok}`, null, { auth: false })).json.lines;
    return { id, tok, L };
  };
  const decide = (tok, lineId, decision, extra = {}) =>
    api('POST', `/public/estimates/${tok}/lines/${lineId}/decide`, { decision, ...extra }, { auth: false });

  // ── A: estimate → partial approval → job card → team leader → extra item → invoice
  const A = 'A estimate path';
  const ea = await sendEst(LINES);
  for (const [i, d] of [[0, 'approved'], [1, 'approved'], [2, 'rejected'], [3, 'approved'], [4, 'approved']]) await decide(ea.tok, ea.L[i].id, d);
  const notes = await q(`SELECT title FROM user_notifications WHERE user_id = ? AND title LIKE '%partially approved%'`, [u.insertId]);
  expect(A, 'partial approval notifies the advisor', notes.length === 1, `${notes.length} notification(s)`);
  const conv = await api('POST', `/estimates/${ea.id}/convert-to-work-order`);
  const woA = conv.json.workOrderId; created.work_orders.push(woA);
  const items = await q('SELECT name, item_type, quantity, unit_price, estimate_line_id FROM work_order_items WHERE work_order_id = ?', [woA]);
  // approved: 100 + 500 + 1.5×80 + 150 = 870 → VAT 43.50 → 913.50
  expect(A, 'approved lines copied onto the job card', items.length === 4 && items.every(i => i.estimate_line_id),
    items.map(i => `${i.name} ×${n(i.quantity)} @${i.unit_price}`).join(' | '));
  expect(A, 'rejected line NOT on the job card', !items.some(i => i.name.startsWith('Shock')), '');
  const a0 = await wo(woA);
  expect(A, 'job card total = approved 870 + VAT 43.50 = 913.50', n(a0.total_amount) === 913.5 && a0.billing_basis === 'itemised',
    `basis ${a0.billing_basis}, items ${a0.cash_amount}, VAT ${a0.vat_amount}, total ${a0.total_amount}`);
  const again = await api('POST', `/estimates/${ea.id}/convert-to-work-order`);
  expect(A, 'converting twice is refused', again.status === 400 || again.status === 409, `HTTP ${again.status}`);

  const tl = await api('POST', '/team-leader/assign', { work_order_id: woA, mechanic_id: MECH });
  const ia = await inv(woA);
  expect(A, 'team leader assign raises the invoice', tl.status === 200 && !!ia, `HTTP ${tl.status}, invoice ${ia?.invoice_number}, total ${ia?.total_amount}`);
  const add = await api('POST', `/work-orders/${woA}/items`, { name: 'Coolant top-up', quantity: 1, unit_price: 45 });
  const ia2 = await inv(woA);
  // 870 + 45 = 915 → VAT 45.75 → 960.75
  expect(A, 'extra item flows to the unpaid invoice (915 + VAT 45.75 = 960.75)', add.status === 201 && n(ia2.total_amount) === 960.75,
    `invoice subtotal ${ia2.subtotal}, VAT ${ia2.tax_amount}, total ${ia2.total_amount}`);

  const jc = await api('POST', '/job-cards', { work_order_id: woA, estimate_id: ea.id, lines: [{ description: 'AC compressor - labour', line_type: 'labour' }] });
  const jcRow = (await q('SELECT created_by, vehicle_plate FROM job_cards WHERE id = ?', [jc.json?.jobCardId]))[0];
  expect(A, 'job card records its creator and the plate', jcRow?.created_by === u.insertId && jcRow?.vehicle_plate === 'LEAKTEST',
    `created_by ${jcRow?.created_by}, plate ${jcRow?.vehicle_plate}`);
  // Job card status by hand: the QC result only through POST /:id/qc, and only the floor moves it.
  const useQc = await api('PATCH', `/job-cards/${jc.json?.jobCardId}/status`, { status: 'qc_passed' });
  expect(A, 'QC result cannot be set through the status endpoint (USE_QC)', useQc.status === 400 && useQc.json?.code === 'USE_QC', `HTTP ${useQc.status} ${useQc.json?.code || ''}`);
  const advJc = await as(dispatcherToken, () => api('PATCH', `/job-cards/${jc.json?.jobCardId}/status`, { status: 'parts_requested' }));
  expect(A, 'a Service Advisor cannot move a job card status', advJc.status === 403, `HTTP ${advJc.status}`);
  const mr = await api('POST', '/inventory/requisitions', { job_card_id: jc.json.jobCardId, items: [{ part_number: 'BRK-G', description: 'Brake pads', quantity_requested: 1, unit_cost: 90 }] });
  expect(A, 'material requisition works', mr.status === 201, `HTTP ${mr.status}`);
  const mi = await api('POST', '/inventory/issues', { requisition_id: mr.json?.requisitionId, job_card_id: jc.json.jobCardId, items: [{ part_number: 'BRK-G', description: 'Brake pads', quantity: 1, unit_cost: 90 }] });
  expect(A, 'parts issue works', mi.status === 201, `HTTP ${mi.status}`);
  const ci = await api('POST', `/job-cards/${jc.json.jobCardId}/clock-in`, { mechanic_id: MECH });
  const co = await api('POST', `/job-cards/${jc.json.jobCardId}/clock-out`, { mechanic_id: MECH });
  expect(A, 'time booking start/stop works', ci.status === 201 && co.status === 200, `in ${ci.status}, out ${co.status}`);
  const audits = (await q(`SELECT COUNT(*) c FROM audit_logs WHERE user_id = ? AND entity_type IN ('job_cards','material_issues')`, [u.insertId]))[0].c;
  expect(A, 'job-card module writes its audit trail', audits >= 2, `${audits} audit rows`);

  for (const s of ['in_progress', 'ready_for_pickup', 'completed']) await api('PATCH', `/work-orders/${woA}/status`, { status: s });
  const ia3 = await inv(woA);
  const lines = await invLines(ia3.id);
  expect(A, 'final invoice 960.75 with one line per job card line', n(ia3.total_amount) === 960.75 && lines.length === 5,
    lines.map(l => `${l.item_type}:${l.description}=${l.total}`).join(' | '));

  await api('PATCH', `/invoices/${ia3.id}/status`, { status: 'paid' });
  const late = await api('POST', `/work-orders/${woA}/items`, { name: 'Late extra', quantity: 1, unit_price: 10 });
  expect(A, 'adding to a job card whose invoice is paid is refused', late.status === 409, `HTTP ${late.status} ${late.json?.code || ''}`);

  // ── B: wizard job card (no estimate)
  const B = 'B wizard path';
  const wiz = await api('POST', '/work-orders', {
    customer_id: CUST, vehicle_id: VEH, customer_name: 'LEAKTEST Customer', customer_phone: '+971500000999',
    description: 'LEAKTEST brake noise', odometer_in: 85000, payment_method: 'cash',
    service_fee: 80, cash_amount: 195, discount: 0,
    items: [{ name: 'Brake pads - Genuine', quantity: 1, unit_price: 150 }, { name: 'Brake fluid', quantity: 1, unit_price: 45 }],
  });
  const woB = wiz.json?.data?.id; created.work_orders.push(woB);
  const b0 = await wo(woB);
  expect(B, 'wizard job card total = 80 + 195 + VAT 13.75 = 288.75', n(b0.total_amount) === 288.75, `total ${b0.total_amount}, VAT ${b0.vat_amount}`);
  await api('PATCH', `/work-orders/${woB}/assign-mechanic`, { mechanic_id: MECH });
  const blocked = await api('PATCH', `/work-orders/${woB}/status`, { status: 'in_progress' });
  expect(B, 'work cannot start before the customer approves', blocked.status === 409 && blocked.json?.code === 'CUSTOMER_APPROVAL_REQUIRED', `HTTP ${blocked.status} ${blocked.json?.code || ''}`);
  const appr = await api('PATCH', `/work-orders/${woB}/customer-approval`, { channel: 'in_person', note: 'Signed at counter' });
  const bAppr = await wo(woB);
  expect(B, 'advisor records in-person approval with the agreed total', appr.status === 200 && bAppr.customer_approval_channel === 'in_person' && n(bAppr.customer_approved_total) === 288.75,
    `channel ${bAppr.customer_approval_channel}, agreed total ${bAppr.customer_approved_total}`);
  const dup = await api('PATCH', `/work-orders/${woB}/customer-approval`, { channel: 'phone' });
  expect(B, 'approving again at the same total is refused', dup.status === 409, `HTTP ${dup.status}`);
  await api('PATCH', `/work-orders/${woB}/status`, { status: 'in_progress' });
  const ib = await inv(woB);
  expect(B, 'wizard invoice = 288.75 (was 80.00)', n(ib?.total_amount) === 288.75, `invoice ${ib?.invoice_number}: ${ib?.subtotal} + ${ib?.tax_amount} = ${ib?.total_amount}`);
  // Steps 1–7: no skipping the quality check or the gate pass with the status buttons
  const skipQc = await api('PATCH', `/work-orders/${woB}/status`, { status: 'ready_for_pickup' });
  expect(B, 'ready for pickup is refused before the quality check', skipQc.status === 409 && skipQc.json?.code === 'QC_REQUIRED', `HTTP ${skipQc.status} ${skipQc.json?.code || ''}`);
  await api('PATCH', `/work-orders/${woB}/status`, { status: 'cancelled' });
  const tlClosed = await api('POST', '/team-leader/assign', { work_order_id: woB, mechanic_id: MECH });
  expect(B, 'team leader cannot assign a closed job card', tlClosed.status === 409, `HTTP ${tlClosed.status}`);

  const dupNums = (await q(`SELECT invoice_number, COUNT(*) c FROM invoices WHERE workshop_id = 1 GROUP BY invoice_number HAVING c > 1`)).length;
  expect(B, 'invoice number is INV-<n> and unique in the workshop', /^INV-\d+$/.test(ib?.invoice_number || '') && dupNums === 0, `${ib?.invoice_number}, ${dupNums} duplicate number(s)`);

  // ── B2: editing a job card's lines from the form
  const B2 = 'B2 edit lines';
  const wizE = await api('POST', '/work-orders', {
    customer_id: CUST, vehicle_id: VEH, customer_name: 'LEAKTEST Customer', customer_phone: '+971500000999',
    description: 'LEAKTEST edit lines', odometer_in: 85100, payment_method: 'cash', service_fee: 80, discount: 0,
    items: [{ name: 'Oil filter', quantity: 1, unit_price: 40 }],
  });
  const woE = wizE.json?.data?.id; created.work_orders.push(woE);
  if (!woE) console.log("wizE", wizE.status, JSON.stringify(wizE.json));
  const rep = await api('PUT', `/work-orders/${woE}/items`, { items: [{ name: 'Oil filter', quantity: 1, unit_price: 40 }, { name: 'Engine oil 5W-30', quantity: 2, unit_price: 55 }] });
  const e1 = await wo(woE); const eLines = await q('SELECT name FROM work_order_items WHERE work_order_id = ?', [woE]);
  expect(B2, 'saving the form replaces the lines in one go (80 + 150 + VAT 11.50 = 241.50)', rep.status === 200 && eLines.length === 2 && n(e1.total_amount) === 241.5,
    `HTTP ${rep.status}, ${eLines.length} lines, total ${e1.total_amount}`);
  const bad = await api('PUT', `/work-orders/${woE}/items`, { items: 'nope' });
  const eLines2 = await q('SELECT name FROM work_order_items WHERE work_order_id = ?', [woE]);
  expect(B2, 'a bad save leaves the existing lines alone', bad.status === 400 && eLines2.length === 2, `HTTP ${bad.status}, ${eLines2.length} lines`);

  // ── C: decision after the job card exists
  const C = 'C change of mind';
  const ec = await sendEst([LINES[0], LINES[1]]);
  await decide(ec.tok, ec.L[0].id, 'approved');
  await decide(ec.tok, ec.L[1].id, 'approved');
  const woC = (await q('SELECT work_order_id FROM service_estimates WHERE id = ?', [ec.id]))[0].work_order_id; created.work_orders.push(woC);
  const flip = await decide(ec.tok, ec.L[1].id, 'rejected');
  const ecAfter = (await q('SELECT status FROM service_estimates WHERE id = ?', [ec.id]))[0];
  expect(C, 'full approval auto-creates an itemised job card', !!woC && (await wo(woC)).billing_basis === 'itemised', `job card id ${woC}`);
  expect(C, 'customer cannot change a decision after the job card exists', flip.status === 409 && ecAfter.status === 'converted',
    `HTTP ${flip.status}, estimate ${ecAfter.status}`);

  // ── D: staff cannot approve on the customer's behalf
  const D = 'D approval bypass';
  const ed = (await api('POST', '/estimates', { customer_id: CUST, vehicle_id: VEH, lines: [LINES[1]] })).json.estimateId;
  created.service_estimates.push(ed);
  const pd = await api('PATCH', `/estimates/${ed}/status`, { status: 'approved' });
  const cd = await api('POST', `/estimates/${ed}/convert-to-work-order`);
  expect(D, 'manual "approved" status is refused', pd.status === 400, `HTTP ${pd.status}`);
  expect(D, 'unapproved estimate cannot be converted', cd.status === 400, `HTTP ${cd.status}`);

  // ── E: reject all
  const E = 'E reject all';
  const ee = await sendEst([LINES[0]]);
  await decide(ee.tok, ee.L[0].id, 'rejected', { reason: 'Too expensive' });
  const eeAfter = (await q('SELECT status, work_order_id, customer_notes FROM service_estimates WHERE id = ?', [ee.id]))[0];
  expect(E, 'rejection closes the estimate and stores the reason', eeAfter.status === 'rejected' && !eeAfter.work_order_id && /Too expensive/.test(eeAfter.customer_notes || ''),
    `status ${eeAfter.status}, reason "${eeAfter.customer_notes}"`);

  // ── F: legacy job cards are untouched
  const F = 'F legacy unchanged';
  const [legacy] = await q(`SELECT w.id, w.service_fee, w.total_amount, i.id inv_id, i.total_amount inv_total
    FROM work_orders w JOIN invoices i ON i.work_order_id = w.id WHERE w.billing_basis = 'service_fee' AND w.status = 'completed' LIMIT 1`);
  legacySnapshot = legacy;
  const li = await api('POST', `/work-orders/${legacy.id}/items`, { name: 'LEAKTEST legacy probe', quantity: 1, unit_price: 99 });
  const lw = await wo(legacy.id); const lInv = (await q('SELECT total_amount FROM invoices WHERE id = ?', [legacy.inv_id]))[0];
  expect(F, 'adding an item to a legacy job card changes neither it nor its invoice',
    li.status === 201 && n(lw.total_amount) === n(legacy.total_amount) && n(lInv.total_amount) === n(legacy.inv_total),
    `job card ${legacy.total_amount}→${lw.total_amount}, invoice ${legacy.inv_total}→${lInv.total_amount}`);

  // public link: an estimate of 12 lines can be fully decided
  const G = 'G long estimate';
  const many = Array.from({ length: 12 }, (_, i) => ({ line_type: 'parts', description: `Part ${i + 1}`, quantity: 1, unit_price: 10 }));
  const eg = await sendEst(many);
  let last;
  for (const l of eg.L) last = await decide(eg.tok, l.id, 'approved');
  const woG = (await q('SELECT work_order_id FROM service_estimates WHERE id = ?', [eg.id]))[0].work_order_id; if (woG) created.work_orders.push(woG);
  expect(G, 'customer can decide all 12 lines (was blocked after ~9)', last.status === 200 && !!woG, `last HTTP ${last.status}`);
  // ── H: approval captured at the counter; growth needs re-approval
  const H = 'H customer approval';
  const wizH = await api('POST', '/work-orders', {
    customer_id: CUST, vehicle_id: VEH, customer_name: 'LEAKTEST Customer', customer_phone: '+971500000999',
    description: 'LEAKTEST service', odometer_in: 85001, service_fee: 100, items: [],
    customer_approval_channel: 'phone', customer_approval_note: 'Approved on call',
  });
  const woH = wizH.json?.data?.id; created.work_orders.push(woH);
  await api('PATCH', `/work-orders/${woH}/assign-mechanic`, { mechanic_id: MECH });
  const startH = await api('PATCH', `/work-orders/${woH}/status`, { status: 'in_progress' });
  expect(H, 'approval recorded at creation lets work start', startH.status === 200, `HTTP ${startH.status}`);
  await api('POST', `/work-orders/${woH}/items`, { name: 'Extra filter', quantity: 1, unit_price: 40 });
  const h1 = await wo(woH);
  expect(H, 'extra work shows above the agreed total', n(h1.total_amount) > n(h1.customer_approved_total), `agreed ${h1.customer_approved_total}, now ${h1.total_amount}`);
  const re = await api('PATCH', `/work-orders/${woH}/customer-approval`, { channel: 'phone', note: 'Agreed the filter' });
  const h2 = await wo(woH);
  expect(H, 're-approval moves the agreed total up', re.status === 200 && n(h2.customer_approved_total) === n(h2.total_amount), `agreed ${h2.customer_approved_total}`);
  const startA = (await wo(woA)).customer_approval_channel;
  expect(H, 'estimate-born job card is approved by the estimate', startA === 'estimate', `channel ${startA}`);

  // ── I: supervisor / manager sign-off for external customers
  const I = 'I manager sign-off';
  const estI = (await as(dispatcherToken, () => api('POST', '/estimates', { customer_id: CUST, vehicle_id: VEH, lines: [LINES[0]] }))).json.estimateId;
  created.service_estimates.push(estI);
  const sendI = await as(dispatcherToken, () => api('POST', `/estimates/${estI}/send`, { email: 'leaktest-customer@example.invalid' }));
  expect(I, 'advisor cannot send an external estimate unapproved', sendI.status === 409 && sendI.json?.code === 'MANAGER_APPROVAL_REQUIRED', `HTTP ${sendI.status}`);
  const listI = await api('GET', '/estimates?view=needs_approval');
  expect(I, 'it appears in the "needs approval" queue', listI.json?.estimates?.some(e => e.id === estI) && listI.json.counts.needs_approval >= 1, `count ${listI.json?.counts?.needs_approval}`);
  const notifI = (await q(`SELECT COUNT(*) c FROM user_notifications WHERE title LIKE ? AND user_id IN (?)`, [`%needs your approval%`, created.users]))[0].c;
  expect(I, 'approvers are notified', notifI >= 2, `${notifI} test approvers notified`);
  const selfI = await as(dispatcherToken, () => api('POST', `/estimates/${estI}/internal-approve`));
  expect(I, 'an advisor cannot approve it', selfI.status === 403, `HTTP ${selfI.status}`);
  const mgrI = await as(managerToken, () => api('POST', `/estimates/${estI}/internal-approve`));
  const send2 = await as(dispatcherToken, () => api('POST', `/estimates/${estI}/send`, { email: 'leaktest-customer@example.invalid' }));
  // No SMTP locally → 502 EMAIL_FAILED (the link is live); either way it was let through.
  const wentOut = r => r.status === 200 || (r.status === 502 && r.json?.code === 'EMAIL_FAILED' && !!r.json?.approval_url);
  expect(I, 'after manager approval the advisor can send it', mgrI.status === 200 && wentOut(send2), `approve ${mgrI.status}, send ${send2.status}`);
  await q(`UPDATE customers SET customer_class = 'internal' WHERE id = ?`, [CUST]);
  const estJ = (await as(dispatcherToken, () => api('POST', '/estimates', { customer_id: CUST, vehicle_id: VEH, lines: [LINES[0]] }))).json.estimateId;
  created.service_estimates.push(estJ);
  const sendJ = await as(dispatcherToken, () => api('POST', `/estimates/${estJ}/send`, { email: 'leaktest-customer@example.invalid' }));
  expect(I, 'internal (fleet) customer estimate goes straight out', wentOut(sendJ), `HTTP ${sendJ.status}`);
} catch (e) {
  out.push({ error: e.stack });
} finally {
  const foreign = [];
  for (const [t, ids] of Object.entries(created)) {
    for (const r of await q(`SELECT id FROM \`${t}\` WHERE id > ?`, [baseline[t]])) if (!ids.includes(r.id)) foreign.push(`${t}#${r.id}`);
  }
  if (foreign.length) out.push({ cleanup: 'ABORTED — foreign rows: ' + foreign.join(', ') });
  else {
    const removed = {};
    await q('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of idTables) { const r = await q(`DELETE FROM \`${t}\` WHERE id > ?`, [baseline[t]]); if (r.affectedRows) removed[t] = r.affectedRows; }
    await q('SET FOREIGN_KEY_CHECKS = 1');
    out.push({ cleanup: removed });
  }
  await db.end();
  const pass = out.filter(o => o.result === 'PASS').length, fail = out.filter(o => o.result === 'FAIL').length;
  for (const o of out) {
    if (o.result) console.log(`${o.result}  [${o.scenario}] ${o.what}${o.detail ? '  — ' + o.detail : ''}`);
    else console.log(JSON.stringify(o));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}
