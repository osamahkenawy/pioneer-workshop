import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import Protected, { RoleHome, StaffSessionNote, TECHNICIAN_HOME } from './components/Protected';
import Loader from './components/Loader';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import { MODULES } from './lib/modules';
import { PORTAL, PORTAL_BASE } from './pages/CustomerPortal/portalPaths';
import PortalRedirect from './pages/CustomerPortal/PortalRedirect';

/* ── Staff app (lazy) ─────────────────────────────────────── */
const WorkOrders        = lazy(() => import('./pages/WorkOrders'));
const WorkOrderDetail   = lazy(() => import('./pages/WorkOrderDetail'));
const VehicleInspection = lazy(() => import('./pages/VehicleInspection'));
const TeamLeader = lazy(() => import('./pages/TeamLeader'));
const FleetIntake = lazy(() => import('./pages/FleetIntake'));
const FleetIntakeQueue = lazy(() => import('./pages/FleetIntakeQueue'));
const Estimates = lazy(() => import('./pages/Estimates'));
const Appointments = lazy(() => import('./pages/Appointments'));
const Customers         = lazy(() => import('./pages/Customers'));
const Enquiries         = lazy(() => import('./pages/Enquiries'));
const CustomerFeedback  = lazy(() => import('./pages/CustomerFeedback'));
const CustomerSurveyPublic = lazy(() => import('./pages/CustomerSurveyPublic'));
const EstimateApproval = lazy(() => import('./pages/EstimateApproval'));
const InspectionLink = lazy(() => import('./pages/InspectionLink'));
const Vehicles          = lazy(() => import('./pages/Vehicles'));
const Parts             = lazy(() => import('./pages/Parts'));
const Mechanics         = lazy(() => import('./pages/Mechanics'));
const JobAssignment     = lazy(() => import('./pages/JobAssignment'));
const VehicleStatusBoard = lazy(() => import('./pages/VehicleStatusBoard'));
const WarrantyClaims    = lazy(() => import('./pages/WarrantyClaims'));
const ServiceBays       = lazy(() => import('./pages/ServiceBays'));
const ServicePricing    = lazy(() => import('./pages/ServicePricing'));
const Inventory         = lazy(() => import('./pages/Inventory'));
const Store             = lazy(() => import('./pages/Store'));
const MechanicEarnings  = lazy(() => import('./pages/MechanicEarnings'));
const Wallet            = lazy(() => import('./pages/Wallet'));
const Invoices          = lazy(() => import('./pages/Invoices'));
const CashPayments      = lazy(() => import('./pages/CashPayments'));
const Reports           = lazy(() => import('./pages/Reports'));
const CustomerExperience = lazy(() => import('./pages/CustomerExperience'));
const Complaints         = lazy(() => import('./pages/Complaints'));
const Performance       = lazy(() => import('./pages/Performance'));
const TechnicianKpi     = lazy(() => import('./pages/TechnicianKpi'));
const Notifications     = lazy(() => import('./pages/Notifications'));
const Settings          = lazy(() => import('./pages/Settings'));
const Integrations      = lazy(() => import('./pages/Integrations'));

/* ── Technician app (users.role 'mechanic') ───────────────── */
const TechnicianHome    = lazy(() => import('./pages/technician/TechnicianHome'));
const TechnicianJob     = lazy(() => import('./pages/technician/TechnicianJob'));
const TechnicianScan    = lazy(() => import('./pages/technician/TechnicianScan'));
const TechnicianHistory = lazy(() => import('./pages/technician/TechnicianHistory'));

/* ── Public / auth ────────────────────────────────────────── */
const RegisterPage        = lazy(() => import('./pages/RegisterPage'));
const SignupPage          = lazy(() => import('./pages/SignupPage'));
const ResetPassword       = lazy(() => import('./pages/ResetPassword'));
const ServiceStatusPublic = lazy(() => import('./pages/ServiceStatusPublic'));

/* ── CRM phase 1 ─────────────────────────────────────────── */
const Customer360  = lazy(() => import('./pages/Customer360'));
const CrmReminders = lazy(() => import('./pages/CrmReminders'));
const CrmTasks     = lazy(() => import('./pages/CrmTasks'));

