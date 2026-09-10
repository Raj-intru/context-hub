import { Router } from 'express';
import { asyncHandler } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { signup, login, acceptInvite, publicUser } from '../services/authService.js';

const router = Router();

router.post('/signup', asyncHandler(async (req, res) => {
  const { tenantType, tenantName, firstName, email, password } = req.body || {};
  const result = await signup({ tenantType, tenantName, firstName, email, password });
  res.status(201).json(result);
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const result = await login({ email, password });
  res.json(result);
}));

router.post('/accept-invite', asyncHandler(async (req, res) => {
  const { token, firstName, password } = req.body || {};
  const result = await acceptInvite({ token, firstName, password });
  res.status(201).json(result);
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
