/**
 * Car Workshop Platform — API server entrypoint.
 *
 * Express app + Socket.IO, all routers mounted under /api/...
 */
import express from 'express';
import http from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config.js';
import { ensurePushTable } from './lib/push.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const swaggerDocument = yamlLoad(readFileSync(join(__dirname, 'swagger.yaml'), 'utf8'));
import { initSocket } from './lib/socket.js';

// ── Cron / background jobs ────────────────────────────────────────────────
import { startAcceptanceTimeout } from './lib/acceptance-timeout.js';
import { startJobDelayChecker } from './lib/job-delay-checker.js';
import { startPartsEtaAlerts } from './lib/parts-eta-alerts.js';
import { startDocExpiryCron } from './lib/doc-expiry-cron.js';
import { startDataRetention } from './lib/data-retention.js';
import { startTrialEnforcer } from './lib/trial-enforcer.js';
import { startScheduledReports } from './lib/scheduled-reports.js';

// ── Routers ────────────────────────────────────────────────────────────────
import authRouter from './routes/auth.js';
import workshopsRouter from './routes/workshops.js';
import mechanicsRouter from './routes/mechanics.js';
import customersRouter from './routes/customers.js';
import enquiriesRouter from './routes/enquiries.js';
import serviceBaysRouter from './routes/service-bays.js';
import vehiclesRouter from './routes/vehicles.js';
import workOrdersRouter from './routes/work-orders.js';
import customerFeedbackRouter from './routes/customer-feedback.js';
import vehicleInspectionsRouter from './routes/vehicle-inspections.js';
import partsRouter from './routes/parts.js';
import jobAssignmentRouter from './routes/job-assignment.js';
import servicePricingRouter from './routes/service-pricing.js';
import serviceStatusRouter from './routes/service-status.js';
import cashPaymentRouter from './routes/cash-payment.js';
import warrantyClaimsRouter from './routes/warranty-claims.js';
import mechanicEarningsRouter from './routes/mechanic-earnings.js';
import customerAuthRouter from './routes/customer-auth.js';
import customerPortalRouter from './routes/customer-portal.js';
import walletRouter from './routes/wallet.js';
import invoicesRouter from './routes/invoices.js';
import financialAdvancedRouter from './routes/financial-advanced.js';
import stripeRouter from './routes/stripe.js';
import webhooksRouter from './routes/webhooks.js';
import reportsRouter from './routes/reports.js';
import statsRouter from './routes/stats.js';
import settingsRouter from './routes/settings.js';
import notificationsRouter from './routes/notifications.js';
import userNotificationsRouter from './routes/user-notifications.js';
import integrationsRouter from './routes/integrations.js';
import uploadsRouter from './routes/uploads.js';
import apiV1Router from './routes/api-v1.js';
import { apiKeyAuth } from './middleware/api-key-auth.js';
import publicApiRouter from './routes/public-api.js';
import { publicSurveyRouter, adminSurveyRouter } from './routes/customer-survey.js';
import { publicCareersRouter, adminCareersRouter } from './routes/careers.js';
import { legalPublicRouter, legalAdminRouter } from './routes/legal-pages.js';
// CRM phase 1
import crmCustomersRouter from './routes/crm-customers.js';
import crmTasksRouter from './routes/crm-tasks.js';
import crmRemindersRouter from './routes/crm-reminders.js';
import { startReminderCron } from './lib/reminder-cron.js';
import superAdminRouter, { verifySuperAdmin } from './routes/super-admin.js';
import { authMiddleware } from './middleware/auth.js';
import { query } from './lib/database.js';
import superAdminEnhancedRouter from './routes/super-admin-enhanced.js';

// ── SOW: New modules ──────────────────────────────────────────────────────
import appointmentsRouter from './routes/appointments.js';
import vehicleReceivingRouter from './routes/vehicle-receiving.js';
import estimatesRouter, { publicEstimateRouter } from './routes/estimates.js';
import publicInspectionsRouter from './routes/public-inspections.js';
import publicServiceStatusRouter from './routes/public-service-status.js';
import jobCardsRouter from './routes/job-cards.js';
import workflowRouter from './routes/workflow.js';
import vehicleBoardRouter from './routes/vehicle-board.js';
import teamLeaderRouter from './routes/team-leader.js';
import fleetIntakeRouter, { publicFleetIntakeRouter } from './routes/fleet-intake.js';
import inventoryRouter from './routes/inventory.js';
import subletRouter, { proformaRouter } from './routes/sublet.js';
import { vatRouter, evhcRouter, groupIntegrationRouter } from './routes/vat-evhc-integration.js';
import disputesRouter from './routes/disputes.js';
import mechanicKpiRouter from './routes/mechanic-kpi.js';
import helmet from 'helmet';