/* ── Customer portal (/customer/*, paths from portalPaths.js) ─ */
const CustomerLayout          = lazy(() => import('./pages/CustomerPortal/CustomerLayout'));
const CustomerLogin           = lazy(() => import('./pages/CustomerPortal/CustomerLogin'));
const CustomerRegister        = lazy(() => import('./pages/CustomerPortal/CustomerRegister'));
const CustomerResetPassword   = lazy(() => import('./pages/CustomerPortal/CustomerResetPassword'));
const CustomerVerifyEmail     = lazy(() => import('./pages/CustomerPortal/CustomerVerifyEmail'));
const CustomerDashboard       = lazy(() => import('./pages/CustomerPortal/CustomerDashboard'));
const CustomerWorkOrders      = lazy(() => import('./pages/CustomerPortal/CustomerWorkOrders'));
const CustomerWorkOrderDetail = lazy(() => import('./pages/CustomerPortal/CustomerWorkOrderDetail'));
const CustomerVehicles        = lazy(() => import('./pages/CustomerPortal/CustomerVehicles'));
const CustomerInvoices        = lazy(() => import('./pages/CustomerPortal/CustomerInvoices'));
const CustomerSettings        = lazy(() => import('./pages/CustomerPortal/CustomerSettings'));

/* ── Super admin ──────────────────────────────────────────── */
const SuperAdminLogin           = lazy(() => import('./pages/SuperAdmin/SuperAdminLogin'));
const SuperAdminLayout          = lazy(() => import('./pages/SuperAdmin/SuperAdminLayout'));
const SuperAdminDashboard       = lazy(() => import('./pages/SuperAdmin/SuperAdminDashboard'));
const SuperAdminWorkshops       = lazy(() => import('./pages/SuperAdmin/SuperAdminWorkshops'));
const SuperAdminWorkshopDetail  = lazy(() => import('./pages/SuperAdmin/SuperAdminWorkshopDetail'));
const SuperAdminUsers           = lazy(() => import('./pages/SuperAdmin/SuperAdminUsers'));
const SuperAdminSubscriptions   = lazy(() => import('./pages/SuperAdmin/SuperAdminSubscriptions'));
const SuperAdminRevenue         = lazy(() => import('./pages/SuperAdmin/SuperAdminRevenue'));
const SuperAdminAnalytics       = lazy(() => import('./pages/SuperAdmin/SuperAdminAnalytics'));
const SuperAdminAnnouncements   = lazy(() => import('./pages/SuperAdmin/SuperAdminAnnouncements'));
const SuperAdminAuditLog        = lazy(() => import('./pages/SuperAdmin/SuperAdminAuditLog'));
const SuperAdminBackups         = lazy(() => import('./pages/SuperAdmin/SuperAdminBackups'));
const SuperAdminBarcodes        = lazy(() => import('./pages/SuperAdmin/SuperAdminBarcodes'));
const SuperAdminBranding        = lazy(() => import('./pages/SuperAdmin/SuperAdminBranding'));
const SuperAdminBulkOps         = lazy(() => import('./pages/SuperAdmin/SuperAdminBulkOps'));
const SuperAdminEmailTemplates  = lazy(() => import('./pages/SuperAdmin/SuperAdminEmailTemplates'));
const SuperAdminLandingContacts = lazy(() => import('./pages/SuperAdmin/SuperAdminLandingContacts'));
const SuperAdminLegalPages      = lazy(() => import('./pages/SuperAdmin/SuperAdminLegalPages'));
const SuperAdminModules         = lazy(() => import('./pages/SuperAdmin/SuperAdminModules'));
const SuperAdminOnboarding      = lazy(() => import('./pages/SuperAdmin/SuperAdminOnboarding'));
const SuperAdminSettings        = lazy(() => import('./pages/SuperAdmin/SuperAdminSettings'));
const SuperAdminSystemHealth    = lazy(() => import('./pages/SuperAdmin/SuperAdminSystemHealth'));
const SuperAdminTickets         = lazy(() => import('./pages/SuperAdmin/SuperAdminTickets'));
const SuperAdminVacancies       = lazy(() => import('./pages/SuperAdmin/SuperAdminVacancies'));

/** A redirect that keeps the query string (?wo= on old technician links, ?phase= on the board). */
function KeepQuery({ to }) {
  const { search } = useLocation();
  return <Navigate to={to + search} replace />;
}

