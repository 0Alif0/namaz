import { Router } from 'express';
import { query } from '../database/pool.js';
import { coarseKey, validateCoarseCoordinates } from '../services/validate.js';

const router = Router();

const CACHE_TTL_DAYS = 90;

function pickName(data) {
  const locality = data?.locality || data?.city || data?.principalSubdivision;
  const region = data?.principalSubdivision;

  if (locality && region && locality !== region) return `${locality}, ${region}`;
  if (locality) return locality;
  if (region && data?.countryName) return `${region}, ${data.countryName}`;
  return data?.countryName || null;
}

/**
 * IMPORTANT: do not point GEOCODE_ENDPOINT at BigDataCloud's free
 * `reverse-geocode-client` URL. Its fair use policy forbids server-side calls
 * and answers them with a 402 plus an IP ban. This route is only for a *keyed*
 * endpoint whose terms allow server-side use (BigDataCloud's paid
 * `/data/reverse-geocode`, Google, LocationIQ, or your own Nominatim).
 *
 * By default the frontend does not call this route at all; it geocodes in the
 * browser. Set VITE_GEOCODE_VIA_BACKEND=true once you have a keyed endpoint here.
 *
 * Turns a rounded coordinate pair into a human-readable name.
 * Coordinates arrive rounded to two decimals (~1 km) and are rounded again here.
 * Results are cached per square so the upstream service sees far fewer requests
 * than we have users, and none of them can be tied to a push subscription.
 */
router.get('/place-name', async (req, res, next) => {
  try {
    const { latitude, longitude } = validateCoarseCoordinates(req.query.lat, req.query.lon);
    const key = coarseKey(latitude, longitude);

    const [cached] = await query(
      'SELECT name FROM place_names WHERE coarse_key = ? AND updated_at > (NOW() - INTERVAL ? DAY)',
      [key, CACHE_TTL_DAYS],
    );
    if (cached) return res.json({ name: cached.name });

    const endpoint = process.env.GEOCODE_ENDPOINT;
    if (!endpoint) return res.status(503).json({ error: 'Place lookup is not configured.' });

    if (endpoint.includes('reverse-geocode-client')) {
      console.error('[namaz] GEOCODE_ENDPOINT points at a client-only API. Refusing to call it server-side.');
      return res.status(503).json({ error: 'Place lookup is not configured.' });
    }

    const upstream = await fetch(
      `${endpoint}?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!upstream.ok) return res.status(502).json({ error: 'Place lookup failed.' });

    const name = pickName(await upstream.json());
    if (!name) return res.status(404).json({ error: 'No place name for these coordinates.' });

    await query(
      'INSERT INTO place_names (coarse_key, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
      [key, name.slice(0, 160)],
    );

    return res.json({ name });
  } catch (error) {
    return next(error);
  }
});

export default router;