const app = express();
const httpServer = http.createServer(app);

app.set('trust proxy', 1);

// ── Security headers ─────────────────────────────────────────────────────
// The app previously sent none of these; nginx supplied only X-Frame-Options
// and nosniff.
//
// script-src is enforced at 'self' — that is the header that actually blunts
// injected <script>, which is the payload that matters for stored XSS. Styles
// keep 'unsafe-inline' because the UI is built almost entirely with React
// inline style props, and CSP governs style attributes; enforcing style-src
// would blank the product. img-src allows data: and https: for map tiles and
// avatars, and connect-src covers the API plus the websocket.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src':     ["'self'"],
      'script-src':      ["'self'"],
      'style-src':       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      'font-src':        ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'img-src':         ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src':     ["'self'", 'https:', 'wss:'],
      'frame-ancestors': ["'none'"],
      'object-src':      ["'none'"],
      'base-uri':        ["'self'"],
      'form-action':     ["'self'"],
      'upgrade-insecure-requests': [],
    },
  },
  // Six months, subdomains included. Only meaningful over TLS, which the
  // production hostname already serves.
  hsts: { maxAge: 15552000, includeSubDomains: true, preload: false },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Uploaded images are served from this origin and embedded by the SPA.
  crossOriginResourcePolicy: { policy: 'same-site' },
  // Would break the Stripe redirect flow and popup-based auth.
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Not covered by helmet's defaults.
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  next();
});
// Dev origins are allowed only outside production; shipping localhost in the
// production allow-list lets a developer's machine drive authenticated,
// credentialed requests against live data.
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];
const corsOrigins = config.env === 'production'
  ? [config.frontendUrl]
  : [config.frontendUrl, ...DEV_ORIGINS];
// The marketing site posts the public enquiry form straight from a browser, so
// that one path needs its own origin allow-list. It MUST be mounted before the
// global cors() below: that middleware answers preflight requests itself and
// ends them, so anything mounted later never sees an OPTIONS and the browser
// gets no Access-Control-Allow-Origin.
app.use('/api/public/enquiries', cors({
  origin: (origin, cb) => cb(null, !origin || config.publicWebOrigins.includes(origin)),
  methods: ['POST', 'OPTIONS'],
  credentials: false,
}));

app.use(cors({ origin: config.frontendUrl === '*' ? true : corsOrigins, credentials: true }));

// ── Stripe webhook MUST be mounted before the global JSON body parser,
//    because it needs the raw request body (express.raw()) to verify the
//    Stripe signature. It's registered here first so its raw-body route
//    matches before express.json() would otherwise consume the stream. ──
app.use('/api/stripe', stripeRouter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static file serving for uploaded content (proofs, avatars, documents, etc.)
// Identity documents and job applicants' CVs are not public files. Staff
// browsers send the auth cookie with <img>/link requests, so this works for
// the screens that show them. Signatures, proof photos and logos stay public
// (customer tracking pages and emails use them).
app.use(['/uploads/mechanic-docs', '/uploads/resumes'], authMiddleware);
app.use('/uploads', express.static(new URL('../uploads', import.meta.url).pathname));

// Country list for phone-number inputs (PhoneInput.jsx calls /api/countries;
// it 404'd and every form fell back to a short built-in list).
app.get('/api/countries', async (_req, res) => {
  try {
    const rows = await query('SELECT name, iso, phone_code FROM countries WHERE is_active = 1 ORDER BY sort_order, name');
    // The stored flag emojis were saved through a 3-byte charset and read back
    // as '????'; build each flag from its ISO code (regional indicator letters).
    const flag = (iso) => /^[A-Za-z]{2}$/.test(iso || '')
      ? String.fromCodePoint(...[...iso.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';
    res.json({ success: true, data: rows.map(r => ({ ...r, flag: flag(r.iso) })) });
  } catch {
    res.json({ success: true, data: [] });
  }
});

// Workshop logos by relative path, as linked from emails (lib/email.js) and
// the customer portal: /api/file?path=logos/x.png. Logos only — nothing else
// under uploads is reachable this way.
app.get('/api/file', (req, res) => {
  const rel = String(req.query.path || '');
  if (!/^logos\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|svg|gif)$/i.test(rel)) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  res.sendFile(join(new URL('../uploads', import.meta.url).pathname, rel), err => {
    if (err && !res.headersSent) res.status(404).json({ success: false, message: 'Not found' });
  });
});

app.get('/health', (req, res) => {
  res.json({ success: true, service: 'car-workshop-backend', status: 'ok', time: new Date().toISOString() });
});

// ── Swagger UI ───────────────────────────────────────────────────────────
// Interactive documentation of every endpoint is a reconnaissance aid; it is
// off in production unless deliberately enabled.
const docsEnabled = config.env !== 'production' || process.env.ENABLE_API_DOCS === 'true';
if (docsEnabled) {
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customSiteTitle: 'Car Workshop API Docs',
  swaggerOptions: { persistAuthorization: true },
}));
} else {
  app.use('/api/docs', (_req, res) => res.status(404).json({ success: false, message: 'Not found' }));
}

