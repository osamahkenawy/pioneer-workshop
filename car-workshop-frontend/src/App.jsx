import { Suspense, lazy, useContext } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthContext } from './context/AuthContext';
import Layout from './components/Layout';
import Loader from './components/Loader';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';

/* ── Staff app (lazy) ─────────────────────────────────────── */
const WorkOrders        = lazy(() => import('./pages/WorkOrders'));
const WorkOrderDetail   = lazy(() => import('./pages/WorkOrderDetail'));
const VehicleInspection = lazy(() => import('./pages/VehicleInspection'));
const TeamLeader = lazy(() => import('./pages/TeamLeader'));
const FleetIntake = lazy(() => import('./pages/FleetIntake'));
const FleetIntakeQueue = lazy(() => import('./pages/FleetIntakeQueue'));
const Customers         = lazy(() => import('./pages/Customers'));
const Enquiries         = lazy(() => import('./pages/Enquiries'));
const CustomerFeedback  = lazy(() => import('./pages/CustomerFeedback'));
const CustomerSurveyPublic = lazy(() => import('./pages/CustomerSurveyPublic'));
const EstimateApproval = lazy(() => import('./pages/EstimateApproval'));
const Vehicles          = lazy(() => import('./pages/Vehicles'));
const Parts             = lazy(() => import('./pages/Parts'));
const Mechanics         = lazy(() => import('./pages/Mechanics'));
const JobAssignment     = lazy(() => import('./pages/JobAssignment'));
const ServiceTracking   = lazy(() => import('./pages/ServiceTracking'));
const WarrantyClaims    = lazy(() => import('./pages/WarrantyClaims'));
const ServiceBays       = lazy(() => import('./pages/ServiceBays'));
const ServicePricing    = lazy(() => import('./pages/ServicePricing'));
const Inventory         = lazy(() => import('./pages/Inventory'));
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

/* ── Mechanic app ─────────────────────────────────────────── */
const MechanicDashboard = lazy(() => import('./pages/MechanicDashboard'));
const MechanicHome      = lazy(() => import('./pages/MechanicHome'));
const MechanicScan      = lazy(() => import('./pages/MechanicScan'));

/* ── Public / auth ────────────────────────────────────────── */
const RegisterPage        = lazy(() => import('./pages/RegisterPage'));
const SignupPage          = lazy(() => import('./pages/SignupPage'));
const ResetPassword       = lazy(() => import('./pages/ResetPassword'));
const ServiceStatusPublic = lazy(() => import('./pages/ServiceStatusPublic'));

/* ── CRM phase 1 ─────────────────────────────────────────── */
const Customer360  = lazy(() => import('./pages/Customer360'));
const CrmReminders = lazy(() => import('./pages/CrmReminders'));
const CrmTasks     = lazy(() => import('./pages/CrmTasks'));

/* ── Customer portal ("merchant" area) ────────────────────── */
const CustomerLayout          = lazy(() => import('./pages/CustomerPortal/CustomerLayout'));
const CustomerLogin           = lazy(() => import('./pages/CustomerPortal/CustomerLogin'));
const CustomerRegister        = lazy(() => import('./pages/CustomerPortal/CustomerRegister'));
const CustomerResetPassword   = lazy(() => import('./pages/CustomerPortal/CustomerResetPassword'));
const CustomerVerifyEmail     = lazy(() => import('./pages/CustomerPortal/CustomerVerifyEmail'));
const CustomerDashboard       = lazy(() => import('./pages/CustomerPortal/CustomerDashboard'));
const CustomerWorkOrders      = lazy(() => import('./pages/CustomerPortal/CustomerWorkOrders'));
const CustomerWorkOrderDetail = lazy(() => import('./pages/CustomerPortal/CustomerWorkOrderDetail'));
const CustomerCreateOrder     = lazy(() => import('./pages/CustomerPortal/CustomerCreateOrder'));
const CustomerAddresses       = lazy(() => import('./pages/CustomerPortal/CustomerAddresses'));
const CustomerInvoices        = lazy(() => import('./pages/CustomerPortal/CustomerInvoices'));
const CustomerWallet          = lazy(() => import('./pages/CustomerPortal/CustomerWallet'));
const CustomerSettings        = lazy(() => import('./pages/CustomerPortal/CustomerSettings'));
const CustomerTracking        = lazy(() => import('./pages/CustomerPortal/CustomerTracking'));

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

