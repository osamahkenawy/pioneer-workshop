/**
 * The Customers module's pages and their menu keys.
 *
 * Client point 12 (meeting 3 Nov 2026) and feedback of 18 Nov 2026, point 2:
 * enquiries and customers are ONE module. There are no tabs any more: the
 * Customers page lists everyone with their enquiry (stage filter: open
 * enquiries, follow-ups due), and one form captures a customer with their
 * enquiry. /enquiries only redirects there (pages/Enquiries.jsx), so links
 * from Bookings, Tasks and notifications keep working.
 *
 * Both menu keys stay ('customers', 'enquiries'): a role with either sees the
 * one "Customers" entry (Layout), and Protected lets an 'enquiries'-only role
 * open the Customers page.
 */

/** The module's pages, in order (Layout's menu entry and route guard). */
export const CUSTOMER_TABS = Object.freeze([
  { path: '/customers', moduleKey: 'customers', i18nKey: 'common.customers', labelDefault: 'Customers' },
  { path: '/enquiries', moduleKey: 'enquiries', i18nKey: 'common.enquiries', labelDefault: 'Enquiries' },
]);
