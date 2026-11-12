/**
 * CustomersTabs — the Customers module's tabs: Enquiries and Customers.
 *
 * Client point 12 (meeting 3 Nov 2026): "Combine enquiries and customers
 * within a single module." Each tab is still its own page at its own
 * address (/enquiries, /customers), so links from Bookings, Tasks, Vehicles
 * and notifications keep working, and each keeps its own menu key in the
 * role's module list ('enquiries', 'customers'): a role with only one of
 * them sees only that tab. Layout shows one "Customers" menu entry for both
 * (its `tabs`), which opens the first tab the role has.
 */
import { useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Megaphone, User } from 'iconoir-react';
import { AuthContext } from '../context/AuthContext';
import { hasModule } from '../lib/modules';

/** The module's tabs, in order. */
export const CUSTOMER_TABS = Object.freeze([
  { path: '/enquiries', moduleKey: 'enquiries', i18nKey: 'common.enquiries', labelDefault: 'Enquiries', Icon: Megaphone },
  { path: '/customers', moduleKey: 'customers', i18nKey: 'common.customers', labelDefault: 'Customers', Icon: User },
]);

export default function CustomersTabs() {
  const { user } = useContext(AuthContext) || {};
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const tabs = CUSTOMER_TABS.filter(tab => hasModule(user, tab.moduleKey));
  if (!tabs.length) return null;
  return (
    <nav aria-label={t('customers.tabs.label', 'Customers module')}
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', paddingBottom: 10, marginBottom: 18 }}>
      {tabs.map(({ path, i18nKey, labelDefault, Icon }) => {
        const on = pathname === path;
        return (
          <Link key={path} to={path} aria-current={on ? 'page' : undefined}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 9,
              border: `1px solid ${on ? '#f97316' : 'transparent'}`, background: on ? '#fff7ed' : 'transparent',
              color: on ? '#f97316' : '#64748b', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            <Icon width={16} height={16} /> {t(i18nKey, labelDefault)}
          </Link>
        );
      })}
    </nav>
  );
}
