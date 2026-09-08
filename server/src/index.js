import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import dispatchRoutes from './routes/dispatch.js';
import placeNameRoutes from './routes/placeName.js';
import scheduleRoutes from './routes/schedule.js';
import vapidRoutes from './routes/vapid.js';
import { ValidationError } from './services/validate.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin and curl requests have no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed'));
    },
    methods: ['GET', 'POST'],
  }),
);

app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', vapidRoutes);
app.use('/api', scheduleRoutes);
app.use('/api', placeNameRoutes);
app.use('/api', dispatchRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Users never see a stack trace (spec §51). The server log keeps the detail.
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message });
  }

  console.error('[namaz]', error);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Namaz API listening on port ${port}`);
});

export default app;
