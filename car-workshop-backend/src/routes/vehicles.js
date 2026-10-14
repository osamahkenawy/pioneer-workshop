import express from 'express';
import pool, { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireManager } from '../lib/access.js';
import { requireCapability, isManagerRole, effectiveRole } from '../lib/roles.js';
import { stripMarkupFields, clampTextFields } from '../lib/sanitize.js';

// SR-01/SR-16 — sanitise at the write boundary. Identity fields can never
// legitimately contain markup, so it is stripped; free text is stored verbatim
// because HTML-stripping a note destroys legitimate content such as
// "worn < 2mm". Only keys actually present in the body are touched, so the
// update routes' "default to the existing row" destructuring still works.
const VEHICLES_IDENTITY = ['make', 'model', 'plate_number', 'plate_code', 'plate_emirate', 'vin', 'engine_no', 'fleet_code', 'color', 'fuel_type', 'transmission'];
const VEHICLES_FREE_TEXT = ['notes'];
function _clean(body) {
  return clampTextFields(stripMarkupFields(body || {}, VEHICLES_IDENTITY), VEHICLES_FREE_TEXT);
}

// D11: vehicles are recorded by whoever opens job cards (Step 2: Service
// Advisor, Supervisor, managers). A Storekeeper or Team Leader could
// overwrite or clear a VIN, or move a car to another customer (#19/#43).
const canEditVehicles = requireCapability('job.open',
  "Your role can't add or edit vehicles. A Service Advisor, Supervisor or manager does this.");

// The vehicles.fuel_type and transmission enums. Anything else reached
// MySQL in strict mode and came back as a 500 "Failed to create vehicle" —
// the wizard offered 'lpg', which could never be saved (#16).
const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'other'];
const TRANSMISSIONS = ['automatic', 'manual'];

// Column widths. A longer value was a strict-mode 500; it is now a 400
// naming the field (#99). The VIN has its own rule below.
const MAX_LEN = { make: 100, model: 100, plate_number: 50, plate_code: 10, plate_emirate: 50, engine_no: 50, fleet_code: 50, color: 50 };
const FIELD_LABEL = {
  make: 'Make', model: 'Model', plate_number: 'Plate number', plate_code: 'Plate code', plate_emirate: 'Plate emirate',
  engine_no: 'Engine number', fleet_code: 'Fleet code', color: 'Colour',
};

// A VIN (ISO 3779) is 17 letters and digits and never contains I, O or Q,
// which would read as 1 and 0. '123' used to satisfy the mandatory-VIN rule,
// and an inner space got a second record for the same chassis past the
// duplicate check (#94). Applies to every VIN written from now on; the
// imported rows with shorter chassis numbers are left as they are until
// someone changes them.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
// The same normalisation on the stored side, so 'jt3… 0001' on file still
// counts as a duplicate of 'JT3…0001'.
const VIN_KEY_SQL = "UPPER(REGEXP_REPLACE(COALESCE(v.vin, ''), '[^A-Za-z0-9]', ''))";

