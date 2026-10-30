// The CRM cycle, end to end through the API with real role logins:
//   lead → follow up → quote → book → visit → after the visit → service due →
//   a reply to the reminder becomes a new enquiry.
// LOCAL ONLY; every row created is removed by id baseline at the end.
import { createRequire } from 'module'; import fs from 'fs'; import crypto from 'crypto';
const BE = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(BE + '/package.json');
const mysql = require('mysql2/promise'); const bcrypt = require('bcryptjs');
const env = Object.fromEntries(fs.readFileSync(BE + '/.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (!['localhost', '127.0.0.1'].includes(env.DB_HOST)) throw new Error('local only');
Object.assign(process.env, env); // for the backend modules imported below
const db = await mysql.createConnection({ host: '127.0.0.1', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const q = async (s, p = []) => (await db.query(s, p))[0];
const API = process.env.QA_API || 'http://localhost:4000/api'; // QA_API overrides the API base
const out = []; let section = '';
const expect = (what, ok, detail) => out.push(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${what}${detail !== undefined && detail !== '' ? '  — ' + detail : ''}`);
const call = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j };
};
const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`)).map(r => r.t);
const baseline = {}; for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;
const task = (type, relType, relId) => q('SELECT * FROM crm_tasks WHERE related_type = ? AND related_id = ? AND task_type = ? ORDER BY id DESC LIMIT 1', [relType, relId, type]).then(r => r[0]);
const tomorrow = () => { const d = new Date(Date.now() + 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mainOf = async woId => (await q('SELECT * FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [woId || 0]))[0];
// A 1×1 PNG, as the signature pad would send.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/** The physical inspection with the customer at the car: signed, then completed (opens an external customer's job card). */
const acknowledge = async (tok, woId, name) => {
  const insp = (await call('POST', '/vehicle-inspections', tok, { work_order_id: woId, inspection_type: 'intake' })).json?.data;
  await call('PATCH', `/vehicle-inspections/${insp?.id}/signature`, tok, { signature: PNG, name });
  return call('PATCH', `/vehicle-inspections/${insp?.id}/complete`, tok, {});
};

try {
  const pw = 'Qa' + crypto.randomBytes(8).toString('hex') + '1';
  const users = {};
  const mk = async (key, role, slug) => {
    const [r] = slug ? await q('SELECT id FROM roles WHERE slug = ? AND workshop_id = 1', [slug]) : [null];
    const username = `qa_crm_${key}`;
    const ins = await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, role_id, is_active) VALUES (1,?,?,?,?,?,?,1)`,
      [`QA ${key}`, username, `${username}@example.invalid`, await bcrypt.hash(pw, 10), role, r?.id || null]);
    users[key] = { id: ins.insertId, tok: (await call('POST', '/auth/login', null, { username, password: pw })).json?.data?.token };
    return users[key].tok;
  };
  const advisor = await mk('advisor', 'service_advisor', 'service_advisor');
  const supervisor = await mk('supervisor', 'supervisor', 'supervisor');
  const leader = await mk('leader', 'dispatcher', 'team_leader');
  const manager = await mk('manager', 'workshop_manager', 'workshop_manager');

  // ── 01–03 Lead arrives, know the car, follow up ────────────────────
  section = 'lead';
  const phone = `+97150${String(Date.now()).slice(-7)}`;
  const e1 = await call('POST', '/enquiries', advisor, { contact_name: 'QA CRM Lead', contact_phone: phone, contact_email: 'qa-crm-lead@example.invalid',
    vehicle_description: 'Kia Sportage 2021', vehicle_plate: 'QACRM1', enquiry_type: 'service', description: 'Brake noise', source_channel: 'search_discovery', contact_method: 'phone' });
  const enq = e1.json?.data;
  expect('staff enquiry saved with the plate', e1.status === 201 && enq?.vehicle_plate === 'QACRM1', enq?.enquiry_number);
  // The client's change (2026-10-29): the work order — the visit — opens the moment the enquiry is submitted.
  const eWo = e1.json?.work_order;
  const [eWoRow] = await q('SELECT wo.id, wo.enquiry_id, wo.intake_channel, wo.status, e.work_order_id AS enq_wo FROM work_orders wo JOIN enquiries e ON e.id = wo.enquiry_id WHERE wo.id = ?', [eWo?.id || 0]);
  expect('…and its work order opens with it, linked both ways, Received via the Service Advisor; no job card yet (external)',
    eWo?.created === true && eWoRow?.enquiry_id === enq.id && eWoRow.enq_wo === eWo.id && eWoRow.intake_channel === 'advisor' && eWoRow.status === 'pending' && !(await mainOf(eWo.id)),
    eWoRow ? `${eWo.work_order_number} ${eWoRow.intake_channel} ${eWoRow.status}` : JSON.stringify(e1.json?.work_order));
  const cb = await task('call_back', 'enquiry', enq.id);
  expect('call-back task opened for the new lead', cb?.status === 'open', cb?.title);
  const emailOnly = await call('POST', '/enquiries', advisor, { contact_name: 'QA CRM Email', contact_email: 'qa-crm-email@example.invalid', source_channel: 'search_discovery', contact_method: 'website_form' });
  expect('an e-mail-only lead is accepted', emailOnly.status === 201, `HTTP ${emailOnly.status}`);
  const web = await call('POST', '/public/enquiries', null, { customerName: 'QA CRM Web', phone: '+971500000991', email: 'qa-crm-web@example.invalid', service: 'Oil change', vehicle: { make: 'Nissan', model: 'Patrol', year: 2020 } });
  const webId = web.json?.data?.id;
  expect('website lead lands with a call-back task', web.status === 201 && (await task('call_back', 'enquiry', webId))?.status === 'open', `HTTP ${web.status}`);
  const [webWo] = await q(`SELECT wo.intake_channel, wo.status, c.full_name FROM enquiries e JOIN work_orders wo ON wo.id = e.work_order_id AND wo.enquiry_id = e.id
                              LEFT JOIN customers c ON c.id = wo.customer_id WHERE e.id = ?`, [webId || 0]);
  expect('…and as its work order, Received via the website, for the customer found or added from the form', webWo?.intake_channel === 'website' && webWo.status === 'pending' && webWo.full_name === 'QA CRM Web',
    webWo ? `${webWo.intake_channel} ${webWo.status} ${webWo.full_name}` : 'no work order');

  // ── 04 Quote ───────────────────────────────────────────────────────
  section = 'quote';
  const prep = await call('POST', `/enquiries/${enq.id}/prepare-quote`, advisor);
  const custId = prep.json?.data?.customer?.id; const vehId = prep.json?.data?.vehicle_id;
  const [veh] = vehId ? await q('SELECT make, model, year, plate_number, customer_id FROM vehicles WHERE id = ?', [vehId]) : [];
  expect('prepare-quote creates the customer and the car from the enquiry', !!custId && veh?.plate_number === 'QACRM1' && veh.make === 'Kia' && veh.model === 'Sportage' && veh.year === 2021 && veh.customer_id === custId,
    veh ? `${veh.make} ${veh.model} ${veh.year} ${veh.plate_number}` : JSON.stringify(prep.json));
  const prep2 = await call('POST', `/enquiries/${enq.id}/prepare-quote`, advisor);
  expect('asking again reuses them (no duplicate customer or car)', prep2.json?.data?.customer?.id === custId && prep2.json?.data?.vehicle_id === vehId, '');
  const tl = await call('POST', `/enquiries/${enq.id}/prepare-quote`, leader);
  expect('a Team Leader cannot raise quotes', tl.status === 403, `HTTP ${tl.status}`);
  const est = await call('POST', '/estimates', advisor, { enquiry_id: enq.id, customer_id: custId, vehicle_id: vehId, customer_type: 'retail_cash',
    lines: [{ job_name: 'Brakes', line_type: 'labour', description: 'Brake inspection', quantity: 1, unit_price: 200 }] });
  const estId = est.json?.estimateId;
  const [eq] = await q('SELECT status, quoted_amount FROM enquiries WHERE id = ?', [enq.id]);
  expect('the estimate is linked; the enquiry is now quoted with its amount', est.status === 201 && eq.status === 'quoted' && Number(eq.quoted_amount) === 210, `${eq.status} ${eq.quoted_amount}`);
  expect('the call-back task closes once quoted', (await task('call_back', 'enquiry', enq.id))?.status === 'done', '');
  await call('POST', `/estimates/${estId}/internal-approve`, supervisor);
  const sent = await call('POST', `/estimates/${estId}/send`, advisor, { format: 'genuine', channel: 'whatsapp' });
  expect('sent (after the Supervisor\'s approval) → 48-hour chase task', sent.status === 200 && (await task('quote_chase', 'quote', estId))?.status === 'open', `HTTP ${sent.status}`);
  const [{ approval_token: token }] = await q('SELECT approval_token FROM service_estimates WHERE id = ?', [estId]);
  const [line] = await q('SELECT id FROM estimate_lines WHERE estimate_id = ?', [estId]);
  await call('POST', `/public/estimates/${token}/lines/${line.id}/decide`, null, { decision: 'approved' });
  const [er] = await q('SELECT work_order_id FROM service_estimates WHERE id = ?', [estId]);
  const [wo] = await q('SELECT id, enquiry_id, customer_phone, status, customer_approved_at FROM work_orders WHERE id = ?', [er.work_order_id || 0]);
  expect('the customer approves → the work goes onto the enquiry\'s own work order (no second one), with the customer\'s phone',
    !!wo && wo.id === eWo?.id && wo.enquiry_id === enq.id && !!wo.customer_phone && !!wo.customer_approved_at, wo ? `WO ${wo.id} ${wo.status}` : 'no WO');
  const woFlag = (await call('GET', `/work-orders/${wo?.id}`, advisor)).json?.data;
  expect('approved before the car is in: no job card until the physical inspection — marked "physical inspection first", not "to assign"',
    !(await mainOf(wo?.id)) && Number(woFlag?.awaiting_physical_inspection) === 1, `flag ${woFlag?.awaiting_physical_inspection}`);
  const [{ service_status_token: statusTok }] = await q('SELECT service_status_token FROM work_orders WHERE id = ?', [wo?.id || 0]);
  const custStage = (await call('GET', `/public/service-status/${statusTok}`)).json?.data?.stage?.key;
  expect('…and the customer\'s status page still reads "Vehicle received" until the inspection is acknowledged (not "repair")', custStage === 'received', custStage);
  const [ec] = await q('SELECT status, converted_work_order_id FROM enquiries WHERE id = ?', [enq.id]);
  expect('the enquiry is converted to that job; the chase task closes', ec.status === 'converted' && ec.converted_work_order_id === wo?.id && (await task('quote_chase', 'quote', estId))?.status === 'done', ec.status);

  // ── 05 Book ────────────────────────────────────────────────────────
  section = 'book';
  const denied = await call('POST', '/appointments', leader, { estimate_id: estId, appointment_date: tomorrow(), appointment_time: '09:00' });
  expect('a Team Leader cannot make bookings', denied.status === 403, `HTTP ${denied.status}`);
  const b1 = await call('POST', '/appointments', advisor, { estimate_id: estId, appointment_date: tomorrow(), appointment_time: '09:00', source: 'call_centre' });
  const appt1 = b1.json?.appointment;
  expect('booking from the approved quote carries its job card', b1.status === 201 && appt1?.work_order_id === wo?.id && appt1?.estimate_id === estId, `HTTP ${b1.status} ${b1.json?.message || ''}`);
  const again = await call('POST', '/appointments', advisor, { estimate_id: estId, appointment_date: tomorrow(), appointment_time: '10:00' });
  expect('the same quote cannot be booked twice', again.status === 409 && again.json?.code === 'ALREADY_BOOKED', `HTTP ${again.status}`);
  const ci1 = await call('POST', `/appointments/${appt1.id}/check-in`, advisor, { odometer_in: 30500 });
  expect('check-in uses that work order; the physical inspection is next (no job card yet)', ci1.json?.work_order_id === wo?.id && ci1.json?.created === false
    && ci1.json?.physical_inspection_required === true && !(await mainOf(wo?.id)), `HTTP ${ci1.status} ${ci1.json?.message || ''}`);
  const e2r = await call('POST', '/enquiries', advisor, { contact_name: 'QA CRM Booker', contact_phone: '+971500000992', vehicle_description: 'Honda Civic 2019', vehicle_plate: 'QACRM2', source_channel: 'passing_local', contact_method: 'walk_in', description: 'Routine service' });
  const e2 = e2r.json?.data; const e2Wo = e2r.json?.work_order;
  const b2 = await call('POST', '/appointments', advisor, { enquiry_id: e2.id, appointment_date: tomorrow(), appointment_time: '11:00', service_category: 'oil_change' });
  const ci2 = await call('POST', `/appointments/${b2.json?.appointment?.id}/check-in`, advisor, { odometer_in: 88000 });
  const [e2c] = await q('SELECT status, converted_work_order_id, work_order_id FROM enquiries WHERE id = ?', [e2.id]);
  const [ci2wo] = await q('SELECT service_category, odometer_in FROM work_orders WHERE id = ?', [ci2.json?.work_order_id || 0]);
  expect('booking from an enquiry → check-in arrives on the enquiry\'s work order (200, not a new one), the booked service on it, and converts the enquiry; physical inspection next',
    ci2.status === 200 && ci2.json?.created === false && ci2.json?.work_order_id === e2Wo?.id && ci2.json?.physical_inspection_required === true && !(await mainOf(e2Wo?.id))
    && e2c.status === 'converted' && e2c.converted_work_order_id === e2Wo?.id && e2c.work_order_id === e2Wo?.id && ci2wo?.service_category === 'oil_change' && ci2wo.odometer_in === 88000,
    `HTTP ${ci2.status} ${ci2.json?.work_order_number || ''} created ${ci2.json?.created} · ${ci2wo?.service_category} ${ci2wo?.odometer_in}`);
  const ack2 = await acknowledge(advisor, e2Wo?.id, 'QA CRM Booker');
  expect('…the customer signs the physical inspection at the car → its job card opens', ack2.json?.job_card?.opened_now === true && !!(await mainOf(e2Wo?.id)), JSON.stringify(ack2.json?.job_card));
  const stats = (await call('GET', '/enquiries/stats', manager)).json?.data?.funnel?.total;
  expect('the funnel counts bookings', Number(stats?.booked) >= 1, JSON.stringify(stats));

  // ── Not converted / rejected ──────────────────────────────────────
  section = 'lost';
  const lost = await call('POST', `/enquiries/${emailOnly.json.data.id}/lost`, advisor, { lost_reason: 'timing', follow_up_at: `${tomorrow()} 10:00:00` });
  expect('not converted with a re-offer date → re-offer task on that date', lost.status === 200 && (await task('follow_up', 'enquiry', emailOnly.json.data.id))?.status === 'open', '');
  const [lostWo] = await q('SELECT status FROM work_orders WHERE id = ?', [emailOnly.json?.work_order?.id || 0]);
  const [lostLog] = await q("SELECT note FROM work_order_status_logs WHERE work_order_id = ? AND status = 'cancelled' ORDER BY id DESC LIMIT 1", [emailOnly.json?.work_order?.id || 0]);
  expect('…and its work order, with nothing done on it, is cancelled: "Enquiry closed: timing"', lost.json?.work_order?.cancelled === true && lostWo?.status === 'cancelled' && /^Enquiry closed: timing/.test(lostLog?.note || ''),
    `${lostWo?.status} · ${lostLog?.note}`);
  const e3r = await call('POST', '/enquiries', advisor, { contact_name: 'QA CRM Reject', contact_phone: '+971500000993', source_channel: 'owned_repeat', contact_method: 'phone' });
  const e3 = e3r.json?.data;
  const p3 = (await call('POST', `/enquiries/${e3.id}/prepare-quote`, advisor)).json?.data;
  const est3 = (await call('POST', '/estimates', advisor, { enquiry_id: e3.id, customer_id: p3.customer.id, customer_type: 'retail_cash', lines: [{ line_type: 'labour', description: 'Detailing', quantity: 1, unit_price: 300 }] })).json?.estimateId;
  await call('POST', `/estimates/${est3}/internal-approve`, supervisor);
  await call('POST', `/estimates/${est3}/send`, advisor, { format: 'genuine', channel: 'whatsapp' });
  const [{ approval_token: t3 }] = await q('SELECT approval_token FROM service_estimates WHERE id = ?', [est3]);
  const [l3] = await q('SELECT id FROM estimate_lines WHERE estimate_id = ?', [est3]);
  await call('POST', `/public/estimates/${t3}/lines/${l3.id}/decide`, null, { decision: 'rejected', reason: 'Too expensive' });
  const [e3row] = await q('SELECT status, lost_reason FROM enquiries WHERE id = ?', [e3.id]);
  expect('customer rejects the quote → enquiry lost (price), chase closed', e3row.status === 'lost' && e3row.lost_reason === 'price' && (await task('quote_chase', 'quote', est3))?.status === 'done', `${e3row.status} ${e3row.lost_reason}`);
  const [e3Wo] = await q('SELECT status, cancellation_reason FROM work_orders WHERE id = ?', [e3r.json?.work_order?.id || 0]);
  expect('…and the enquiry\'s work order is cancelled with it ("Enquiry closed: customer rejected estimate …")', e3Wo?.status === 'cancelled' && /^Enquiry closed: customer rejected estimate /.test(e3Wo.cancellation_reason || ''),
    `${e3Wo?.status} · ${e3Wo?.cancellation_reason}`);

  // ── Convert: the lead is won on the work order it already has ──────
  section = 'convert';
  const e5r = await call('POST', '/enquiries', advisor, { contact_name: 'QA CRM Convert', contact_phone: '+971500000994', vehicle_description: 'Mazda CX-5 2022', vehicle_plate: 'QACRM5',
    source_channel: 'passing_local', contact_method: 'whatsapp', description: 'Squeaky brakes' });
  const cv = await call('POST', `/enquiries/${e5r.json?.data?.id}/convert`, advisor, {});
  const cv2 = await call('POST', `/enquiries/${e5r.json?.data?.id}/convert`, advisor, {});
  const [{ n: e5Wos }] = await q('SELECT COUNT(*) n FROM work_orders WHERE enquiry_id = ?', [e5r.json?.data?.id || 0]);
  expect('WhatsApp enquiry: its work order Received via WhatsApp; Convert reuses it (200 reused) — one work order, physical inspection next',
    e5r.json?.work_order?.created === true && cv.status === 200 && cv.json?.data?.reused === true && cv.json.data.work_order?.id === e5r.json.work_order.id
    && cv.json.data.work_order.intake_channel === 'whatsapp' && cv.json.data.physical_inspection_required === true && cv2.status >= 400 && Number(e5Wos) === 1,
    `HTTP ${cv.status} reused ${cv.json?.data?.reused} · again ${cv2.status} · ${e5Wos} work order(s)`);

  // ── 07 After the visit · 08 Service due · the loop ─────────────────
  section = 'retain';
  const { applyStatusChange } = await import(BE + '/src/routes/work-orders.js');
  const woId = ci2.json.work_order_id;
  await q("UPDATE work_orders SET status = 'ready_for_pickup' WHERE id = ?", [woId]); // the floor work is not under test here
  const closed = await applyStatusChange({ workOrderId: woId, workshopId: 1, userId: users.advisor.id, status: 'completed', skipGates: true });
  const fu = await task('follow_up', 'work_order', woId);
  expect('closing the job opens the 48-hour follow-up call task', closed.ok && fu?.status === 'open', fu?.title || closed.message);
  const [vehRow] = await q('SELECT vehicle_id FROM work_orders WHERE id = ?', [woId]);
  let rem = null;
  for (let i = 0; i < 20 && !rem; i++) { [rem] = await q('SELECT * FROM service_reminders WHERE vehicle_id = ? AND last_service_wo_id = ?', [vehRow.vehicle_id, woId]); if (!rem) await new Promise(r => setTimeout(r, 150)); }
  expect('…and puts the car\'s next service on the reminder list', rem?.status === 'scheduled' && rem.service_type === 'oil_change' && Number(rem.due_mileage) === 98000, rem ? `${rem.service_type} due ${String(rem.due_at).slice(4, 15)} at ${rem.due_mileage} km` : 'none');
  if (!rem) throw new Error('no reminder scheduled — later retain checks need it');
  await q("UPDATE service_reminders SET status = 'sent', sent_at = NOW() WHERE id = ?", [rem.id]); // as if it went out
  const back = await call('POST', `/crm/reminders/${rem.id}/enquiry`, advisor);
  const [e4] = await q('SELECT contact_method, source_channel, vehicle_id, status FROM enquiries WHERE id = ?', [back.json?.data?.enquiry_id || 0]);
  const [remAfter] = await q('SELECT status, converted_enquiry_id FROM service_reminders WHERE id = ?', [rem.id]);
  expect('a reply to the reminder opens an enquiry for the car (source: reminder)', back.status === 201 && e4?.contact_method === 'reminder' && e4.vehicle_id === vehRow.vehicle_id && remAfter.status === 'converted', e4 ? `${e4.source_channel}/${e4.contact_method}` : `HTTP ${back.status}`);
  const [e4Wo] = await q('SELECT wo.enquiry_id, wo.vehicle_id, wo.status, e.work_order_id AS enq_wo FROM work_orders wo JOIN enquiries e ON e.id = wo.enquiry_id WHERE wo.id = ?', [back.json?.work_order?.id || 0]);
  expect('…and, like every enquiry, its work order at once (linked both ways, for that car)', back.json?.work_order?.created === true && e4Wo?.enquiry_id === back.json?.data?.enquiry_id
    && e4Wo.enq_wo === back.json.work_order.id && e4Wo.vehicle_id === vehRow.vehicle_id && e4Wo.status === 'pending', JSON.stringify(back.json?.work_order));
  const [dueRem] = await q("SELECT id FROM service_reminders WHERE id = (SELECT MAX(id) FROM service_reminders)");
  const r5 = await q("INSERT INTO service_reminders (workshop_id, customer_id, vehicle_id, service_type, due_at, status, send_channel) VALUES (1, ?, ?, 'tire_service', CURDATE(), 'due', 'sms')", [custId, vehId]);
  await q("UPDATE vehicles SET vin = 'TSTCRM10000000001' WHERE id = ?", [vehId]); // new job cards need the VIN
  const newWo = await call('POST', '/work-orders', advisor, { customer_id: custId, vehicle_id: vehId, customer_name: 'QA CRM Lead', customer_phone: phone, description: 'Tyres', odometer_in: 31000, payment_method: 'cash', items: [] });
  let r5row = null;
  for (let i = 0; i < 20; i++) { [r5row] = await q('SELECT status, converted_work_order_id FROM service_reminders WHERE id = ?', [r5.insertId]); if (r5row.status === 'booked') break; await new Promise(r => setTimeout(r, 150)); }
  expect('a new job card for the car marks its open reminder booked', newWo.status === 201 && r5row.status === 'booked' && r5row.converted_work_order_id === newWo.json?.data?.id, r5row.status);
  void dueRem;

  // ── After the visit: an unhappy customer ──────────────────────────
  const inviteToken = crypto.randomBytes(16).toString('hex');
  await q('INSERT INTO survey_invites (workshop_id, token, work_order_id, customer_id, contact_name, sent_at) VALUES (1, ?, ?, ?, ?, NOW())', [inviteToken, woId, custId, 'QA CRM Booker']);
  const scores = Object.fromEntries(['ces_find_channel', 'ces_easy_handle', 'csat_overall', 'csat_as_advertised', 'csat_expectations', 'csat_rep_knowledge', 'csat_communication', 'csat_response_time'].map(k => [k, 2]));
  const sv = await call('POST', '/public/survey', null, { token: inviteToken, ...scores, resolution: 'no', nps_score: 3, nps_reason: 'Noise came back' });
  const cmp = await task('complaint', 'work_order', woId);
  expect('a low survey score opens an urgent complaint task', sv.status === 201 && cmp?.priority === 'urgent', cmp?.title || `HTTP ${sv.status}`);

  // ── Job card rules hold everywhere ────────────────────────────────
  section = 'rules';
  const [tokRow] = await q('SELECT service_status_token t FROM work_orders WHERE id = ?', [newWo.json.data.id]);
  await q("UPDATE work_orders SET status = 'in_progress' WHERE id = ?", [newWo.json.data.id]); // work under way
  const qr0 = await call('PATCH', `/service-status/${tokRow.t}/status`, manager, { status: 'ready_for_pickup' });
  expect('the QR status screen cannot skip the physical inspection (external, no job card: 409 PHYSICAL_INSPECTION_REQUIRED)',
    qr0.status === 409 && qr0.json?.code === 'PHYSICAL_INSPECTION_REQUIRED', `HTTP ${qr0.status} ${qr0.json?.code || ''}`);
  const ackNew = await acknowledge(advisor, newWo.json.data.id, 'QA CRM Lead');
  const qr = await call('PATCH', `/service-status/${tokRow.t}/status`, manager, { status: 'ready_for_pickup' });
  expect('…nor, with the job card open (acknowledged), the quality check (409 QC_REQUIRED)', ackNew.json?.job_card?.opened_now === true && qr.status === 409 && qr.json?.code === 'QC_REQUIRED',
    `${JSON.stringify(ackNew.json?.job_card)} HTTP ${qr.status} ${qr.json?.code || ''}`);
  await applyStatusChange({ workOrderId: newWo.json.data.id, workshopId: 1, userId: users.manager.id, status: 'cancelled', skipGates: true });
  const open = await q("SELECT COUNT(*) n FROM job_cards WHERE work_order_id = ? AND status <> 'cancelled'", [newWo.json.data.id]);
  const [{ n: hadCards }] = await q('SELECT COUNT(*) n FROM job_cards WHERE work_order_id = ?', [newWo.json.data.id]);
  expect('cancelling a job cancels its job cards', Number(hadCards) >= 1 && Number(open[0].n) === 0, `${open[0].n} of ${hadCards} still open`);
  const { isTwilioConfigured } = await import(BE + '/src/lib/sms.js').catch(() => ({}));
  if (!isTwilioConfigured || !isTwilioConfigured()) {
    const r6 = await q("INSERT INTO service_reminders (workshop_id, customer_id, vehicle_id, service_type, due_at, status, send_channel) VALUES (1, ?, ?, 'diagnostic', CURDATE(), 'due', 'sms')", [custId, vehId]);
    const s6 = await call('POST', `/crm/reminders/${r6.insertId}/send`, advisor);
    const [r6row] = await q('SELECT status, last_error FROM service_reminders WHERE id = ?', [r6.insertId]);
    expect('with no SMS provider a reminder is not marked sent', s6.status === 422 && r6row.status === 'due' && !!r6row.last_error, r6row.last_error);
  }
} catch (e) { out.push('ERROR ' + e.stack); }
finally {
  await new Promise(r => setTimeout(r, 500)); // let fire-and-forget side effects land before cleanup
  // Signature images of the inspections signed here.
  for (const { u } of await q("SELECT signature_url u FROM vehicle_inspections WHERE id > ? AND signature_url LIKE '/uploads/signatures/sig_insp%'", [baseline.vehicle_inspections])) {
    if (/^\/uploads\/signatures\/sig_insp\d+_[\w-]+\.png$/.test(u)) fs.rmSync(BE + u, { force: true });
  }
  await q('SET FOREIGN_KEY_CHECKS = 0'); const removed = {};
  for (const t of idTables) { if (t === 'roles') continue; const r = await q(`DELETE FROM \`${t}\` WHERE id > ?`, [baseline[t]]); if (r.affectedRows) removed[t] = r.affectedRows; }
  await q('SET FOREIGN_KEY_CHECKS = 1'); await db.end();
  console.log(out.join('\n'));
  console.log(`\n${out.filter(l => l.startsWith('PASS')).length} passed, ${out.filter(l => l.startsWith('FAIL')).length} failed · cleanup ${Object.keys(removed).length} tables`);
  process.exit(0);
}