function SignupSuccess() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 40, maxWidth: 460, textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 46, marginBottom: 12 }}>✅</div>
        <h1 style={{ fontSize: 22, margin: '0 0 10px' }}>Almost there!</h1>
        <p style={{ color: '#64748b', fontSize: 14.5, lineHeight: 1.6 }}>
          Your workshop account was created. Check your email inbox for a
          verification link to activate your account, then sign in.
        </p>
        <Link to="/login" style={{ display: 'inline-block', marginTop: 18, background: '#159fd9', color: '#fff', padding: '10px 24px', borderRadius: 10, textDecoration: 'none', fontWeight: 600 }}>
          Go to Sign In
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* ── Public / auth ── */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signup-success" element={<SignupSuccess />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/service-status/:token" element={<ServiceStatusPublic />} />
        {/* Every link the system sends (SMS, email, WhatsApp, job sheet QR) uses
            /track/:token, which had no route and bounced customers to the login. */}
        <Route path="/track/:token" element={<ServiceStatusPublic />} />
        {/* Public customer feedback survey — personalised link or anonymous / QR */}
        <Route path="/survey" element={<CustomerSurveyPublic />} />
        <Route path="/survey/:token" element={<CustomerSurveyPublic />} />
        {/* Public estimate approval — link emailed from POST /estimates/:id/send */}
        <Route path="/estimate-approval/:token" element={<EstimateApproval />} />
        {/* The customer's copy of the vehicle inspection, and where they sign —
            link sent from POST /vehicle-inspections/:id/share */}
        <Route path="/inspection/:token" element={<InspectionLink />} />
        {/* Fleet coordinator intake — no login; the token names the fleet account */}
        <Route path="/fleet-intake/:token" element={<FleetIntake />} />

        {/* ── Staff app ── Protected finds each page's menu module in Layout's
            ROUTE_MODULES; a role without it sees "Not available for your role". */}
        <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
        <Route path="/work-orders" element={<Protected><WorkOrders /></Protected>} />
        <Route path="/work-orders/:id" element={<Protected><WorkOrderDetail /></Protected>} />
        <Route path="/work-orders/:id/inspection" element={<Protected><VehicleInspection /></Protected>} />
        <Route path="/enquiries" element={<Protected><Enquiries /></Protected>} />
        <Route path="/customer-feedback" element={<Protected><CustomerFeedback /></Protected>} />
        <Route path="/customers" element={<Protected><Customers /></Protected>} />
        <Route path="/vehicles" element={<Protected><Vehicles /></Protected>} />
        <Route path="/parts" element={<Protected><Parts /></Protected>} />
        <Route path="/mechanics" element={<Protected><Mechanics /></Protected>} />
        <Route path="/job-assignment" element={<Protected><JobAssignment /></Protected>} />
        <Route path="/team-leader" element={<Protected><TeamLeader /></Protected>} />
        <Route path="/fleet-intake" element={<Protected><FleetIntakeQueue /></Protected>} />
        <Route path="/estimates" element={<Protected><Estimates /></Protected>} />
        <Route path="/appointments" element={<Protected><Appointments /></Protected>} />
        {/* Vehicle Status Board: every car in the workshop, by step. Service Tracking
            (the courier tracking page it replaced) redirects here. */}
        <Route path="/vehicle-board" element={<Protected module={MODULES.vehicleBoard}><VehicleStatusBoard /></Protected>} />
        <Route path="/service-tracking" element={<KeepQuery to="/vehicle-board" />} />
        <Route path="/warranty-claims" element={<Protected><WarrantyClaims /></Protected>} />
        {/* CRM. /crm/customers with no id shows a search; with an id, the 360 view. */}
        <Route path="/crm/customers" element={<Protected><Customer360 /></Protected>} />
        <Route path="/crm/customers/:id" element={<Protected><Customer360 /></Protected>} />
        <Route path="/crm/reminders" element={<Protected><CrmReminders /></Protected>} />
        <Route path="/crm/tasks" element={<Protected><CrmTasks /></Protected>} />
        <Route path="/service-bays" element={<Protected><ServiceBays /></Protected>} />
        <Route path="/service-pricing" element={<Protected><ServicePricing /></Protected>} />
        <Route path="/inventory" element={<Protected><Inventory /></Protected>} />
        <Route path="/store" element={<Protected><Store /></Protected>} />
        {/* Staff only: Protected sends a technician to My Jobs. */}
        <Route path="/mechanic-earnings" element={<Protected><MechanicEarnings /></Protected>} />
        <Route path="/wallet" element={<Protected><Wallet /></Protected>} />
        <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
        <Route path="/cash-payments" element={<Protected><CashPayments /></Protected>} />
        <Route path="/reports" element={<Protected><Reports /></Protected>} />
        <Route path="/customer-experience" element={<Protected><CustomerExperience /></Protected>} />
        <Route path="/complaints" element={<Protected><Complaints /></Protected>} />
        <Route path="/performance" element={<Protected><Performance /></Protected>} />
        <Route path="/technician-kpi" element={<Protected><TechnicianKpi /></Protected>} />
        {/* Templates, SMS / e-mail logs, broadcasts: managers only (the bell is for everyone) */}
        <Route path="/notifications" element={<Protected managersOnly><Notifications /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />
        <Route path="/api-keys" element={<Protected><Integrations /></Protected>} />

        {/* ── Technician app ── (Protected keeps technicians inside it) */}
        <Route path={TECHNICIAN_HOME} element={<Protected><TechnicianHome /></Protected>} />
        <Route path={`${TECHNICIAN_HOME}/jobs/:jobCardId`} element={<Protected><TechnicianJob /></Protected>} />
        <Route path={`${TECHNICIAN_HOME}/scan`} element={<Protected><TechnicianScan /></Protected>} />
        <Route path={`${TECHNICIAN_HOME}/history`} element={<Protected><TechnicianHistory /></Protected>} />
        {/* Old technician addresses (bookmarks, notifications already sent) */}
        <Route path={`${TECHNICIAN_HOME}/dashboard`} element={<KeepQuery to={TECHNICIAN_HOME} />} />
        <Route path={`${TECHNICIAN_HOME}/work-orders`} element={<KeepQuery to={TECHNICIAN_HOME} />} />
        <Route path={`${TECHNICIAN_HOME}/orders`} element={<KeepQuery to={TECHNICIAN_HOME} />} />

        {/* ── Customer portal: /customer/* ──
            Its own session (CustomerAuthContext); CustomerLayout sends a signed-out
            visitor to the sign-in page. A staff session open in the same browser
            does not take these pages over: the sign-in pages say it is open.
            Not the staff pages /customers, /customer-feedback, /customer-experience. */}
        <Route path={PORTAL.login} element={<><StaffSessionNote /><CustomerLogin /></>} />
        <Route path={PORTAL.register} element={<><StaffSessionNote /><CustomerRegister /></>} />
        <Route path={PORTAL.resetPassword} element={<CustomerResetPassword />} />
        <Route path={PORTAL.setPassword} element={<CustomerResetPassword />} />
        <Route path={PORTAL.verifyEmail} element={<CustomerVerifyEmail />} />
        <Route path={PORTAL.home} element={<CustomerLayout><CustomerDashboard /></CustomerLayout>} />
        <Route path={PORTAL.jobs} element={<CustomerLayout><CustomerWorkOrders /></CustomerLayout>} />
        <Route path={PORTAL.job(':id')} element={<CustomerLayout><CustomerWorkOrderDetail /></CustomerLayout>} />
        <Route path={PORTAL.vehicles} element={<CustomerLayout><CustomerVehicles /></CustomerLayout>} />
        <Route path={PORTAL.invoices} element={<CustomerLayout><CustomerInvoices /></CustomerLayout>} />
        <Route path={PORTAL.settings} element={<CustomerLayout><CustomerSettings /></CustomerLayout>} />
        {/* /customer, old page names under /customer/*, and the old /merchant/* and
            /portal/* addresses (links in e-mails already sent) → the matching page,
            query string kept. An unknown page goes Home, whose sign-in guard sends a
            signed-out visitor to /customer/login. */}
        <Route path={`${PORTAL_BASE}/*`} element={<PortalRedirect />} />
        <Route path="/portal/*" element={<PortalRedirect />} />
        <Route path="/merchant/*" element={<PortalRedirect />} />

        {/* ── Super admin ── */}
        <Route path="/super-admin/login" element={<SuperAdminLogin />} />
        <Route path="/super-admin" element={<SuperAdminLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<SuperAdminDashboard />} />
          <Route path="workshops" element={<SuperAdminWorkshops />} />
          <Route path="workshops/:id" element={<SuperAdminWorkshopDetail />} />
          <Route path="users" element={<SuperAdminUsers />} />
          <Route path="subscriptions" element={<SuperAdminSubscriptions />} />
          <Route path="revenue" element={<SuperAdminRevenue />} />
          <Route path="analytics" element={<SuperAdminAnalytics />} />
          <Route path="announcements" element={<SuperAdminAnnouncements />} />
          <Route path="audit-log" element={<SuperAdminAuditLog />} />
          <Route path="backups" element={<SuperAdminBackups />} />
          <Route path="barcodes" element={<SuperAdminBarcodes />} />
          <Route path="branding" element={<SuperAdminBranding />} />
          <Route path="bulk-operations" element={<SuperAdminBulkOps />} />
          <Route path="email-templates" element={<SuperAdminEmailTemplates />} />
          <Route path="landing-contacts" element={<SuperAdminLandingContacts />} />
          <Route path="legal-pages" element={<SuperAdminLegalPages />} />
          <Route path="modules" element={<SuperAdminModules />} />
          <Route path="onboarding" element={<SuperAdminOnboarding />} />
          <Route path="settings" element={<SuperAdminSettings />} />
          <Route path="system-health" element={<SuperAdminSystemHealth />} />
          <Route path="tickets" element={<SuperAdminTickets />} />
          <Route path="vacancies" element={<SuperAdminVacancies />} />
        </Route>

        {/* ── Defaults: the home page of whoever is signed in (staff → /dashboard,
            technician → /mechanic, customer → /customer/dashboard, nobody → /login) ── */}
        <Route path="/" element={<RoleHome />} />
        <Route path="*" element={<RoleHome />} />
      </Routes>
    </Suspense>
  );
}
