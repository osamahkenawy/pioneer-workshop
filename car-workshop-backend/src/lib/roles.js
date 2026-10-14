/**
 * roles.js — who does what in the workshop workflow (Steps 1–7,
 * Pioneer_Complete_Workshop_Workflow_Steps_1_to_7.pdf).
 *
 * One table, read by the routes (enforcement), the job card screen (which
 * buttons to show) and Settings → Roles (what each role is responsible for).
 *
 * A user's effective role is their assigned role (roles.slug via role_id)
 * or, for accounts that predate the roles table, the users.role enum.
 * Owners and admins can do everything.
 */

/** Capability → the roles that hold it (managers hold all of them). */
export const CAPABILITIES = {
  'job.open':           { roles: ['service_advisor', 'supervisor'],                                   step: 2, label: 'Open job cards and record the vehicle and issue' },
  'estimate.raise':     { roles: ['service_advisor'],                                                 step: 4, label: 'Raise and send estimates; price labour' },
  'estimate.price_parts': { roles: ['storekeeper', 'part_advisor'],                                   step: 5, label: 'Price parts — Genuine / After-Market / N/A' },
  'estimate.approve':   { roles: ['supervisor'],                                                      step: 5, label: 'Approve estimates for external customers' },
  'customer.approval':  { roles: ['service_advisor'],                                                 step: 6, label: "Record the customer's decision" },
  'job.assign':         { roles: ['team_leader', 'supervisor', 'workshop_foreman'],                   step: 6, label: 'Assign technicians; open sub-job cards' },
  'time.book':          { roles: ['technician', 'team_leader', 'supervisor', 'workshop_foreman'],     step: 6, label: 'Book time (Start / Pause / Stop) and mark jobs done' },
  'parts.request':      { roles: ['technician', 'team_leader', 'supervisor', 'workshop_foreman', 'service_advisor'], step: 6, label: 'Raise material requisitions' },
  'store.issue':        { roles: ['storekeeper', 'part_advisor'],                                     step: 6, label: 'Check the shelf, issue parts, record expected dates' },
  'qc.perform':         { roles: ['supervisor', 'workshop_foreman', 'team_leader'],                   step: 7, label: 'Quality check and test drive' },
  // The key keeps its old name (stored in roles.capabilities); the job is the Step 7 handover.
  'delivery.handover':  { roles: ['service_advisor'],                                                 step: 7, label: 'Collection call, payment, gate pass, close the job' },
};

const MANAGERS = ['admin', 'super_admin', 'general_manager', 'workshop_manager'];

/**
 * Legacy users.role values without a roles row: what they act as.
 * 'dispatcher' was the front-desk role of the delivery product; here it is
 * the Service Advisor's desk. 'mechanic' is the technician.
 */
const LEGACY = { dispatcher: 'service_advisor', mechanic: 'technician' };

/** The role a user acts as in the workflow. */
export function effectiveRole(user) {
  if (!user) return null;
  const key = user.role_slug || user.role;
  return LEGACY[key] || key;
}

export function isManagerRole(user) {
  return !!user && (user.is_owner === 1 || user.is_owner === true || MANAGERS.includes(user.role) || MANAGERS.includes(user.role_slug));
}

/** The defaults a role slug holds (before any Settings → Roles change). */
export function defaultCapabilities(slug) {
  const key = LEGACY[slug] || slug;
  if (MANAGERS.includes(key)) return Object.keys(CAPABILITIES);
  return Object.keys(CAPABILITIES).filter(c => CAPABILITIES[c].roles.includes(key));
}

/**
 * Does this user hold the capability? Managers hold all. A role whose
 * responsibilities were set in Settings → Roles uses that list; otherwise the
 * defaults for its slug.
 */
export function can(user, capability) {
  if (!user || !CAPABILITIES[capability]) return false;
  if (isManagerRole(user)) return true;
  if (Array.isArray(user.role_capabilities)) return user.role_capabilities.includes(capability);
  return CAPABILITIES[capability].roles.includes(effectiveRole(user));
}

/** Every capability this user holds — sent to the screen. */
export function capabilitiesOf(user) {
  return Object.keys(CAPABILITIES).filter(c => can(user, c));
}

/** SQL fragment + params matching users who hold a capability (for notifications). */
export function roleKeysFor(capability) {
  const def = CAPABILITIES[capability];
  const keys = new Set(def ? def.roles : []);
  // legacy enum values that act as one of these roles
  for (const [legacy, as] of Object.entries(LEGACY)) if (keys.has(as)) keys.add(legacy);
  if (keys.has('technician')) keys.add('mechanic');
  return [...keys];
}

/** Express middleware: require a capability. */
export function requireCapability(capability, message) {
  return (req, res, next) => {
    if (can(req.user, capability)) return next();
    const def = CAPABILITIES[capability];
    return res.status(403).json({
      success: false, code: 'ROLE_NOT_ALLOWED',
      message: message || `Your role can't do this. ${def ? `(${def.label} — ${def.roles.map(prettyRole).join(', ')} or a manager)` : ''}`.trim(),
    });
  };
}

export function prettyRole(r) {
  return ({ service_advisor: 'Service Advisor', storekeeper: 'Storekeeper', part_advisor: 'Part Advisor', supervisor: 'Supervisor',
    workshop_foreman: 'Workshop Foreman', team_leader: 'Team Leader', technician: 'Technician' })[r] || r;
}

/**
 * Menu modules each workflow role starts with (Settings → Roles can change
 * them). Keys match the sidebar's moduleKey values.
 */
export const DEFAULT_MODULES = {
  general_manager:  null, // everything
  workshop_manager: ['dashboard', 'notifications', 'enquiries', 'work-orders', 'estimates', 'appointments', 'fleet-intake', 'invoices', 'customers', 'vehicles', 'mechanics',
                     'service-bays', 'job-assignment', 'team-leader', 'store', 'parts', 'inventory', 'service-status', 'warranty-claims', 'complaints',
                     'customer-feedback', 'customer-experience', 'crm-customers', 'crm-reminders', 'crm-tasks', 'reports', 'performance', 'technician-kpi'],
  service_advisor:  ['dashboard', 'notifications', 'enquiries', 'work-orders', 'estimates', 'appointments', 'fleet-intake', 'invoices', 'customers', 'vehicles', 'service-status',
                     'complaints', 'customer-feedback', 'customer-experience', 'crm-customers', 'crm-reminders', 'crm-tasks'],
  storekeeper:      ['dashboard', 'notifications', 'store', 'estimates', 'work-orders', 'parts', 'inventory'],
  part_advisor:     ['dashboard', 'notifications', 'store', 'estimates', 'work-orders', 'parts', 'inventory'],
  supervisor:       ['dashboard', 'notifications', 'work-orders', 'estimates', 'job-assignment', 'team-leader', 'mechanics', 'customers', 'vehicles',
                     'service-status', 'reports', 'performance', 'technician-kpi'],
  workshop_foreman: ['dashboard', 'notifications', 'work-orders', 'job-assignment', 'team-leader', 'mechanics', 'service-bays', 'service-status'],
  team_leader:      ['dashboard', 'notifications', 'work-orders', 'team-leader', 'job-assignment', 'mechanics', 'service-status'],
};
