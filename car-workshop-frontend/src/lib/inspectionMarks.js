/**
 * inspectionMarks.js — where a damage marker sits on the car diagram
 * (components/CarDamageDiagram.jsx), and the arithmetic behind it. No React
 * and no images here, so it can be checked on its own.
 *
 * Each of the five views is a box of fixed height (VIEW_BOX_HEIGHT) and the
 * column's width. The car picture is drawn inside it with a 16px margin,
 * scaled down to fit ("contain") and centred. That picture rectangle — the
 * "stage" — is
 *
 *   width  = min(boxWidth - 32, (boxHeight - 32) × ratio)
 *   height = width / ratio                  (ratio = picture width / height)
 *
 * so it moves inside the box as the column gets wider or narrower.
 *
 * A marker is stored as x / y between 0 and 1, in one of two frames:
 *
 *   coord: 'img'  relative to the car picture (the stage). Every new marker.
 *                 It stays on the spot that was clicked at any width — the
 *                 staff form, its print-out and the customer's page.
 *   no coord      relative to the whole box. Markers saved before 'img'
 *                 existed. They are drawn as before: on the spot that was
 *                 clicked only at the box size it was clicked at.
 *
 * The back-end twin, for the job sheet PDF, is
 * car-workshop-backend/src/lib/inspection-marks.js. Change a size in both.
 */

/** The `coord` value of a marker stored relative to the car picture. */
export const IMAGE_COORD = 'img';

/** Margin (px) between the view box and the car picture. */
export const VIEW_PAD = 16;

/** Height (px) of each view's box; its width is the column's. */
export const VIEW_BOX_HEIGHT = Object.freeze({ top: 260, left: 260, right: 260, front: 260, rear: 225 });

/**
 * Pixel size of the pictures in src/inspection/ (and the back end's
 * assets/inspection/). Only the ratio matters. Update it if a picture is
 * replaced by one of another shape.
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

const clamp01 = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

const sizeOf = view => VIEW_IMAGE_SIZE[view] || VIEW_IMAGE_SIZE.top;
const heightOf = view => VIEW_BOX_HEIGHT[view] || VIEW_BOX_HEIGHT.top;

/**
 * The car picture's rectangle inside a view box, in px from the box's
 * top-left corner.
 *
 * @param {string} view   top | left | right | front | rear
 * @param {number} boxW   the box's width (px)
 * @param {number} [boxH] the box's height (default VIEW_BOX_HEIGHT[view])
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function stageRect(view, boxW, boxH = heightOf(view)) {
  const { w, h } = sizeOf(view);
  const innerW = Math.max(0, boxW - 2 * VIEW_PAD);
  const innerH = Math.max(0, boxH - 2 * VIEW_PAD);
  const width = Math.min(innerW, innerH * (w / h));
  const height = width / (w / h);
  return { left: VIEW_PAD + (innerW - width) / 2, top: VIEW_PAD + (innerH - height) / 2, width, height };
}

/**
 * The stage as inline CSS — the same rectangle as stageRect(), but worked
 * out by the browser, so it is right at any width and in print without
 * measuring anything. The box centres it (flex, CarDamageDiagram.css).
 *
 * @param {string} view
 * @returns {{width: string, aspectRatio: string}}
 */
export function stageStyle(view) {
  const { w, h } = sizeOf(view);
  const maxW = Math.round((heightOf(view) - 2 * VIEW_PAD) * (w / h) * 100) / 100;
  return { width: `min(calc(100% - ${2 * VIEW_PAD}px), ${maxW}px)`, aspectRatio: `${w} / ${h}` };
}

/**
 * Where a pointer is on a rectangle, as x / y between 0 and 1 (clamped).
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {{left: number, top: number, width: number, height: number}} rect
 *   e.g. element.getBoundingClientRect()
 * @returns {{x: number, y: number}}
 */
export function pointOnRect(clientX, clientY, rect) {
  return {
    x: rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0,
    y: rect.height > 0 ? clamp01((clientY - rect.top) / rect.height) : 0,
  };
}

/**
 * A point on the car picture → the same spot as a fraction of the box, for a
 * box of that size.
 */
export function imageToBoxPoint(view, x, y, boxW, boxH = heightOf(view)) {
  const r = stageRect(view, boxW, boxH);
  return { x: (r.left + clamp01(x) * r.width) / boxW, y: (r.top + clamp01(y) * r.height) / boxH };
}

/**
 * A point as a fraction of the box → the same spot on the car picture, for a
 * box of that size (clamped to the picture). What a legacy marker would be
 * had it been clicked in a box of exactly that size.
 */
export function boxToImagePoint(view, x, y, boxW, boxH = heightOf(view)) {
  const r = stageRect(view, boxW, boxH);
  return pointOnRect(clamp01(x) * boxW, clamp01(y) * boxH, r);
}

/**
 * Where a marker is drawn, in px from the box's top-left corner: a picture
 * marker on the stage, a legacy marker straight against the box.
 *
 * @param {{view: string, x: number, y: number, coord?: string}} mark
 * @param {number} boxW
 * @param {number} [boxH]
 * @returns {{left: number, top: number}}
 */
export function markPositionInBox(mark, boxW, boxH = heightOf(mark?.view)) {
  if (isImageMark(mark)) {
    const r = stageRect(mark.view, boxW, boxH);
    return { left: r.left + clamp01(mark.x) * r.width, top: r.top + clamp01(mark.y) * r.height };
  }
  return { left: clamp01(mark?.x) * boxW, top: clamp01(mark?.y) * boxH };
}
