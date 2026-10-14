/**
 * Car damage diagram — the clickable part of the Vehicle Inspection Form.
 *
 * Five photographic views (top, both sides, front, rear). Pick a damage code
 * from the legend, click anywhere on the car, and a coloured marker is dropped
 * on the spot.
 *
 * Marker coordinates are stored NORMALISED (x/y between 0 and 1). New markers
 * carry coord: 'img' and are relative to the car picture itself, which is
 * drawn fitted and centred in a fixed-height box — so a marker stays on the
 * same spot of the car at any width: the staff form, its print-out and the
 * customer's page. Markers saved before that have no `coord` and are relative
 * to the whole box; they are drawn exactly as before. The geometry is in
 * lib/inspectionMarks.js.
 */
import { useTranslation } from 'react-i18next';
import topRoofImg     from '../inspection/top-roof.png';
import driverSideImg  from '../inspection/driver-side.png';
import passengerSideImg from '../inspection/passenger-side.png';
import frontImg       from '../inspection/front.png';
import rearImg        from '../inspection/rear.png';
import {
  IMAGE_COORD, VIEW_BOX_HEIGHT, isImageMark, pointOnRect, stageStyle,
} from '../lib/inspectionMarks';
import './CarDamageDiagram.css';

/* Damage legend, from the printed walk-around sheet. Two deliberate fixes:
   the paper form used "GC" for BOTH Glass Chip and Gouges/Crease, which makes
   a marker ambiguous once it's on the diagram — Gouges/Crease is "GO" here.
   "Pant Chip" on the sheet is a typo for Paint Chip. English defaults; the
   words on screen come from damageLabel(). */
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

/* English names of the views; the words on screen come from viewLabel(). */
export const VIEW_NAMES = {
  top: 'Top / roof', left: 'Driver side (left)', right: 'Passenger side (right)', front: 'Front', rear: 'Rear',
};

/** A damage code's name, translated (inspection.code.*). */
export const damageLabel = (t, code, fallback) =>
  (t ? t(`inspection.code.${code}`, fallback || DAMAGE_CODES[code] || code) : (fallback || DAMAGE_CODES[code] || code));

/** A view's name, translated (inspection.view.*). */
export const viewLabel = (t, view) =>
  (VIEW_NAMES[view] ? (t ? t(`inspection.view.${view}`, VIEW_NAMES[view]) : VIEW_NAMES[view]) : view);

/* ── The five views. Grid layout mirrors the printed inspection sheet:
   row 1: top | driver-left | passenger-right | front
   row 2: rear (spans column 1 only)
   Keys stay as top / left / right / front / rear to preserve marker
   coordinates already stored against them. ────────────────────────── */
const VIEWS = [
  { key: 'top',   img: topRoofImg,       glyph: '⌂' },
  { key: 'left',  img: driverSideImg,    glyph: '◫' },
  { key: 'right', img: passengerSideImg, glyph: '◫' },
  { key: 'front', img: frontImg,         glyph: '▣' },
  { key: 'rear',  img: rearImg,          glyph: '▣' },
];

/**
 * @param {Array}   marks          [{id, view, code, x, y, coord?, note}]
 * @param {string}  activeCode     currently selected legend code ('' = none)
 * @param {string}  selectedMarkId highlighted marker
 * @param {Func}    onAddMark      (view, x, y, coord) — x/y relative to the car
 *                                 picture, coord is 'img'. Omit to make the
 *                                 diagram read-only.
 * @param {Func}    onSelectMark   (markId)
 * @param {boolean} compact        stack views in a single column (mobile / preview)
 * @param {Array}   views          only these view keys (default: all five)
 * @param {Object}  labels         panel titles by view key (default: viewLabel())
 */
export default function CarDamageDiagram({
  marks = [], activeCode = '', selectedMarkId = '',
  onAddMark, onSelectMark, compact = false, views, labels,
}) {
  const { t } = useTranslation();
  const readOnly = typeof onAddMark !== 'function';
  const placing = !readOnly && !!activeCode;

  // Clicks land on the car picture only, and are kept relative to it. Clicks
  // on an existing marker stop there (their own handler), so they never add one.
  const handleClick = (view) => (e) => {
    if (!placing) return;
    const { x, y } = pointOnRect(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    onAddMark(view.key, x, y, IMAGE_COORD);
  };

  const renderMark = (m) => {
    const on = m.id === selectedMarkId;
    const name = damageLabel(t, m.code);
    return (
      <button
        key={m.id}
        type="button"
        title={name}
        aria-label={name}
        aria-pressed={onSelectMark ? on : undefined}
        tabIndex={onSelectMark ? 0 : -1}
        className={`cdd-mark${on ? ' cdd-mark-on' : ''}${onSelectMark ? ' cdd-mark-clickable' : ''}`}
        onClick={(e) => { e.stopPropagation(); onSelectMark && onSelectMark(m.id); }}
        style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, background: DAMAGE_COLORS[m.code] || '#dc2626' }}
      >
        {m.code}
      </button>
    );
  };

  return (
    <div className={`cdd-grid${compact ? ' cdd-grid-compact' : ''}`}>
      {(views ? VIEWS.filter(v => views.includes(v.key)) : VIEWS).map(view => {
        const viewMarks = marks.filter(m => m.view === view.key);
        const label = labels?.[view.key] || viewLabel(t, view.key);
        return (
          // vi-view-panel: the staff form's print rules keep a view on one page.
          <div key={view.key} className={`cdd-panel vi-view-panel${view.key === 'rear' ? ' cdd-panel-rear' : ''}`}>
            {/* header — navy circular glyph + label, matching the printed sheet */}
            <div className="cdd-head">
              <div className="cdd-glyph" aria-hidden>{view.glyph}</div>
              <span className="cdd-title">{label}</span>
              {viewMarks.length > 0 && <span className="cdd-count">{viewMarks.length}</span>}
            </div>

            {/* The box; the car picture (the stage) is fitted and centred in it.
                Picture markers ride on the stage, older box markers on the box. */}
            <div className="cdd-box" style={{ height: VIEW_BOX_HEIGHT[view.key] }}>
              <div
                className={`cdd-stage${placing ? ' cdd-stage-active' : ''}`}
                style={stageStyle(view.key)}
                onClick={handleClick(view)}
              >
                <img className="cdd-img" src={view.img} alt={label} draggable={false} />
                {viewMarks.filter(isImageMark).map(renderMark)}
              </div>
              {viewMarks.filter(m => !isImageMark(m)).map(renderMark)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
