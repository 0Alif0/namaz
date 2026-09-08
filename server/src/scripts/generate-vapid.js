import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('Add these to server/.env:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}\n`);
console.log('The public key is served to the browser by /api/vapid-public-key.');
console.log('The private key stays on the server. Never put it in frontend code.');
