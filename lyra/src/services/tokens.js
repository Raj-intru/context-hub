// Token budget accounting.
//
// Budgets are layered: tenant pool -> optional group (classroom) allocation ->
// optional per-user cap. A request is refused if ANY layer is exhausted.
//
// Honest note on concurrency: we soft-check the budget before calling the model
// (actual token cost is only known afterwards), then atomically increment
// counters. Two requests racing at the boundary can overshoot by a small
// amount — standard for usage-metered APIs and documented in docs/SECURITY.md.
// Counters are incremented with `x = x + n` which is atomic per statement.

/**
 * @returns {{ok: boolean, reason?: string}}
 */
export async function checkBudget(client, { tenantId, groupId, userId, monthlyUserCap }) {
  const tenant = await client.query(
    'SELECT token_pool_limit, tokens_consumed_this_period FROM tenants WHERE id = $1',
    [tenantId],
  );
  if (tenant.rows.length === 0) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const t = tenant.rows[0];
  if (BigInt(t.tokens_consumed_this_period) >= BigInt(t.token_pool_limit)) {
    return { ok: false, reason: 'POOL_EXHAUSTED' };
  }

  if (groupId) {
    const g = await client.query(
      'SELECT token_allocation, tokens_consumed_this_period FROM groups WHERE id = $1',
      [groupId],
    );
    if (g.rows.length && g.rows[0].token_allocation != null) {
      if (BigInt(g.rows[0].tokens_consumed_this_period) >= BigInt(g.rows[0].token_allocation)) {
        return { ok: false, reason: 'GROUP_EXHAUSTED' };
      }
    }
  }

  if (monthlyUserCap != null) {
    const used = await client.query(
      `SELECT COALESCE(SUM(tokens_used), 0) AS used
         FROM usage_events
        WHERE user_id = $1
          AND created_at >= (SELECT period_started_at FROM tenants WHERE id = $2)`,
      [userId, tenantId],
    );
    if (BigInt(used.rows[0].used) >= BigInt(monthlyUserCap)) {
      return { ok: false, reason: 'USER_CAP_REACHED' };
    }
  }

  return { ok: true };
}

/** Atomically record token spend across tenant, group, and a usage_event. */
export async function recordUsage(client, { tenantId, groupId, userId, tokensUsed, model, wasFlagged = false }) {
  const n = Math.max(0, Math.floor(Number(tokensUsed) || 0));
  await client.query(
    'UPDATE tenants SET tokens_consumed_this_period = tokens_consumed_this_period + $1 WHERE id = $2',
    [n, tenantId],
  );
  if (groupId) {
    await client.query(
      'UPDATE groups SET tokens_consumed_this_period = tokens_consumed_this_period + $1 WHERE id = $2',
      [n, groupId],
    );
  }
  await client.query(
    `INSERT INTO usage_events (tenant_id, group_id, user_id, model, tokens_used, was_flagged)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, groupId || null, userId, model || null, n, wasFlagged],
  );
}

/** Reset a tenant's period counters (called on successful billing renewal). */
export async function resetTenantPeriod(client, tenantId, newLimit) {
  if (newLimit != null) {
    await client.query(
      `UPDATE tenants
          SET token_pool_limit = $1, tokens_consumed_this_period = 0, period_started_at = NOW()
        WHERE id = $2`,
      [newLimit, tenantId],
    );
  } else {
    await client.query(
      `UPDATE tenants
          SET tokens_consumed_this_period = 0, period_started_at = NOW()
        WHERE id = $1`,
      [tenantId],
    );
  }
  await client.query(
    'UPDATE groups SET tokens_consumed_this_period = 0 WHERE tenant_id = $1',
    [tenantId],
  );
}
