/**
 * currency.js — currency formatting helpers.
 * The active workshop currency is cached from AuthContext (workshop.currency).
 */
export function getWorkshopCurrency() {
  try {
    const w = JSON.parse(localStorage.getItem('auth_workshop'));
    return w?.currency || 'AED';
  } catch {
    return 'AED';
  }
}

export function fmtCurrency(amount, currency, locale) {
  const cur = currency || getWorkshopCurrency();
  const num = Number(amount || 0);
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${cur} ${num.toFixed(2)}`;
  }
}

/**
 * Whole-currency formatting for headline figures (KPI cards, chart axes).
 *
 * A KPI card is only ~120px wide once the icon and padding are accounted for,
 * and "AED 238,951.05" at the headline font size does not fit — it was being
 * clipped mid-number. Fils are noise at that magnitude anyway, so headline
 * figures drop them; tables and invoices keep fmtCurrency's 2dp.
 */
export function fmtCurrencyCompact(amount, currency, locale) {
  const cur = currency || getWorkshopCurrency();
  const num = Number(amount || 0);
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `${cur} ${Math.round(num).toLocaleString()}`;
  }
}

export default fmtCurrency;
