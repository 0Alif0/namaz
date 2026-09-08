import { Router } from 'express';

const router = Router();

/** Only ever the public key. The private key never leaves the server. */
router.get('/vapid-public-key', (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;

  if (!publicKey) {
    return res.status(503).json({ error: 'Notifications are not configured on this server.' });
  }
  return res.json({ publicKey });
});

export default router;
