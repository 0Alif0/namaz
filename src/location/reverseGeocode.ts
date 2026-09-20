/**
 * Place name lookup (spec §9).
 *
 * The lookup runs in the browser by default. BigDataCloud's free
 * `reverse-geocode-client` endpoint requires this: its fair use policy states
 * that calls must originate directly from the device being located, and that
 * server-side or automated calls are met with a 402 and an IP ban. So the
 * privacy-preserving server proxy is not an option on the free tier, however
 * much we might prefer it.
 *
 * A backend proxy is still used when `VITE_API_BASE_URL` is set AND
 * `VITE_GEOCODE_VIA_BACKEND` is true. Only turn that on if your server is
 * calling a *keyed* geocoding endpoint that permits server-side use.
 *
 * Set `VITE_DISABLE_GEOCODE=true` to switch the whole thing off. The app then
 * shows no city name, which costs nothing functionally — the name is decoration,
 * and prayer times, Qibla and Tahajjud all come from the coordinates directly.
 *
 * When no name can be found we show nothing rather than falling back to
 * coordinates: §5 is explicit that latitude and longitude never appear in the UI.
 */

const API_BASE = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const VIA_BACKEND = import.meta.env?.VITE_GEOCODE_VIA_BACKEND === 'true';
const DISABLED = import.meta.env?.VITE_DISABLE_GEOCODE === 'true';
const DIRECT_ENDPOINT = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

// v2: names are built differently now, so old cached strings must not be reused.
const CACHE_KEY = 'namaz.placeNames.v2';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function coarseKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

interface CacheEntry {
  name: string;
  savedAt: number;
}

function readCache(): Record<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheEntry>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Non-fatal.
  }
}

export function cachedPlaceName(latitude: number, longitude: number): string | null {
  const entry = readCache()[coarseKey(latitude, longitude)];
  if (!entry) return null;
  if (Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
  return entry.name;
}

function remember(latitude: number, longitude: number, name: string): void {
  const cache = readCache();
  cache[coarseKey(latitude, longitude)] = { name, savedAt: Date.now() };
  writeCache(cache);
}

/**
 * The geocoder returns formal country names — "United Kingdom of Great Britain
 * and Northern Ireland". Intl knows the short one people actually use.
 */
function countryLabel(code: string | undefined, formal: string | undefined): string | undefined {
  if (code) {
    try {
      const short = new Intl.DisplayNames(undefined, { type: 'region' }).of(code);
      if (short && short !== code) return short;
    } catch {
      // Older engine, or an unrecognised code. Fall back to what was sent.
    }
  }
  return formal;
}

/** Builds "Brooklyn, New York" or "London, United Kingdom". */
export function pickName(data: Record<string, unknown>): string | null {
  const city = data.city as string | undefined;
  const locality = data.locality as string | undefined;
  const region = data.principalSubdivision as string | undefined;
  const code = data.countryCode as string | undefined;
  const country = countryLabel(code, data.countryName as string | undefined);

  /*
   * In the US the neighbourhood is the half that means something — "Brooklyn",
   * where `city` says "New York City" — and the state is how people place it.
   * Elsewhere it inverts: `city` gives "London" where `locality` gives "City of
   * Westminster", and the country places it better than a subdivision does.
   */
  const isUS = code === 'US';
  const place = isUS ? locality ?? city : city ?? locality;
  const qualifier = isUS ? region ?? country : country ?? region;

  if (place && qualifier && place !== qualifier) return `${place}, ${qualifier}`;
  if (place) return place;
  if (region && country && region !== country) return `${region}, ${country}`;
  return country ?? null;
}

async function viaBackend(lat: string, lon: string): Promise<string | null> {
  if (!API_BASE || !VIA_BACKEND) return null;

  const response = await fetch(`${API_BASE}/api/place-name?lat=${lat}&lon=${lon}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as { name?: string };
  return data.name ?? null;
}

async function viaDirectLookup(lat: string, lon: string): Promise<string | null> {
  const response = await fetch(
    `${DIRECT_ENDPOINT}?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) return null;

  return pickName((await response.json()) as Record<string, unknown>);
}

/**
 * Returns something like "Brooklyn, New York", or null if the name is unknown.
 * Never throws.
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  if (DISABLED) return null;

  const cached = cachedPlaceName(latitude, longitude);
  if (cached) return cached;

  const lat = latitude.toFixed(2);
  const lon = longitude.toFixed(2);

  for (const lookup of [viaBackend, viaDirectLookup]) {
    try {
      const name = await lookup(lat, lon);
      if (name) {
        remember(latitude, longitude, name);
        return name;
      }
    } catch {
      // Try the next one; a missing city name is not worth an error state.
    }
  }

  return null;
}
