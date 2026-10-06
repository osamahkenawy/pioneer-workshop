/**
 * Car damage diagram — the clickable part of the Vehicle Inspection Form.
 *
 * Five photographic views (top, both sides, front, rear). Pick a damage code
 * from the legend, click anywhere on a view, and a coloured marker is dropped
 * on the spot.
 *
 * Marker coordinates are stored NORMALISED (x/y between 0 and 1, relative to
 * the view's container box), so a form filled in on a tablet still renders
 * correctly on desktop, in print, or at any zoom.
 */
import topRoofImg     from '../inspection/top-roof.png';
import driverSideImg  from '../inspection/driver-side.png';
import passengerSideImg from '../inspection/passenger-side.png';
import frontImg       from '../inspection/front.png';
import rearImg        from '../inspection/rear.png';

/* Damage legend, from the printed walk-around sheet. Two deliberate fixes:
   the paper form used "GC" for BOTH Glass Chip and Gouges/Crease, which makes
   a marker ambiguous once it's on the diagram — Gouges/Crease is "GO" here.
   "Pant Chip" on the sheet is a typo for Paint Chip. */
export const DAMAGE_CODES = {
  SH: 'Swirls/Holograms',
  WS: 'Water Spots',
  OX: 'Oxidation',
  CF: 'Clearcoat Failure',
  DS: 'Deep Scratch',
  BD: 'Bird Dropping',
  RP: 'Rough Paint',
  UD: 'Unknown Defect',
  PT: 'Paint Transfer',
  PC: 'Paint Chip',
  GS: 'Glass Scratch',
  GC: 'Glass Chip',
  DD: 'Dents/Dings',
  SS: 'Side Swipe',
  CR: 'Curb Rash',
  WD: 'Wheel Damage',
  GO: 'Gouges/Crease',
  LM: 'Loose Molding',
};

// Per-code marker colour, so a glance at the diagram tells you what kind of
// damage is where without having to hover each pill.
export const DAMAGE_COLORS = {
  SH: '#6757e8', WS: '#4f87f7', OX: '#17b890', CF: '#ff8a4c',
  DS: '#ef476f', BD: '#8f62d6', RP: '#26b9d5', UD: '#f3b63f',
  PT: '#6d92ea', PC: '#9e62dc', GS: '#67bd52', GC: '#7bcf86',
  DD: '#ff825c', SS: '#6678e8', CR: '#f45f7c', WD: '#4d91e8',
  GO: '#b77947', LM: '#94a3b8',
};

const NAVY = '#153d78';

/* ── The five views. Grid layout mirrors the printed inspection sheet:
   row 1: top | driver-left | passenger-right | front
   row 2: rear (spans column 1 only)
   Keys stay as top / left / right / front / rear to preserve marker
   coordinates already stored against them. ────────────────────────── */
const VIEWS = [
  { key: 'top',   label: 'TOP / ROOF',              img: topRoofImg,       glyph: '⌂', row: 1, col: 1 },
  { key: 'left',  label: 'DRIVER SIDE (LEFT)',      img: driverSideImg,    glyph: '◫', row: 1, col: 2 },
  { key: 'right', label: 'PASSENGER SIDE (RIGHT)',  img: passengerSideImg, glyph: '◫', row: 1, col: 3 },
  { key: 'front', label: 'FRONT',                   img: frontImg,         glyph: '▣', row: 1, col: 4 },
  { key: 'rear',  label: 'REAR',                    img: rearImg,          glyph: '▣', row: 2, col: 1 },
];

/**
 * @param {Array}   marks          [{id, view, code, x, y, note}]
 * @param {string}  activeCode     currently selected legend code ('' = none)
 * @param {string}  selectedMarkId highlighted marker
 * @param {Func}    onAddMark      (view, x, y) — omit to make the diagram read-only
 * @param {Func}    onSelectMark   (markId)
 * @param {boolean} compact        stack views in a single column (mobile / preview)
 */