/** Arabic-Indic digits from an Arabic keyboard, as ASCII. */
function asciiDigits(s) {
  return String(s)
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0));
}
const text = v => (v === undefined || v === null ? null : (String(v).trim() || null));
/** VIN as stored: upper case, no spaces (#100 — it was shown upper case but saved as typed). */
const normVin = v => (v === undefined || v === null ? null : (asciiDigits(v).toUpperCase().replace(/\s+/g, '') || null));
/** Plate as stored: trimmed, single-spaced, upper case (#99). */
const normPlate = v => (v === undefined || v === null ? null : (asciiDigits(v).trim().replace(/\s+/g, ' ').toUpperCase() || null));
/** Letters and digits only: "A 12345", "a-12345" and "A12345" are one plate. */
const plateKey = v => asciiDigits(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
const blank = v => v === undefined || v === null || v === '';

/**
 * The field rules shared by create and update. `fields` holds what is being
 * written — on update only what changed, so an old row is not refused for a
 * value it already had. Returns { code, message } for a 400, or null.
 */
function fieldProblem(fields) {
  for (const [k, max] of Object.entries(MAX_LEN)) {
    if (typeof fields[k] === 'string' && fields[k].length > max) {
      return { code: 'FIELD_TOO_LONG', message: `${FIELD_LABEL[k]} must be ${max} characters or fewer.` };
    }
  }
  if (!blank(fields.year)) {
    const max = new Date().getFullYear() + 1;
    const y = asciiDigits(fields.year).trim();
    if (!/^\d{4}$/.test(y) || Number(y) < 1950 || Number(y) > max) {
      return { code: 'YEAR_INVALID', message: `Year must be between 1950 and ${max}.` };
    }
  }
  if (!blank(fields.mileage) && !/^\d{1,7}$/.test(asciiDigits(fields.mileage).trim())) {
    return { code: 'MILEAGE_INVALID', message: 'Mileage must be a whole number of km, digits only.' };
  }
  if (fields.fuel_type !== undefined && !FUEL_TYPES.includes(fields.fuel_type)) {
    return { code: 'FUEL_TYPE_INVALID', message: `Fuel type must be one of: ${FUEL_TYPES.join(', ')}. Record LPG or CNG as "other".` };
  }
  if (fields.transmission !== undefined && !TRANSMISSIONS.includes(fields.transmission)) {
    return { code: 'TRANSMISSION_INVALID', message: `Transmission must be one of: ${TRANSMISSIONS.join(', ')}.` };
  }
  if (fields.vin && !VIN_RE.test(fields.vin)) {
    return { code: 'VIN_INVALID', message: 'VIN must be 17 characters, letters and digits only (never I, O or Q). Check the chassis plate.' };
  }
  return null;
}
const toInt = v => (blank(v) ? null : Number(asciiDigits(v).trim()));

/** The active vehicle already carrying this VIN (other than `exceptId`), or null. */
async function findVinOwner(run, workshopId, vin, exceptId = null) {
  const rows = await run(
    `SELECT v.id, v.customer_id, v.plate_number, c.full_name
       FROM vehicles v JOIN customers c ON c.id = v.customer_id
      WHERE v.workshop_id = ? AND v.is_active = 1 AND ${VIN_KEY_SQL} = ? ${exceptId ? 'AND v.id <> ?' : ''}
      LIMIT 1`,
    exceptId ? [workshopId, vin, exceptId] : [workshopId, vin]
  );
  return rows[0] || null;
}

function duplicateVin(res, dup) {
  return res.status(409).json({
    success: false,
    code: 'VIN_DUPLICATE',
    message: `This VIN is already on file for ${dup.plate_number || 'a vehicle'} (${dup.full_name}).`,
    data: { vehicle_id: dup.id, customer_id: dup.customer_id, customer_name: dup.full_name },
  });
}

/**
 * An active car of an active customer already carrying this plate (#95),
 * other than `exceptId`. A UAE plate is number + code + emirate, but almost
 * every imported vehicle has only the number (often with the code written
 * into it, e.g. G10628), so a code or emirate missing on either side counts
 * as matching, and code + number is also compared as one string. It is a
 * question for the advisor, not a block: a plate can legitimately move to
 * the owner's next car, which is what confirm_duplicate_plate is for.
 */
async function findPlateOwner(run, workshopId, { plate_number, plate_code, plate_emirate }, exceptId = null) {
  const num = plateKey(plate_number);
  if (!num) return null;
  const code = plateKey(plate_code);
  const emirate = String(plate_emirate || '').trim().toLowerCase();
  const rows = await run(
    `SELECT v.id, v.customer_id, v.plate_number, v.plate_code, v.plate_emirate, v.make, v.model, c.full_name
       FROM vehicles v JOIN customers c ON c.id = v.customer_id
      WHERE v.workshop_id = ? AND v.is_active = 1 AND c.is_active = 1 ${exceptId ? 'AND v.id <> ?' : ''}
        AND (? = '' OR COALESCE(v.plate_emirate, '') = '' OR LOWER(TRIM(v.plate_emirate)) = ?)
        AND ((UPPER(REGEXP_REPLACE(COALESCE(v.plate_number, ''), '[^A-Za-z0-9]', '')) = ?
              AND (? = '' OR COALESCE(v.plate_code, '') = '' OR UPPER(REGEXP_REPLACE(v.plate_code, '[^A-Za-z0-9]', '')) = ?))
          OR UPPER(REGEXP_REPLACE(CONCAT(COALESCE(v.plate_code, ''), COALESCE(v.plate_number, '')), '[^A-Za-z0-9]', '')) = ?)
      ORDER BY v.id LIMIT 1`,
    [workshopId, ...(exceptId ? [exceptId] : []), emirate, emirate, num, code, code, code + num]
  );
  return rows[0] || null;
}

function duplicatePlate(res, dup, customerId) {
  const same = Number(dup.customer_id) === Number(customerId);
  const plate = [dup.plate_code, dup.plate_number, dup.plate_emirate].filter(Boolean).join(' ');
  const car = [dup.make, dup.model].filter(Boolean).join(' ') || 'a vehicle';
  const existing = {
    vehicle_id: dup.id, customer_id: dup.customer_id, customer_name: dup.full_name,
    plate_number: dup.plate_number, plate_code: dup.plate_code, plate_emirate: dup.plate_emirate,
    make: dup.make, model: dup.model, same_customer: same,
  };
  return res.status(409).json({
    success: false,
    code: 'PLATE_DUPLICATE',
    message: same
      ? `Plate ${plate} is already on file for this customer (${car}). Choose that vehicle, or confirm this is a different car.`
      : `Plate ${plate} is already on file for ${car} (${dup.full_name}). Check the plate, or confirm this is a different car.`,
    data: existing,
    existing,
  });
}

/**
 * Runs `fn` holding a per-workshop lock. The duplicate checks are
 * check-then-insert, so two advisors saving the same car in the same instant
 * both passed the VIN check (#158); this holds the second for the few ms
 * until the first has written. `fn` gets a query runner on the same
 * connection.
 */
async function withVehicleLock(workshopId, fn) {
  const conn = await pool.getConnection();
  const name = `vehicle-identity:${workshopId}`;
  let got = false;
  try {
    const [[row]] = await conn.query('SELECT GET_LOCK(?, 5) AS got', [name]);
    got = !!row && Number(row.got) === 1;
    return await fn((sql, params) => conn.query(sql, params).then(([rows]) => rows));
  } finally {
    if (got) await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
    conn.release();
  }
}

/** 400 unless the customer is in this workshop and active (#90/#124: no new cars on a deactivated account). */
async function customerProblem(customerId, workshopId) {
  const [customer] = await query('SELECT id, is_active FROM customers WHERE id = ? AND workshop_id = ?', [customerId, workshopId]);
  if (!customer) return { message: 'Customer not found in this workshop' };
  if (!customer.is_active) {
    return { code: 'CUSTOMER_INACTIVE', message: 'This customer is deactivated. A manager can reactivate it under Customers.' };
  }
  return null;
}

// D10: a technician sees the cars on the jobs assigned to them, not the
// whole vehicle book with every owner's name and phone number. Returns the
// SQL condition on `v` and its params, or null for everyone else.
async function technicianScope(req) {
  if (isManagerRole(req.user) || effectiveRole(req.user) !== 'technician') return null;
  const [m] = await query('SELECT id FROM mechanics WHERE user_id = ? AND workshop_id = ?', [req.user.id, req.workshopId]);
  const mechanicId = m ? m.id : 0;
  return {
    sql: ` AND EXISTS (SELECT 1 FROM work_orders w
                        WHERE w.vehicle_id = v.id AND w.workshop_id = v.workshop_id
                          AND (w.mechanic_id = ?
                               OR EXISTS (SELECT 1 FROM job_cards jc WHERE jc.work_order_id = w.id AND jc.mechanic_id = ?)))`,
    params: [mechanicId, mechanicId],
    mechanicId,
  };
}


const router = express.Router();
router.use(authMiddleware);

// NEW MODULE (not in original delivery-service source): customer-owned vehicles.
// A vehicle belongs to a customer within a workshop; work_orders reference
// vehicles via vehicle_id so service history can be tracked per-vehicle.

// GET /api/vehicles
router.get('/', async (req, res) => {
  try {
    const { search, customer_id, fuel_type, sort = 'recent', page = 1, limit = 50 } = req.query;
    const pg = parseInt(page, 10) || 1;
    const lim = parseInt(limit, 10) || 50;
    const offset = (pg - 1) * lim;
    let where = 'WHERE v.workshop_id = ? AND v.is_active = TRUE';
    const params = [req.workshopId];

    if (customer_id) { where += ' AND v.customer_id = ?'; params.push(customer_id); }
    if (fuel_type) { where += ' AND v.fuel_type = ?'; params.push(fuel_type); }
    if (search) {
      // Searched on the server so every car of a fleet account is reachable,
      // not just the first page the wizard loaded (#2, C2). Plate and VIN
      // compare on letters and digits only ("A 12345" = "a-12345"), and the
      // plate also with its code in front of it.
      const term = String(search).trim();
      const like = `%${term}%`;
      const key = plateKey(term);
      const conds = ['v.plate_number LIKE ?', 'v.plate_code LIKE ?', 'v.vin LIKE ?', 'v.make LIKE ?', 'v.model LIKE ?',
        'v.fleet_code LIKE ?', "CONCAT_WS(' ', v.make, v.model) LIKE ?"];
      const p = [like, like, like, like, like, like, like];
      if (key) {
        conds.push(`UPPER(REGEXP_REPLACE(CONCAT(COALESCE(v.plate_code, ''), COALESCE(v.plate_number, '')), '[^A-Za-z0-9]', '')) LIKE ?`,
          `${VIN_KEY_SQL} LIKE ?`);
        p.push(`%${key}%`, `%${key}%`);
      }
      // With one customer picked, the owner's name would match every car
      // they own, so it is only searched across the whole book.
      if (!customer_id) { conds.push('c.full_name LIKE ?'); p.push(like); }
      where += ` AND (${conds.join(' OR ')})`;
      params.push(...p);
    }
    const scope = await technicianScope(req);
    if (scope) { where += scope.sql; params.push(...scope.params); }

    const orderBy =
      sort === 'oldest'   ? 'v.created_at ASC'  :
      sort === 'mileage'  ? 'v.mileage DESC'    :
      sort === 'services' ? 'wo_count DESC'     :
      sort === 'make'     ? 'v.make ASC, v.model ASC' :
                            'v.created_at DESC';

    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM vehicles v
       LEFT JOIN customers c ON c.id = v.customer_id ${where}`,
      params
    );

    const vehicles = await query(
      `SELECT v.*,
              c.full_name AS customer_name,
              c.phone     AS customer_phone,
              (SELECT COUNT(*)            FROM work_orders w WHERE w.vehicle_id = v.id AND w.workshop_id = v.workshop_id) AS wo_count,
              (SELECT MAX(w.created_at)   FROM work_orders w WHERE w.vehicle_id = v.id AND w.workshop_id = v.workshop_id) AS last_service_at,
              (SELECT COALESCE(SUM(COALESCE(NULLIF(w.total_amount,0), NULLIF(w.service_fee,0), 0)),0) FROM work_orders w WHERE w.vehicle_id = v.id AND w.workshop_id = v.workshop_id AND w.status = 'completed') AS total_spent
       FROM vehicles v
       LEFT JOIN customers c ON c.id = v.customer_id
       ${where} ORDER BY ${orderBy} LIMIT ${lim} OFFSET ${offset}`,
      params
    );

    // ── Workshop-wide summary (KPIs + fuel breakdown) ──
    const [summary] = await query(
      `SELECT COUNT(*) AS total_vehicles,
              COUNT(DISTINCT v.customer_id) AS unique_owners,
              COALESCE(AVG(v.mileage),0) AS avg_mileage
       FROM vehicles v WHERE v.workshop_id = ? AND v.is_active = TRUE`,
      [req.workshopId]
    );
    const [woSummary] = await query(
      `SELECT COUNT(*) AS total_services,
              COALESCE(SUM(CASE WHEN status = 'completed'
                    THEN COALESCE(NULLIF(total_amount,0), NULLIF(service_fee,0), 0)
                    ELSE 0 END),0) AS total_service_value
       FROM work_orders WHERE workshop_id = ? AND vehicle_id IS NOT NULL`,
      [req.workshopId]
    );
    const fuelRows = await query(
      `SELECT fuel_type, COUNT(*) AS cnt FROM vehicles
       WHERE workshop_id = ? AND is_active = TRUE GROUP BY fuel_type`,
      [req.workshopId]
    );
    const fuel_breakdown = fuelRows.reduce((acc, r) => { acc[r.fuel_type || 'other'] = Number(r.cnt); return acc; }, {});

    return res.json({
      success: true,
      data: vehicles,
      // Every matching row, not just this page: the wizard's "1,758
      // vehicles on file" hint comes from it.
      total,
      pagination: { total, page: pg, limit: lim },
      summary: {
        total_vehicles: Number(summary?.total_vehicles || 0),
        unique_owners: Number(summary?.unique_owners || 0),
        avg_mileage: Math.round(Number(summary?.avg_mileage || 0)),
        total_services: Number(woSummary?.total_services || 0),
        total_service_value: Number(woSummary?.total_service_value || 0),
        fuel_breakdown,
      },
    });
  } catch (err) {
    console.error('[Vehicles] List error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch vehicles' });
  }
});

// GET /api/vehicles/:id
router.get('/:id', async (req, res) => {
  try {
    const scope = await technicianScope(req);
    const [vehicle] = await query(
      `SELECT v.*, c.full_name as customer_name, c.phone as customer_phone
       FROM vehicles v
       LEFT JOIN customers c ON c.id = v.customer_id
       WHERE v.id = ? AND v.workshop_id = ?${scope ? scope.sql : ''}`,
      [req.params.id, req.workshopId, ...(scope ? scope.params : [])]
    );
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });

    const [workOrderStats] = await query(
      `SELECT COUNT(*) as total_work_orders,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_work_orders
       FROM work_orders WHERE vehicle_id = ? AND workshop_id = ?`,
      [req.params.id, req.workshopId]
    );
    const workOrders = await query(
      `SELECT id, work_order_number, status, customer_approved_at, service_fee, total_amount, cash_amount, payment_method, created_at
       FROM work_orders WHERE vehicle_id = ? AND workshop_id = ? ORDER BY created_at DESC LIMIT 20`,
      [req.params.id, req.workshopId]
    );
    return res.json({ success: true, data: { ...vehicle, ...workOrderStats, work_orders: workOrders } });
  } catch (err) {
    console.error('[Vehicles] Fetch error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch vehicle' });
  }
});

// GET /api/vehicles/:id/work-orders — full service history for a vehicle
router.get('/:id/work-orders', async (req, res) => {
  try {
    const scope = await technicianScope(req);
    const [vehicle] = await query(
      `SELECT v.id FROM vehicles v WHERE v.id = ? AND v.workshop_id = ?${scope ? scope.sql : ''}`,
      [req.params.id, req.workshopId, ...(scope ? scope.params : [])]);
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });

    // A technician gets their own jobs on this car, not its whole history.
    const own = scope
      ? ' AND (w.mechanic_id = ? OR EXISTS (SELECT 1 FROM job_cards jc WHERE jc.work_order_id = w.id AND jc.mechanic_id = ?))'
      : '';
    const workOrders = await query(
      `SELECT w.*, c.full_name as customer_name
       FROM work_orders w
       LEFT JOIN customers c ON c.id = w.customer_id
       WHERE w.vehicle_id = ? AND w.workshop_id = ?${own}
       ORDER BY w.created_at DESC`,
      [req.params.id, req.workshopId, ...(scope ? [scope.mechanicId, scope.mechanicId] : [])]
    );
    return res.json({ success: true, data: workOrders });
  } catch (err) {
    console.error('[Vehicles] Work orders error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch work orders for vehicle' });
  }
});

// POST /api/vehicles
router.post('/', canEditVehicles, async (req, res) => {
  try {
    const body = _clean(req.body);
    const { customer_id, notes } = body;
    const v = {
      make: text(body.make),
      model: text(body.model),
      year: blank(body.year) ? null : body.year,
      mileage: blank(body.mileage) ? null : body.mileage,
      plate_number: normPlate(body.plate_number),
      plate_code: normPlate(body.plate_code),
      plate_emirate: text(body.plate_emirate),
      vin: normVin(body.vin),
      engine_no: text(body.engine_no),
      fleet_code: text(body.fleet_code),
      color: text(body.color),
      fuel_type: blank(body.fuel_type) ? 'petrol' : String(body.fuel_type).trim().toLowerCase(),
      transmission: blank(body.transmission) ? 'automatic' : String(body.transmission).trim().toLowerCase(),
    };

    if (!customer_id || !v.make || !v.model) {
      return res.status(400).json({ success: false, message: 'Customer, make and model required' });
    }

    // ── VIN is mandatory on every new vehicle (process change, 15 Sep 2026) ──
    // Only on create. The 5,694 vehicles already on file without one are
    // left alone; they get their VIN the next time the car comes in, which
    // is when the job card wizard asks for it.
    //
    // `allow_missing_vin` is for the bulk importer replaying a supplier
    // file that genuinely has no chassis numbers — it is not sent by any
    // screen, so it is a manager's: an advisor could otherwise skip the
    // mandatory VIN through the API.
    const allowMissingVin = req.body?.allow_missing_vin === true && isManagerRole(req.user);
    if (!allowMissingVin && !v.vin) {
      return res.status(400).json({
        success: false,
        code: 'VIN_REQUIRED',
        message: 'VIN / chassis number is required.',
      });
    }
    const problem = fieldProblem(v);
    if (problem) return res.status(400).json({ success: false, ...problem });

    // Validate customer belongs to the same workshop (and is active) before inserting
    const custErr = await customerProblem(customer_id, req.workshopId);
    if (custErr) return res.status(400).json({ success: false, ...custErr });

    const created = await withVehicleLock(req.workshopId, async (run) => {
      // A chassis number is unique to one car in the world, so the same VIN
      // on two rows means one of them is wrong — usually the same car added
      // twice under two customers, which then splits its service history in
      // half. Blocked outright rather than warned about, because unlike a
      // duplicate name there is no legitimate case for it.
      if (v.vin) {
        const dupVin = await findVinOwner(run, req.workshopId, v.vin);
        if (dupVin) return { send: () => duplicateVin(res, dupVin) };
      }
      // A plate, unlike a VIN, can legitimately repeat, so this one asks.
      if (v.plate_number && req.body?.confirm_duplicate_plate !== true) {
        const dupPlate = await findPlateOwner(run, req.workshopId, v);
        if (dupPlate) return { send: () => duplicatePlate(res, dupPlate, customer_id) };
      }
      const result = await run(
        `INSERT INTO vehicles (workshop_id, customer_id, make, model, year, plate_number,
          plate_code, plate_emirate, vin, engine_no, fleet_code,
          color, mileage, fuel_type, transmission, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.workshopId, customer_id, v.make, v.model, toInt(v.year), v.plate_number,
         v.plate_code, v.plate_emirate, v.vin,
         v.engine_no, v.fleet_code,
         v.color, toInt(v.mileage), v.fuel_type, v.transmission, notes || null]
      );
      return { id: result.insertId };
    });
    if (created.send) return created.send();

    const [vehicle] = await query('SELECT * FROM vehicles WHERE id = ?', [created.id]);
    return res.status(201).json({ success: true, data: vehicle });
  } catch (err) {
    console.error('[Vehicles] Create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create vehicle' });
  }
});

