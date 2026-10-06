import { Helmet } from 'react-helmet-async';

/**
 * SEO Component for Pioneer Car Service Center
 * Provides comprehensive SEO meta tags for all pages
 * Pioneer Car Service Center
 * 
 * Only the landing/login page is indexed by Google.
 * All other pages are private application pages (noindex).
 */

const defaultSEO = {
  siteName: 'Pioneer',
  siteUrl: 'https://app.pioneercarservice.com',
  defaultTitle: 'Pioneer - Smart Car Workshop Management System | Pioneer Car Service Center',
  defaultDescription: 'Pioneer is a powerful car workshop management platform for auto repair shops and service centers. Job scheduling, mechanic assignment, work orders, invoicing, parts inventory, and multi-workshop support from Pioneer Car Service Center.',
  defaultImage: 'https://app.pioneercarservice.com/assets/images/pioneer-workshop-dashboard.png',
  twitterHandle: '@pioneercarservice',
  author: 'Pioneer Car Service Center',
  keywords: 'Pioneer, Pioneer Car Service Center, car workshop management, auto repair software, garage management, mechanic management, work order management, vehicle service tracking, parts inventory, car service invoicing, workshop scheduling, fleet maintenance'
};

/**
 * SEO Page configurations for Pioneer Car Service Center
 * Only login/landing page is public. All others are noindex.
 */
export const seoConfig = {
  // ── PUBLIC PAGES ──────────────────────────────────────
  landing: {
    title: 'Pioneer - Smart Delivery Management System | Pioneer Car Service Center',
    description: 'Streamline your delivery operations with Pioneer. Real-time tracking, automated job-assignment, mechanic management, COD handling, and powerful analytics for courier and logistics businesses in the UAE. Start today.',
    keywords: 'Pioneer, Pioneer Car Service Center, delivery management system, courier software, last mile delivery UAE, delivery tracking, job-assignment management, mechanic management, COD management, logistics software Dubai, fleet management, service tracking, delivery analytics, multi-workshop delivery, e-commerce delivery, same day delivery, route optimization, delivery automation',
    image: 'https://app.pioneercarservice.com/assets/images/pioneer-delivery-dashboard.png',
    isPublic: true
  },

  // ── AUTH PAGES ────────────────────────────────────────
  login: {
    title: 'Login - Pioneer Delivery Management',
    description: 'Sign in to your Pioneer delivery management dashboard.',
    isPublic: false
  },
  register: {
    title: 'Register - Pioneer Delivery Management',
    description: 'Create your Pioneer account and start managing deliveries.',
    isPublic: false
  },

  // ── MAIN ──────────────────────────────────────────────
  dashboard: {
    title: 'Dashboard - Pioneer',
    description: 'Your delivery operations dashboard with live metrics, order stats, and mechanic overview.',
    isPublic: false
  },

  // ── OPERATIONS ────────────────────────────────────────
  orders: {
    title: 'WorkOrders - Pioneer',
    description: 'Manage all delivery orders — create, track, assign, and update service statuses.',
    isPublic: false
  },
  orderDetail: {
    title: 'WorkOrder Details - Pioneer',
    description: 'View full order details including timeline, mechanic assignment, and delivery proof.',
    isPublic: false
  },
  customers: {
    title: 'Customers - Pioneer',
    description: 'Manage your customer accounts, addresses, and order history.',
    isPublic: false
  },
  mechanics: {
    title: 'Mechanics - Pioneer',
    description: 'Manage mechanics — availability, assignments, performance, and ratings.',
    isPublic: false
  },
  'job-assignment': {
    title: 'Job Assignment Board - Car Workshop',
    description: 'Real-time job-assignment board for assigning work orders to available mechanics and service bays.',
    isPublic: false
  },
  liveMap: {
    title: 'Live Map - Pioneer',
    description: 'Real-time GPS tracking of all active mechanics and deliveries on a live map.',
    isPublic: false
  },
  tracking: {
    title: 'Service Tracking - Pioneer',
    description: 'Track any service by tracking number or barcode.',
    isPublic: false
  },
  barcode: {
    title: 'Barcode Scanner - Pioneer',
    description: 'Scan and process delivery barcodes for fast order lookup and status updates.',
    isPublic: false
  },
  bulkImport: {
    title: 'Bulk Import - Pioneer',
    description: 'Import orders in bulk via CSV or Excel for batch processing.',
    isPublic: false
  },
  returns: {
    title: 'WarrantyClaims - Pioneer',
    description: 'Manage return services and reverse logistics.',
    isPublic: false
  },

  // ── MECHANIC TOOLS ──────────────────────────────────────
  mechanicWorkOrders: {
    title: 'My Deliveries - Pioneer',
    description: 'View and manage your assigned delivery orders.',
    isPublic: false
  },
  mechanicScan: {
    title: 'Scan Service - Pioneer',
    description: 'Scan barcodes to update service status on the go.',
    isPublic: false
  },

  // ── CONFIG ────────────────────────────────────────────
  service_bays: {
    title: 'Delivery ServiceBays - Pioneer',
    description: 'Configure delivery service_bays, areas, and coverage regions.',
    isPublic: false
  },
  pricing: {
    title: 'ServicePricing Configuration - Pioneer',
    description: 'Set up delivery pricing rules, bay-based rates, and weight tiers.',
    isPublic: false
  },

  // ── FINANCE ───────────────────────────────────────────
  wallet: {
    title: 'Wallet - Pioneer',
    description: 'Manage wallet balances, top-ups, and transaction history.',
    isPublic: false
  },
  invoices: {
    title: 'Invoices - Pioneer',
    description: 'View and manage delivery invoices and billing.',
    isPublic: false
  },
  cod: {
    title: 'COD Management - Pioneer',
    description: 'Track cash-on-delivery collections, settlements, and mechanic balances.',
    isPublic: false
  },

  // ── ANALYTICS ─────────────────────────────────────────
  reports: {
    title: 'Reports - Pioneer',
    description: 'Delivery analytics — order volume, success rate, mechanic performance, and revenue reports.',
    isPublic: false
  },
  performance: {
    title: 'Performance - Pioneer',
    description: 'Mechanic and delivery performance metrics and leaderboards.',
    isPublic: false
  },

  // ── SYSTEM ────────────────────────────────────────────
  notifications: {
    title: 'Notifications - Pioneer',
    description: 'View system notifications, alerts, and updates.',
    isPublic: false
  },
  settings: {
    title: 'Settings - Pioneer',
    description: 'Configure your account, company profile, and system preferences.',
    isPublic: false
  },
  integrations: {
    title: 'Integrations - Pioneer',
    description: 'Connect Pioneer with e-commerce platforms, ERPs, and third-party services.',
    isPublic: false
  },

  // ── SUPER ADMIN ───────────────────────────────────────
  superAdminLogin: {
    title: 'Admin Login - Pioneer',
    description: 'Super admin login.',
    isPublic: false
  },
  superAdminDashboard: {
    title: 'Admin Dashboard - Pioneer',
    description: 'Super admin platform overview and workshop management.',
    isPublic: false
  },
  superAdminWorkshops: {
    title: 'Workshops - Pioneer',
    description: 'Manage workshop accounts across the platform.',
    isPublic: false
  },
  superAdminWorkshopDetail: {
    title: 'Workshop Detail - Pioneer',
    description: 'View and manage individual workshop details.',
    isPublic: false
  }
};

