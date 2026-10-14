/**
 * The workshop's logo for customer-facing pages (status link, portal).
 * Uploaded logos are served through /api/file (logos only, server.js); the
 * Pioneer mark is the fallback.
 */
export const FALLBACK_LOGO = '/assets/images/logos/pioneer_with_bg.jpg';

export function logoSrc(url) {
  if (!url) return FALLBACK_LOGO;
  if (/^https?:\/\//.test(url)) return url;
  return `/api/file?path=${encodeURIComponent(String(url).replace(/^\/?uploads\//, ''))}`;
}

/** onError handler: fall back to the Pioneer mark once. */
export function onLogoError(e) {
  if (!e.currentTarget.src.endsWith(FALLBACK_LOGO)) e.currentTarget.src = FALLBACK_LOGO;
}
