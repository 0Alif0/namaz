import 'dotenv/config';
import { dispatchDuePushes } from '../notifications/webpush.js';
import { closePool } from '../database/pool.js';

const result = await dispatchDuePushes();
console.log(JSON.stringify(result));
await closePool();
