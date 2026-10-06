/**
 * escapeHtml.js — HTML-escaping for the few places that must build markup as a
 * string.
 *
 * React escapes text automatically, so almost nothing in this app needs this.
 * The exceptions are Leaflet, whose popup/divIcon APIs take HTML strings, and
 * the print view, which writes a document. Those were interpolating stored
 * values (customer name, address, mechanic name and phone) straight into
 * markup, which turned any stored script into execution — on the public
 * tracking page, for any visitor holding the link.
 *
 * Use escapeHtml() on every interpolated value in such a template. Prefer
 * rendering React elements over building strings wherever the API allows it.
 */

const MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
};

/**
 * Escape a value for interpolation into an HTML string.
 * Nullish becomes an empty string so callers can drop `|| ''` guards.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`=]/g, ch => MAP[ch]);
}

/**
 * Tagged template that escapes every interpolated value:
 *   safeHtml`<div>${untrusted}</div>`
 * The literal parts are trusted (they are in the source); only the values are
 * escaped, so it is impossible to forget one.
 */
export function safeHtml(strings, ...values) {
  return strings.reduce(
    (out, str, i) => out + str + (i < values.length ? escapeHtml(values[i]) : ''),
    ''
  );
}

export default escapeHtml;