// PUT /api/vehicles/:id
router.put('/:id', canEditVehicles, async (req, res) => {
  try {
    // Fetch existing record so partial updates don't null-out required fields
    const [existing] = await query('SELECT * FROM vehicles WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]);
    if (!existing) return res.status(404).json({ success: false, message: 'Vehicle not found' });

    const raw = req.body || {};
    const body = _clean(raw);
    const sent = k => Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined;
    const manager = isManagerRole(req.user);

    // What will be stored: each field sent (normalised), else the row as it is.
    const next = {
      customer_id: sent('customer_id') && !blank(raw.customer_id) ? Number(raw.customer_id) : existing.customer_id,
      make: sent('make') ? text(body.make) : existing.make,
      model: sent('model') ? text(body.model) : existing.model,
      year: sent('year') ? (blank(body.year) ? null : body.year) : existing.year,
      plate_number: sent('plate_number') ? normPlate(body.plate_number) : existing.plate_number,
      plate_code: sent('plate_code') ? normPlate(body.plate_code) : existing.plate_code,
      plate_emirate: sent('plate_emirate') ? text(body.plate_emirate) : existing.plate_emirate,
      vin: sent('vin') ? normVin(body.vin) : existing.vin,
      engine_no: sent('engine_no') ? text(body.engine_no) : existing.engine_no,
      fleet_code: sent('fleet_code') ? text(body.fleet_code) : existing.fleet_code,
      color: sent('color') ? text(body.color) : existing.color,
      mileage: sent('mileage') ? (blank(body.mileage) ? null : body.mileage) : existing.mileage,
      fuel_type: sent('fuel_type') && !blank(body.fuel_type) ? String(body.fuel_type).trim().toLowerCase() : existing.fuel_type,
      transmission: sent('transmission') && !blank(body.transmission) ? String(body.transmission).trim().toLowerCase() : existing.transmission,
      notes: sent('notes') ? body.notes : existing.notes,
    };
    if (!next.make || !next.model) {
      return res.status(400).json({ success: false, message: 'Make and model required' });
    }

    // Deactivating is what DELETE does, and that is manager-only; a
    // Storekeeper's PUT {is_active:false} was the way round it (#19).
    const isActive = sent('is_active') ? (raw.is_active === true || raw.is_active === 1 || raw.is_active === '1' || raw.is_active === 'true') : !!existing.is_active;
    if (isActive !== !!existing.is_active && !manager) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', message: 'Only a manager can deactivate or reactivate a vehicle.' });
    }

    // Only what changed is validated, so editing the mileage of an imported
    // car does not fail on the 15-character VIN or the year it came with.
    const changed = {};
    for (const k of ['make', 'model', 'plate_number', 'plate_code', 'plate_emirate', 'engine_no', 'fleet_code', 'color', 'fuel_type', 'transmission', 'year', 'mileage']) {
      if (String(next[k] ?? '') !== String(existing[k] ?? '')) changed[k] = next[k];
    }
    const vinChanged = (next.vin || '') !== (normVin(existing.vin) || '');
    if (vinChanged && next.vin) changed.vin = next.vin;
    // The VIN is what the job card is opened against (mandatory since 15 Sep).
    // Correcting it is fine; removing it leaves a car no job card can be
    // raised for (#19: a Team Leader cleared one).
    if (vinChanged && !next.vin && existing.vin && !manager) {
      return res.status(400).json({ success: false, code: 'VIN_REQUIRED', message: 'A recorded VIN cannot be removed. Correct it instead.' });
    }
    const problem = fieldProblem(changed);
    if (problem) return res.status(400).json({ success: false, ...problem });

    // Moving the car to another customer: that customer must be in this
    // workshop and active.
    if (next.customer_id !== existing.customer_id) {
      const custErr = await customerProblem(next.customer_id, req.workshopId);
      if (custErr) return res.status(400).json({ success: false, ...custErr });
    }

    const plateChanged = plateKey(next.plate_number) !== plateKey(existing.plate_number)
      || plateKey(next.plate_code) !== plateKey(existing.plate_code)
      || String(next.plate_emirate || '').trim().toLowerCase() !== String(existing.plate_emirate || '').trim().toLowerCase();

    const write = async (run) => {
      // Filling in a missing VIN is the main reason this endpoint gets called
      // from the job card wizard, so the same uniqueness rule as create
      // applies — excluding this vehicle's own row, or saving a record
      // without touching its VIN would report the vehicle as a duplicate of
      // itself.
      if (vinChanged && next.vin) {
        const dupVin = await findVinOwner(run, req.workshopId, next.vin, existing.id);
        if (dupVin) return { send: () => duplicateVin(res, dupVin) };
      }
      if (plateChanged && next.plate_number && raw.confirm_duplicate_plate !== true) {
        const dupPlate = await findPlateOwner(run, req.workshopId, next, existing.id);
        if (dupPlate) return { send: () => duplicatePlate(res, dupPlate, next.customer_id) };
      }
      await run(
        `UPDATE vehicles SET customer_id=?, make=?, model=?, year=?, plate_number=?,
         plate_code=?, plate_emirate=?, vin=?, engine_no=?, fleet_code=?,
         color=?, mileage=?, fuel_type=?, transmission=?, notes=?, is_active=?
         WHERE id = ? AND workshop_id = ?`,
        [next.customer_id, next.make, next.model, toInt(next.year), next.plate_number,
         next.plate_code, next.plate_emirate,
         next.vin, next.engine_no, next.fleet_code,
         next.color, toInt(next.mileage), next.fuel_type, next.transmission, next.notes || null,
         isActive, req.params.id, req.workshopId]
      );
      return {};
    };
    const outcome = (vinChanged || plateChanged)
      ? await withVehicleLock(req.workshopId, write)
      : await write(query);
    if (outcome.send) return outcome.send();

    const [vehicle] = await query('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
    return res.json({ success: true, data: vehicle });
  } catch (err) {
    console.error('[Vehicles] Update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update vehicle' });
  }
});

// DELETE /api/vehicles/:id — soft delete (consistent with customers.js convention)
router.delete('/:id', requireManager, async (req, res) => {
  try {
    await execute('UPDATE vehicles SET is_active = FALSE WHERE id = ? AND workshop_id = ?',
      [req.params.id, req.workshopId]);
    return res.json({ success: true, message: 'Vehicle deactivated' });
  } catch (err) {
    console.error('[Vehicles] Delete error:', err);
    return res.status(500).json({ success: false, message: 'Failed to deactivate vehicle' });
  }
});

export default router;
