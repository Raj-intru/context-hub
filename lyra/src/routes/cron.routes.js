// Cron endpoints for serverless deploys (Vercel Cron), where the in-process
// node-cron scheduler does not run. Protected by a shared secret: Vercel Cron
// sends `Authorization: Bearer <CRON_SECRET>`. On persistent hosts (Railway),
// node-cron in server.js runs the same job and this route is simply unused.

import { Router } from 'express';
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

export default router;