export default function CarDamageDiagram({
  marks = [], activeCode = '', selectedMarkId = '',
  onAddMark, onSelectMark, compact = false,
}) {
  const readOnly = typeof onAddMark !== 'function';

  const handleClick = (view) => (e) => {
    if (readOnly || !activeCode) return;
    // Clicks on an existing marker bubble up here after their own stopPropagation,
    // so no extra guard is needed — those handlers already return early.
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    onAddMark(view.key, x, y);
  };

  const gridStyle = compact
    ? { display: 'grid', gridTemplateColumns: '1fr', gap: 14 }
    : { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14, alignItems: 'start' };

  return (
    <div style={gridStyle}>
      {VIEWS.map(view => {
        const viewMarks = marks.filter(m => m.view === view.key);
        // In the four-column grid the rear view sits alone on the second row
        // (matching the printed sheet), so pin it to column 1.
        const cellStyle = !compact && view.key === 'rear'
          ? { gridColumn: '1 / 2' } : undefined;
        return (
          <div
            key={view.key}
            className="vi-view-panel"
            style={{
              background: '#fff',
              border: '1px solid #d9e4f1',
              borderRadius: 15,
              overflow: 'hidden',
              ...cellStyle,
            }}
          >
            {/* header — navy circular glyph + label, matching the printed sheet */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 14px',
              background: 'linear-gradient(180deg,#f7fbff 0%,#edf5ff 100%)',
              borderBottom: '1px solid #e7eef7',
              fontWeight: 800, fontSize: 12, letterSpacing: 0.3, color: NAVY,
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: NAVY, color: '#fff',
                display: 'grid', placeItems: 'center',
                fontSize: 14, flex: '0 0 auto',
              }}>{view.glyph}</div>
              <span style={{ flex: 1 }}>{view.label}</span>
              {viewMarks.length > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 800, color: '#dc2626',
                  background: '#fee2e2', padding: '2px 8px', borderRadius: 10,
                }}>{viewMarks.length}</span>
              )}
            </div>

            {/* clickable image area — markers are absolute-positioned overlays */}
            <div
              onClick={handleClick(view)}
              style={{
                position: 'relative',
                height: view.key === 'rear' ? 225 : 260,
                background: 'radial-gradient(circle at 50% 45%, rgba(46,125,205,.08), transparent 42%), #fff',
                cursor: !readOnly && activeCode ? 'crosshair' : 'default',
                touchAction: 'manipulation',
                userSelect: 'none',
              }}
            >
              <img
                src={view.img}
                alt={view.label}
                draggable={false}
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%',
                  objectFit: 'contain',
                  padding: 16,
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                }}
              />
              {viewMarks.map(m => {
                const on = m.id === selectedMarkId;
                const bg = DAMAGE_COLORS[m.code] || '#dc2626';
                return (
                  <button
                    key={m.id}
                    type="button"
                    title={DAMAGE_CODES[m.code] || m.code}
                    onClick={(e) => { e.stopPropagation(); onSelectMark && onSelectMark(m.id); }}
                    style={{
                      position: 'absolute',
                      left: `${m.x * 100}%`,
                      top: `${m.y * 100}%`,
                      transform: 'translate(-50%, -50%)',
                      width: on ? 28 : 24, height: on ? 28 : 24,
                      borderRadius: '50%',
                      background: bg,
                      color: '#fff',
                      fontSize: 10, fontWeight: 800, lineHeight: 1,
                      border: `${on ? 3 : 2}px solid #fff`,
                      boxShadow: on
                        ? '0 0 0 2px rgba(220,38,38,.6), 0 2px 8px rgba(0,0,0,.25)'
                        : '0 2px 8px rgba(0,0,0,.25)',
                      cursor: onSelectMark ? 'pointer' : 'default',
                      padding: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      zIndex: 3,
                    }}
                  >
                    {m.code}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
