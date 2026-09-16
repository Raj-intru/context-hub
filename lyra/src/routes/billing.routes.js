// Billing routes. The webhook needs the RAW request body for signature
// verification, so it is registered with express.raw() and mounted before the
// global JSON parser in app.js.

import { Router } from 'express';
import express from 'express';
import { pool } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, requireBilling } from '../middleware/auth.js';
import { stripe, createCheckout, handleEvent } from '../services/billingService.js';
import config from '../config.js';

export const billingRouter = Router();

// A billing admin (parent_admin / it_admin — never a classroom teacher) starts
// a checkout to subscribe / change plan.
billingRouter.post('/billing/checkout', requireAuth, requireBilling, asyncHandler(async (req, res) => {
  const { priceId, quantity } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM tenants WHERE id = $1', [req.user.tenant_id]);
  if (!rows.length) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant missing');
  const result = await createCheckout({ tenant: rows[0], priceId, quantity });
  res.json(result);
}));

// Stripe webhook. Registered separately in app.js with a raw body parser.
export const stripeWebhookHandler = [
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const s = stripe();
    if (!s || !config.stripeWebhookSecret) {
      throw new HttpError(503, 'BILLING_DISABLED', 'Billing webhook not configured');
    }
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = s.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
    } catch (err) {
      // Bad signature -> 400 (do not process).
      return res.status(400).json({ error: 'WEBHOOK_SIGNATURE', message: err.message });
    }
    const summary = await handleEvent(event);
    if (summary.handled) {
      console.log('[stripe]', event.type, summary);
    }
    res.json({ received: true });
  }),
];
