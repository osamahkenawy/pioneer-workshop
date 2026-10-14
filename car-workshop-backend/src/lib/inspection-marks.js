/**
 * inspection-marks.js — the damage legend of the Vehicle Inspection Form, and
 * where a marker sits on a car picture, for anything the server draws (the
 * job sheet PDF's inspection page, lib/service-job-sheet.js).
 *
 * Markers are stored in vehicle_inspections.marks as x / y between 0 and 1,
 * in one of two frames (routes/vehicle-inspections.js sanitizeMarks):
 *
 *   coord: 'img'  relative to the car picture itself. Every marker placed
 *                 since 2026-10: it belongs to a spot on the car, whatever
 *                 size the picture is drawn at.
 *   no coord      relative to the box the picture was drawn in on the staff
 *                 form (fixed height, column width, 16px margin, picture
 *                 fitted and centred). Older markers; where the picture sat
 *                 in that box depended on the screen, so they can only be
 *                 placed approximately — against the whole frame, as before.
 *
 * The front-end twin (the diagram on screen, in print and on the customer's
 * link) is car-workshop-frontend/src/lib/inspectionMarks.js. Change a size
 * in both.
 */

/** The `coord` value of a marker stored relative to the car picture. */
export const IMAGE_COORD = 'img';

/* Damage legend. Codes mirror the printed form; two deliberate corrections:
   the source sheet used "GC" for BOTH Glass Chip and Gouges/Crease (so a mark
   was ambiguous) — Gouges/Crease is "GO" here; and "Pant Chip" was a typo.
   The front end has the same table in components/CarDamageDiagram.jsx
   (translated there, inspection.code.*). */
export const DAMAGE_CODES = Object.freeze({
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
});

/**
 * Pixel size of the pictures in assets/inspection/ (the same files as the
 * front end's src/inspection/). Only the ratio matters.
 */
export const VIEW_IMAGE_SIZE = Object.freeze({
  top:   Object.freeze({ w: 310, h: 460 }),
  left:  Object.freeze({ w: 385, h: 460 }),
  right: Object.freeze({ w: 378, h: 460 }),
  front: Object.freeze({ w: 330, h: 460 }),
  rear:  Object.freeze({ w: 330, h: 290 }),
});

/** Is this marker stored relative to the car picture? */
export const isImageMark = mark => mark?.coord === IMAGE_COORD;

const clamp01 = v => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0));

/**
 * The rectangle a picture takes when fitted ("contain") and centred in a
 * frame — what PDFKit's doc.image(path, x, y, { fit: [w, h], align: 'center',
 * valign: 'center' }) draws, and what the browser draws with object-fit:
 * contain.
 *
 * @param {{x: number, y: number, w: number, h: number}} frame
 * @param {{w: number, h: number}} size  the picture's own size (or ratio)
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function fitRect(frame, size) {
  if (!size?.w || !size?.h || !(frame.w > 0) || !(frame.h > 0)) return { ...frame };
  const s = Math.min(frame.w / size.w, frame.h / size.h);
  const w = size.w * s;
  const h = size.h * s;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h };
}

/**
 * Where to draw a marker, for a car picture fitted and centred in `frame`.
 * A picture marker lands on its spot of the car; an older marker is placed
 * against the whole frame (approximate, as it always was).
 *
 * @param {{view: string, x: number, y: number, coord?: string}} mark
 * @param {{x: number, y: number, w: number, h: number}} frame
 *   the area the picture is fitted into (e.g. a PDF cell less its margin)
 * @returns {{x: number, y: number}} in the frame's units
 *
 * @example
 *   // service-job-sheet.js, inside the views loop:
 *   const p = markPointInFrame(m, { x: x + 4, y: cy + 4, w: cellW - 8, h: cellH - 8 });
 *   doc.circle(p.x, p.y, 5).fill(color);
 */
export function markPointInFrame(mark, frame) {
  const r = isImageMark(mark) ? fitRect(frame, VIEW_IMAGE_SIZE[mark.view]) : frame;
  return { x: r.x + clamp01(mark?.x) * r.w, y: r.y + clamp01(mark?.y) * r.h };
}
