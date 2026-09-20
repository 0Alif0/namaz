/**
 * Generates a VAPID key pair.
 *
 * Uses only Node's built-in WebCrypto, so it runs before `npm install` and adds
 * no dependency. A VAPID pair is an ordinary P-256 ECDSA key: the public half is
 * the raw uncompressed point, the private half the 32-byte scalar, both
 * base64url — the same encoding web-push has always used.
 */

import { webcrypto } from 'node:crypto';

const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const raw = await webcrypto.subtle.exportKey('raw', publicKey);
const jwk = await webcrypto.subtle.exportKey('jwk', privateKey);

console.log('VAPID_PUBLIC_KEY');
console.log(Buffer.from(raw).toString('base64url'));
console.log();
console.log('VAPID_PRIVATE_KEY');
console.log(jwk.d);
console.log();
console.log('Keep the private key secret: `wrangler secret put VAPID_PRIVATE_KEY`.');
