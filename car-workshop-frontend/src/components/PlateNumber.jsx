/**
 * PlateNumber.jsx — Dynamic license-plate display.
 * React port of the Vue <PlateNumber /> component (UAE-style plate).
 *
 * Parses a plate string into up to three parts (code · state · number):
 *   - "A-DXB-12345"  → code=A, state=DXB, number=12345  (dash separated)
 *   - "A DXB 12345"  → code=A, state=DXB, number=12345  (space separated)
 *   - "A 62102"      → code=A, number=62102
 *   - "F25037"       → code=F, number=25037  (letter prefix split from digits)
 *   - "12345"        → number=12345 only
 *
 * The plate frame / top-band colour is driven by `plateColor` (defaults red).
 *
 * Props:
 *   plateNumber {string}  raw plate string
 *   plateColor  {string}  CSS colour for the frame + top band (optional)
 *   flat        {bool}    remove elevation/shadow (optional)
 *   size        {'sm'|'md'|'lg'}  visual scale (default 'md')
 */
import './PlateNumber.css';

function parsePlate(raw) {
  const empty = { code: '', state: '', number: '' };
  if (!raw) return empty;

  const value = String(raw).trim();
  if (!value) return empty;

  // Split on dash or whitespace, drop empty segments
  const parts = value
    .split(/[-\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return empty;

  if (parts.length === 1) {
    const token = parts[0].toUpperCase();
    // Split a letter prefix from trailing digits: "F25037" → code=F, number=25037
    const m = token.match(/^([A-Z]+)[\s-]*(\d+)$/);
    if (m) return { code: m[1], state: '', number: m[2] };
    return { code: '', state: '', number: token };
  }

  if (parts.length === 2) return { code: parts[0].toUpperCase(), state: '', number: parts[1].toUpperCase() };

  // 3+ parts: first = code, last = number, middle = state (joined)
  return {
    code: parts[0].toUpperCase(),
    state: parts.slice(1, -1).join(' ').toUpperCase(),
    number: parts[parts.length - 1].toUpperCase(),
  };
}

export default function PlateNumber({ plateNumber, plateColor, flat = false, size = 'md' }) {
  const { code, state, number } = parsePlate(plateNumber);

  if (!code && !state && !number) return null;

  const frameColor = plateColor || '#dc2626';
  const hasTop = Boolean(code || state);

  return (
    <div
      className={`plate-number plate-${size} ${flat ? '' : 'plate-elevated'}`}
      style={{ '--plate-color': frameColor }}
      title={plateNumber}
    >
      {hasTop && (
        <div className="plate-number--top">
          <span className="plate-code">{code || '\u00A0'}</span>
          <span className="plate-country">UAE</span>
          <span className="plate-state">{state || '\u00A0'}</span>
        </div>
      )}
      <div className="plate-number--number">{number || '\u00A0'}</div>
    </div>
  );
}

