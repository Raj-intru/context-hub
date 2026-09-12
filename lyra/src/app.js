// Express application wiring.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler } from './middleware/errors.js';
import { rateLimit } from './middleware/rateLimit.js';
import { healthcheck } from './db.js';
import authRoutes from './routes/auth.routes.js';
import tenantRoutes from './routes/tenant.routes.js';
import chatRoutes from './routes/chat.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import badgeRoutes from './routes/badges.routes.js';
import knowledgeRoutes from './routes/knowledge.routes.js';
import meRoutes from './routes/me.routes.js';
import { billingRouter, stripeWebhookHandler } from './routes/billing.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind a reverse proxy / load balancer

  // Baseline security headers (kept dependency-free; see docs for hardening).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });

  // Stripe webhook MUST see the raw body -> register before express.json().
  app.post('/api/webhooks/stripe', ...stripeWebhookHandler);

  app.use(express.json({ limit: '256kb' }));

  // Health/readiness.
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/readyz', async (req, res) => {
    try {
      await healthcheck();
      res.json({ ok: true, db: true });
    } catch {
      res.status(503).json({ ok: false, db: false });
    }
  });

  // API routes (with targeted rate limits on the sensitive ones).
  app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'auth' }), authRoutes);
  app.use('/api', rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'chat' }), chatRoutes);
  app.use('/api', tenantRoutes);
  app.use('/api', dashboardRoutes);
  app.use('/api', badgeRoutes);
  app.use('/api', knowledgeRoutes);
  app.use('/api', meRoutes);
  app.use('/api', billingRouter);

  // Static web client.
  app.use(express.static(publicDir, { index: 'index.html', maxAge: '1h' }));
  // SPA-ish fallback for the couple of client routes.
  app.get(['/', '/accept-invite'], (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

export default createApp;
