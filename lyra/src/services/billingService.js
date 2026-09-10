// Stripe billing helpers. Stripe is loaded lazily so the app runs fine with
// billing unconfigured (checkout returns 503; the webhook rejects cleanly).

import Stripe from 'stripe';
import config from '../config.js';
import { pool, withUser } from '../db.js';
import { resetTenantPeriod } from './tokens.js';
import { HttpError } from '../middleware/errors.js';

let _stripe = null;
export function stripe() {
  if (!config.stripeSecretKey) return null;
  if (!_stripe) _stripe = new Stripe(config.stripeSecretKey);
  return _stripe;
}

// Map a Stripe price id -> token quota using STRIPE_PRICE_QUOTAS config.
export function quotaForPrice(priceId) {
  if (!priceId) return null;
  const q = config.stripePriceQuotas?.[priceId];
  return typeof q === 'number' ? q : null;
}

/** Ensure the tenant has a Stripe customer; returns the customer id. */
export async function ensureCustomer(tenant) {
  const s = stripe();
  if (!s) throw new HttpError(503, 'BILLING_DISABLED', 'Billing is not configured');
  if (tenant.stripe_customer_id) return tenant.stripe_customer_id;
  const customer = await s.customers.create({
    name: tenant.name,
    metadata: { tenantId: tenant.id, tenantType: tenant.type },
  });
  await pool.query('UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2', [customer.id, tenant.id]);
  return customer.id;
}

/** Create a subscription Checkout Session for the given price. */
export async function createCheckout({ tenant, priceId, quantity = 1 }) {
  const s = stripe();
  if (!s) throw new HttpError(503, 'BILLING_DISABLED', 'Billing is not configured');
  if (!priceId) throw new HttpError(400, 'MISSING_PRICE', 'priceId is required');
  const customerId = await ensureCustomer(tenant);
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity }],
    success_url: `${config.appBaseUrl}/?billing=success`,
    cancel_url: `${config.appBaseUrl}/?billing=cancelled`,
    // metadata on the subscription so webhooks can resolve the tenant reliably.
    subscription_data: { metadata: { tenantId: tenant.id } },
    metadata: { tenantId: tenant.id },
  });
  return { url: session.url };
}

async function tenantIdFromObject(obj) {
  if (obj?.metadata?.tenantId) return obj.metadata.tenantId;
  const customerId = obj?.customer;
  if (customerId) {
    const { rows } = await pool.query('SELECT id FROM tenants WHERE stripe_customer_id = $1', [customerId]);
    if (rows.length) return rows[0].id;
  }
  return null;
}

async function applySubscription(subscription) {
  const s = stripe();
  const tenantId = await tenantIdFromObject(subscription);
  if (!tenantId) return { handled: false, reason: 'tenant_unresolved' };

  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id;
  const quantity = item?.quantity || 1;
  const perSeat = quotaForPrice(priceId);
  const newLimit = perSeat != null ? perSeat * quantity : null;

  const { rows } = await pool.query('SELECT id, tenant_id, role FROM users WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  const ctx = rows[0] || { id: null };
  await pool.query('UPDATE tenants SET stripe_subscription_id = $1, plan_type = $2 WHERE id = $3',
    [subscription.id, priceId || 'custom', tenantId]);
  if (newLimit != null && ctx.id) {
    await withUser(ctx, (c) => resetTenantPeriod(c, tenantId, newLimit));
  }
  void s; // reserved for future proration lookups
  return { handled: true, tenantId, newLimit };
}

/**
 * Handle a verified Stripe event. Returns a small summary for logging.
 */
export async function handleEvent(event) {
  const s = stripe();
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.subscription && s) {
        const sub = await s.subscriptions.retrieve(session.subscription);
        return applySubscription(sub);
      }
      return { handled: false, reason: 'no_subscription' };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return applySubscription(event.data.object);
    case 'invoice.payment_succeeded': {
      // Renewal: reset the period counters (quota stays as-is).
      const invoice = event.data.object;
      const tenantId = await tenantIdFromObject(invoice);
      if (!tenantId) return { handled: false, reason: 'tenant_unresolved' };
      const { rows } = await pool.query('SELECT id, tenant_id, role FROM users WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (rows[0]) await withUser(rows[0], (c) => resetTenantPeriod(c, tenantId, null));
      return { handled: true, tenantId };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const tenantId = await tenantIdFromObject(sub);
      if (tenantId) {
        // Drop the pool to zero so access pauses until they re-subscribe.
        await pool.query(
          'UPDATE tenants SET token_pool_limit = 0, plan_type = $2 WHERE id = $1',
          [tenantId, 'cancelled'],
        );
      }
      return { handled: true, tenantId };
    }
    default:
      return { handled: false, reason: `ignored:${event.type}` };
  }
}