// ── Core platform ───────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/workshops', workshopsRouter);
app.use('/api/mechanics', mechanicsRouter);
app.use('/api/customers', customersRouter);
// Journey stages 01-02: enquiry capture and channel attribution
app.use('/api/enquiries', enquiriesRouter);
app.use('/api/service-bays', serviceBaysRouter);
app.use('/api/vehicles', vehiclesRouter);

// ── Work order lifecycle ────────────────────────────────────────────────
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/customer-feedback', customerFeedbackRouter);
app.use('/api/vehicle-inspections', vehicleInspectionsRouter);
app.use('/api/parts', partsRouter);
app.use('/api/job-assignment', jobAssignmentRouter);
app.use('/api/service-pricing', servicePricingRouter);
app.use('/api/service-status', serviceStatusRouter);
app.use('/api/cash-payment', cashPaymentRouter);
app.use('/api/warranty-claims', warrantyClaimsRouter);

// ── Mechanic-facing ──────────────────────────────────────────────────────
app.use('/api/mechanic-earnings', mechanicEarningsRouter);
// /api/mechanic-documents is not mounted: no screen uses it, and the router
// has no login check of its own. To bring it back, fix its expires_at /
// document_url columns and mount it as
// app.use('/api/mechanic-documents', authMiddleware, requireManager, router).
// /api/mechanic-app (the courier driver app's API) is no longer mounted: the
// technician app uses /api/job-cards/mine. lib/access.js still refuses the
// prefix for every role (RETIRED_PREFIXES).

// ── Customer-facing ──────────────────────────────────────────────────────
app.use('/api/customer-auth', customerAuthRouter);
app.use('/api/customer-portal', customerPortalRouter);

