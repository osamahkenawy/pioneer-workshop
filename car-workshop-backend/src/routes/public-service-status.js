/**
 * ═══════════════════════════════════════════════════════════════════
 *  The customer's status link (no login)
 * ═══════════════════════════════════════════════════════════════════
 *
 * GET /api/public/service-status/:token — where the car is, in the
 * customer's seven stages (lib/customer-status.js). The page is
 * /service-status/:token (and /track/:token for job sheets already printed);
 * every SMS, e-mail, WhatsApp text and job sheet QR links there
 * (lib/customer-link.js).
 *
 * Anonymous and forwarded, so the payload is a whitelist: no staff names or
 * phones, no customer phone, address, coordinates, notes or payment method.
 * A token shorter than 20 characters gets the reduced view. Rate-limited by
 * publicTrackingLimiter; the 128-bit token is what stops guessing.
 *
 * Mounted at /api/public/service-status, before /api/public (server.js).
 */
import express from 'express';
import { publicTrackingLimiter } from '../lib/rate-limits.js';
import { buildCustomerStatus } from '../lib/customer-status.js';

const router = express.Router();

router.get('/:token', publicTrackingLimiter, async (req, res) => {
  try {
    const data = await buildCustomerStatus({ token: req.params.token });
    if (!data) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: "We couldn't find this job. Check the link or call us." });
    }
    // Status changes through the day; never serve a stale copy from a cache.
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data });
  } catch (err) {
    console.error('GET /public/service-status/:token error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load the status' });
  }
});

export default router;