function Protected({ children }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
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
        {/* Public customer feedback survey — personalised link or anonymous / QR */}
        <Route path="/survey" element={<CustomerSurveyPublic />} />
        <Route path="/survey/:token" element={<CustomerSurveyPublic />} />
        {/* Public estimate approval — link emailed from POST /estimates/:id/send */}
        <Route path="/estimate-approval/:token" element={<EstimateApproval />} />
        {/* Fleet coordinator intake — no login; the token names the fleet account */}
        <Route path="/fleet-intake/:token" element={<FleetIntake />} />

        {/* ── Staff app ── */}
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
        <Route path="/service-tracking" element={<Protected><ServiceTracking /></Protected>} />
        <Route path="/warranty-claims" element={<Protected><WarrantyClaims /></Protected>} />
        {/* CRM. /crm/customers with no id shows a search; with an id, the 360 view. */}
        <Route path="/crm/customers" element={<Protected><Customer360 /></Protected>} />
        <Route path="/crm/customers/:id" element={<Protected><Customer360 /></Protected>} />
        <Route path="/crm/reminders" element={<Protected><CrmReminders /></Protected>} />
        <Route path="/crm/tasks" element={<Protected><CrmTasks /></Protected>} />
        <Route path="/service-bays" element={<Protected><ServiceBays /></Protected>} />
        <Route path="/service-pricing" element={<Protected><ServicePricing /></Protected>} />
        <Route path="/inventory" element={<Protected><Inventory /></Protected>} />
        <Route path="/mechanic-earnings" element={<Protected><MechanicEarnings /></Protected>} />
        <Route path="/wallet" element={<Protected><Wallet /></Protected>} />
        <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
        <Route path="/cash-payments" element={<Protected><CashPayments /></Protected>} />
        <Route path="/reports" element={<Protected><Reports /></Protected>} />
        <Route path="/customer-experience" element={<Protected><CustomerExperience /></Protected>} />
        <Route path="/complaints" element={<Protected><Complaints /></Protected>} />
        <Route path="/performance" element={<Protected><Performance /></Protected>} />
        <Route path="/technician-kpi" element={<Protected><TechnicianKpi /></Protected>} />
        <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />
        <Route path="/api-keys" element={<Protected><Integrations /></Protected>} />

        {/* ── Mechanic app ── */}
        <Route path="/mechanic/dashboard" element={<Protected><MechanicHome /></Protected>} />
        <Route path="/mechanic/work-orders" element={<Protected><MechanicDashboard /></Protected>} />
        <Route path="/mechanic/scan" element={<Protected><MechanicScan /></Protected>} />

        {/* ── Customer portal ── */}
        <Route path="/merchant/login" element={<CustomerLogin />} />
        <Route path="/merchant/register" element={<CustomerRegister />} />
        <Route path="/merchant/reset-password" element={<CustomerResetPassword />} />
        <Route path="/merchant/verify-email" element={<CustomerVerifyEmail />} />
        <Route path="/merchant/dashboard" element={<CustomerLayout><CustomerDashboard /></CustomerLayout>} />
        <Route path="/merchant/work-orders" element={<CustomerLayout><CustomerWorkOrders /></CustomerLayout>} />
        <Route path="/merchant/work-orders/:id" element={<CustomerLayout><CustomerWorkOrderDetail /></CustomerLayout>} />
        <Route path="/merchant/create-order" element={<CustomerLayout><CustomerCreateOrder /></CustomerLayout>} />
        <Route path="/merchant/addresses" element={<CustomerLayout><CustomerAddresses /></CustomerLayout>} />
        <Route path="/merchant/invoices" element={<CustomerLayout><CustomerInvoices /></CustomerLayout>} />
        <Route path="/merchant/wallet" element={<CustomerLayout><CustomerWallet /></CustomerLayout>} />
        <Route path="/merchant/settings" element={<CustomerLayout><CustomerSettings /></CustomerLayout>} />
        <Route path="/merchant/service-status" element={<CustomerLayout><CustomerTracking /></CustomerLayout>} />
        <Route path="/merchant" element={<Navigate to="/merchant/dashboard" replace />} />

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

        {/* ── Defaults ── */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
