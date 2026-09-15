// Cron endpoints for serverless deploys (Vercel Cron), where the in-process
// node-cron scheduler does not run. Protected by a shared secret: Vercel Cron
// sends `Authorization: Bearer <CRON_SECRET>`. On persistent hosts (Railway),
// node-cron in server.js runs the same job and this route is simply unused.

import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { runWeeklyDigest } from '../services/digest.js';
import config from '../config.js';

const router = Router();

function requireCronSecret(req, res, next) {
  if (!config.cronSecret) throw new HttpError(503, 'CRON_DISABLED', 'CRON_SECRET is not configured');
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${config.cronSecret}`) throw new HttpError(401, 'CRON_UNAUTHORIZED', 'Bad cron secret');
  next();
}

router.get('/cron/weekly-digest', requireCronSecret, asyncHandler(async (req, res) => {
  const result = await runWeeklyDigest();
  res.json({ ok: true, ...result });
}));

// Data-retention purge: delete conversations/messages older than RETENTION_DAYS
// (0 = retain indefinitely -> no-op) plus expired unaccepted invites. Runs a
// SECURITY DEFINER function so it can purge across every user's rows despite the
// per-user RLS that hides them from the app role. Schedule alongside the digest.
router.get('/cron/retention', requireCronSecret, asyncHandler(async (req, res) => {
  const days = config.retentionDays;
  if (!days || days <= 0) {
    return res.json({ ok: true, retentionDays: 0, skipped: 'retention_disabled' });
  }
  const { rows } = await pool.query('SELECT * FROM purge_old_data($1)', [days]);
  res.json({
    ok: true,
    retentionDays: days,
    deletedConversations: Number(rows[0]?.deleted_conversations || 0),
    deletedInvites: Number(rows[0]?.deleted_invites || 0),
  });
}));

export default router;