/**
 * SEO Component
 * @param {Object} props
 * @param {string} props.page - Page identifier from seoConfig
 * @param {string} props.title - Custom title override
 * @param {string} props.description - Custom description override
 * @param {boolean} props.noindex - Force noindex
 */
export default function SEO({
  page,
  title,
  description,
  keywords,
  image,
  url,
  noindex,
  structuredData
}) {
  const pageConfig = seoConfig[page] || {};
  
  const finalTitle = title || pageConfig.title || defaultSEO.defaultTitle;
  const finalDescription = description || pageConfig.description || defaultSEO.defaultDescription;
  const finalKeywords = keywords || pageConfig.keywords || defaultSEO.keywords;
  const finalImage = image || pageConfig.image || defaultSEO.defaultImage;
  const finalUrl = url || `${defaultSEO.siteUrl}${window.location.pathname}`;
  
  // Only landing page is indexed; everything else is noindex
  const shouldNoindex = noindex !== undefined ? noindex : (pageConfig.isPublic === false);
  const robotsContent = shouldNoindex ? 'noindex, nofollow' : 'index, follow';

  return (
    <Helmet>
      <title>{finalTitle}</title>
      <meta name="description" content={finalDescription} />
      <meta name="keywords" content={finalKeywords} />
      <meta name="author" content={defaultSEO.author} />
      <meta name="robots" content={robotsContent} />
      
      <link rel="canonical" href={finalUrl} />
      
      <meta property="og:type" content="website" />
      <meta property="og:url" content={finalUrl} />
      <meta property="og:title" content={finalTitle} />
      <meta property="og:description" content={finalDescription} />
      <meta property="og:image" content={finalImage} />
      <meta property="og:site_name" content={defaultSEO.siteName} />
      
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={finalTitle} />
      <meta name="twitter:description" content={finalDescription} />
      <meta name="twitter:image" content={finalImage} />
      <meta name="twitter:site" content={defaultSEO.twitterHandle} />
      
      {structuredData && (
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      )}
    </Helmet>
  );
}