// ── Billing / finance ────────────────────────────────────────────────────
app.use('/api/wallet', walletRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/financial-advanced', financialAdvancedRouter);
app.use('/api/webhooks', webhooksRouter);

// ── Reporting / platform admin ──────────────────────────────────────────
app.use('/api/reports', reportsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/user-notifications', userNotificationsRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/uploads', uploadsRouter);

// ── External-facing API ─────────────────────────────────────────────────
// apiKeyAuth must run here: /api/v1 was mounted without it, and
// requireApiPermission() inside the router no-ops when req.isApiKey is falsy,
// so every v1 route was reachable with no credential at all.
app.use('/api/v1', apiKeyAuth, apiV1Router);
// The customer's status link (no login). Mounted before /api/public so the
// public API router never sees these paths.
app.use('/api/public/service-status', publicServiceStatusRouter);
app.use('/api/public', publicApiRouter);
// Customer feedback survey (CES / NPS / CSAT): public form + dashboard analysis
app.use('/api/public/survey', publicSurveyRouter);
app.use('/api/customer-survey', adminSurveyRouter);

// ── Marketing / content pages (each file exposes a public + admin router) ─
app.use('/api/careers', publicCareersRouter);
// Was mounted with no authentication at all (list/delete applications)
app.use('/api/admin/careers', verifySuperAdmin, adminCareersRouter);
// ── CRM phase 1 ──────────────────────────────────────────────
// Mounted under /api/crm so the module namespace matches the sidebar group and
// the per-tenant module keys.
app.use('/api/crm/customers', crmCustomersRouter);
app.use('/api/crm/tasks', crmTasksRouter);
app.use('/api/crm/reminders', crmRemindersRouter);

app.use('/api/legal-pages', legalPublicRouter);
app.use('/api/admin/legal-pages', legalAdminRouter);

// ── Super admin (platform owner) ────────────────────────────────────────
app.use('/api/super-admin', superAdminRouter);
app.use('/api/super-admin', superAdminEnhancedRouter);

// ── SOW: Aftersales workshop operations ──────────────────────────────────
// B1: Service reception & appointment management
app.use('/api/appointments', appointmentsRouter);
app.use('/api/vehicle-receiving', vehicleReceivingRouter);
// B3: Service estimates & operations master
app.use('/api/estimates', estimatesRouter);
// Customer-facing approve/reject link, emailed from POST /estimates/:id/send
app.use('/api/public/estimates', publicEstimateRouter);
// The customer's copy of a vehicle inspection, and their sign-off — link sent
// from POST /vehicle-inspections/:id/share
app.use('/api/public/inspections', publicInspectionsRouter);
// B5: Job cards, technician time capture, QC, loaner vehicles
app.use('/api/job-cards', jobCardsRouter);
// Workshop workflow Steps 1–7 (lib/workflow.js)
app.use('/api/workflow', workflowRouter);
// Vehicle Status Board: every open car by phase (Steps 1–7), staff only
app.use('/api/vehicle-board', vehicleBoardRouter);
// Team leader board: their technicians, the vehicles on the team, time bookings
app.use('/api/team-leader', teamLeaderRouter);
// Fleet coordinator intake: the vehicle information section on its own page
app.use('/api/fleet-intake', fleetIntakeRouter);
// The coordinator-facing form itself, opened from a tokenised link, no login
app.use('/api/public/fleet-intake', publicFleetIntakeRouter);
// B6: Inventory — requisitions, issues, returns, stock, reservations
app.use('/api/inventory', inventoryRouter);
// B8: Sublet management
app.use('/api/sublet', subletRouter);
// B9: Proforma invoices. The old /api/gate-pass router (sublet.js) is not
// mounted: the gate pass is issued in Step 7 through
// POST /api/workflow/work-orders/:id/gate-pass (delivery.handover, payment
// settled), which the legacy routes went around.
app.use('/api/proforma', proformaRouter);
// Complaints — wires up the pre-existing `disputes` table (intake, SLA
// timestamps, outcome, authority level); no category taxonomy yet.
app.use('/api/disputes', disputesRouter);
// Technician KPI snapshots — read-only view of periodic attendance/billing
// reports imported via scripts/import-mechanic-kpi.js.
app.use('/api/mechanic-kpi', mechanicKpiRouter);
// B9: UAE VAT & FTA e-invoicing
app.use('/api/vat', vatRouter);
// B3 req 74: Electronic Vehicle Health Check
app.use('/api/evhc', evhcRouter);
// Section C: Group integration (Autostrad)
app.use('/api/group-integration', groupIntegrationRouter);

// ── 404 handler ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── Global error handler ────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    success: false,
    message: config.env === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Socket.IO ────────────────────────────────────────────────────────────
initSocket(httpServer);

// ── Background jobs (cron) ──────────────────────────────────────────────
// These are resilient to a missing/unreachable DB — each wraps its own
// interval in try/catch so a DB hiccup doesn't crash the process.
if (process.env.DISABLE_CRON_JOBS !== 'true') {
  try { startJobDelayChecker(); } catch (e) { console.error('startJobDelayChecker failed:', e.message); }
  try { startPartsEtaAlerts(); } catch (e) { console.error('startPartsEtaAlerts failed:', e.message); }
  try { startDocExpiryCron(); } catch (e) { console.error('startDocExpiryCron failed:', e.message); }
  try { startScheduledReports(); } catch (e) { console.error('startScheduledReports failed:', e.message); }
  try { startReminderCron(); } catch (e) { console.error('startReminderCron failed:', e.message); }

  // Delivery-SaaS jobs, off unless explicitly asked for:
  //  - data retention hard-DELETEs parts (and, once its missing table exists,
  //    work orders) older than the plan's window — 365 days on the fallback plan
  //  - acceptance timeout un-assigns a mechanic who has not "accepted" within
  //    30 minutes, undoing the team leader's assignment
  //  - trial enforcer suspends workshops whose trial has lapsed
  if (process.env.ENABLE_DATA_RETENTION === 'true') {
    try { startDataRetention(); } catch (e) { console.error('startDataRetention failed:', e.message); }
  }
  if (process.env.ENABLE_ACCEPTANCE_TIMEOUT === 'true') {
    try { startAcceptanceTimeout(); } catch (e) { console.error('startAcceptanceTimeout failed:', e.message); }
  }
  if (process.env.ENABLE_TRIAL_ENFORCER === 'true') {
    try { startTrialEnforcer(); } catch (e) { console.error('startTrialEnforcer failed:', e.message); }
  }
}

// ensurePushTable() creates push_subscriptions and user_notifications. It was
// exported but never called, so on every deployment the in-app notification
// table simply did not exist and all seven notification routes returned 500.
// A table, not a job — so it runs whether or not cron jobs are enabled.
ensurePushTable()
  .then(() => console.log('✅ Notification tables ensured'))
  .catch(e => console.error('ensurePushTable failed:', e.message));

httpServer.listen(config.port, () => {
  console.log(`Car Workshop Platform API listening on port ${config.port} (${config.env})`);
});

export default app;
