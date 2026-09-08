import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { dispatchDuePushes } from '../notifications/webpush.js';

const router = Router();

function secretMatches(provided) {
  const expected = process.env.CRON_SECRET;
  if (!expected || typeof provided !== 'string') return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Called once a minute by the Hostinger cron job:
 *   curl -fsS -H "x-cron-secret: $SECRET" https://api.example.com/api/internal/dispatch
 */
router.post('/internal/dispatch', async (req, res, next) => {
  if (!secretMatches(req.get('x-cron-secret'))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    return res.json(await dispatchDuePushes());
  } catch (error) {
    return next(error);
  }
});

// Some cron runners can only issue GET requests.
router.get('/internal/dispatch', (req, res, next) => {
  req.method = 'POST';
  router.handle(req, res, next);
});

export default router;
