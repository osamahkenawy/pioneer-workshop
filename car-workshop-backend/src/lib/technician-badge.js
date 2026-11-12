/**
 * technician-badge.js — the technician's printed badge for the scan station
 * (lib/job-tasks.js): name, workshop and the badge code in Code-128, which
 * the technician scans before scanning a job, so the station knows it is
 * really them. Card size (85.6 × 54 mm) drawn at actual size on an A4 page
 * with a cut line, to print on any office printer and laminate.
 */
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';

const MM = 72 / 25.4;
const CARD_W = 85.6 * MM;
const CARD_H = 54 * MM;

/** Code-128 PNG for a scan code: wide bars, a quiet zone, the digits under it. */
export async function scanBarcodePNG(text, { height = 12, text: withText = true } = {}) {
  return bwipjs.toBuffer({
    bcid: 'code128', text, scale: 4, height,
    ...(withText ? { includetext: true, textxalign: 'center', textsize: 9 } : {}),
    paddingwidth: 10, paddingheight: 2, backgroundcolor: 'FFFFFF',
  });
}

export async function generateTechnicianBadgePDF(res, { mechanic, workshop }) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="badge-${mechanic.id}.pdf"`);
  doc.pipe(res);

  const x = 40, y = 40;
  doc.save().lineWidth(0.5).dash(3, { space: 3 }).strokeColor('#94a3b8')
     .rect(x, y, CARD_W, CARD_H).stroke().restore();
  doc.fillColor('#94a3b8').fontSize(7).font('Helvetica')
     .text('Cut along the line', x, y + CARD_H + 4, { width: CARD_W, align: 'center' });

  const pad = 10;
  doc.rect(x, y, CARD_W, 18).fill('#1e3a6b');
  doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold')
     .text((workshop?.name || 'Workshop').toUpperCase(), x + pad, y + 5.5, { width: CARD_W - 2 * pad - 70, lineBreak: false, ellipsis: true });
  doc.fillColor('#ffffff').fontSize(6.5).font('Helvetica')
     .text('TECHNICIAN BADGE', x + CARD_W - pad - 70, y + 6, { width: 70, align: 'right' });

  doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold')
     .text(mechanic.full_name || '—', x + pad, y + 25, { width: CARD_W - 2 * pad, lineBreak: false, ellipsis: true });

  const png = await scanBarcodePNG(mechanic.badge_code, { height: 11 });
  const bw = CARD_W - 2 * pad - 10;
  doc.image(png, x + pad + 5, y + 46, { fit: [bw, 74], align: 'center', valign: 'top' });

  doc.fillColor('#64748b').fontSize(6).font('Helvetica')
     .text('Scan this badge at the station, then scan your job on the job card.', x + pad, y + CARD_H - 13, { width: CARD_W - 2 * pad, align: 'center' });
  doc.end();
}
