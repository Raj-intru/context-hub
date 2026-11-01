import express from 'express';
import { errorHandler, notFound, handler } from './middleware/errors.js';
import { authenticate } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { agentRoutes } from './routes/agent.routes.js';
import { capabilityRoutes } from './routes/capabilities.routes.js';
import { approvalRoutes } from './routes/approvals.routes.js';
import { mandateRoutes } from './routes/mandates.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { productionReadiness } from './config.js';

export function createApp({ bank }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', handler(async (_req, res) => {
    const health = await bank.store.healthcheck();
    res.status(health.ok ? 200 : 503).json({
      ...health,
      capabilities: bank.registry.size(),
      agentProvider: bank.llm.name,
      readiness: productionReadiness(bank.config),
    });
  }));

  // Everything below needs an identity.
  app.use('/v1', authenticate({ bank, config: bank.config }));

  app.use('/v1/agent', rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'agent' }), agentRoutes({ bank }));
  app.use('/v1/capabilities', rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'cap' }), capabilityRoutes({ bank }));
  app.use('/v1', approvalRoutes({ bank }));
  app.use('/v1/mandates', mandateRoutes({ bank }));
  app.use('/v1/admin', adminRoutes({ bank }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
