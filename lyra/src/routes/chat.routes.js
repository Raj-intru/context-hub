// Chat proxy + conversation history.
//
// Flow for a message:
//   1. (supervised only) moderate the prompt; block + record a flagged event
//      if it trips the filter.
//   2. Check the layered token budget.
//   3. Ensure a conversation owned by the caller (RLS-enforced) and load recent
//      decrypted history for context.
//   4. Call the model with the appropriate persona (Socratic for supervised).
//   5. Encrypt + store both turns, record token usage atomically.
//
// The model call happens OUTSIDE any DB transaction so we never hold a
// connection open across a slow network round-trip.

import { Router } from 'express';
import { withUser, pool } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { isSupervised } from '../domain/roles.js';
import { moderate } from '../services/moderation.js';
import { complete, LlmError } from '../services/llm.js';
import { buildMessages } from '../services/prompts.js';
import { checkBudget, recordUsage } from '../services/tokens.js';
import { encryptContent, decryptContent } from '../crypto/content.js';
import config from '../config.js';

const router = Router();
router.use(requireAuth);

const HISTORY_LIMIT = 20;

router.post('/chat', asyncHandler(async (req, res) => {
  const user = req.user;
  const { prompt, model, conversationId } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new HttpError(400, 'EMPTY_PROMPT', 'A non-empty prompt is required');
  }
  if (prompt.length > 12_000) {
    throw new HttpError(413, 'PROMPT_TOO_LONG', 'Prompt exceeds the maximum length');
  }

  const supervised = isSupervised(user.role);

  // 1. Moderation for supervised accounts (fails closed by default).
  if (supervised) {
    const verdict = await moderate(prompt);
    if (verdict.flagged) {
      await withUser(user, (c) => recordUsage(c, {
        tenantId: user.tenant_id, groupId: user.group_id, userId: user.id,
        tokensUsed: 0, model: model || config.defaultModel, wasFlagged: true,
      }));
      throw new HttpError(422, 'SAFETY_VIOLATION',
        'That request was blocked by our safety filter. Please keep it school-appropriate.');
    }
  }

  // 2 + 3. Budget check, conversation, history — one short transaction.
  const prep = await withUser(user, async (c) => {
    const budget = await checkBudget(c, {
      tenantId: user.tenant_id, groupId: user.group_id, userId: user.id,
      monthlyUserCap: user.monthly_token_cap,
    });
    if (!budget.ok) return { blocked: budget.reason };

    let convId = conversationId || null;
    if (convId) {
      const owned = await c.query('SELECT id FROM conversations WHERE id = $1', [convId]);
      if (!owned.rows.length) return { blocked: 'CONVERSATION_NOT_FOUND' };
    } else {
      const created = await c.query(
        `INSERT INTO conversations (user_id, tenant_id, model_used, title)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [user.id, user.tenant_id, model || config.defaultModel, prompt.slice(0, 60)],
      );
      convId = created.rows[0].id;
    }

    const hist = await c.query(
      `SELECT sender_role, content FROM messages
        WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [convId, HISTORY_LIMIT],
    );
    const history = [];
    for (const row of hist.rows.reverse()) {
      history.push({ role: row.sender_role, content: await decryptContent(row.content) });
    }
    return { conversationId: convId, history };
  });

  if (prep.blocked) {
    const status = prep.blocked === 'CONVERSATION_NOT_FOUND' ? 404 : 402;
    throw new HttpError(status, prep.blocked, budgetMessage(prep.blocked));
  }

  // 4. Model call (no DB transaction held here).
  const messages = buildMessages({ supervised, userPrompt: prompt, history: prep.history });
  let result;
  try {
    result = await complete({ model, messages });
  } catch (err) {
    if (err instanceof LlmError) throw new HttpError(err.status, err.code, err.message);
    throw err;
  }

  // 5. Persist both turns (encrypted) + record usage atomically.
  await withUser(user, async (c) => {
    const encUser = await encryptContent(prompt);
    const encAssistant = await encryptContent(result.content);
    await c.query(
      'INSERT INTO messages (conversation_id, sender_role, content, tokens_used) VALUES ($1, $2, $3, 0)',
      [prep.conversationId, 'user', encUser],
    );
    await c.query(
      'INSERT INTO messages (conversation_id, sender_role, content, tokens_used) VALUES ($1, $2, $3, $4)',
      [prep.conversationId, 'assistant', encAssistant, result.tokensUsed],
    );
    await c.query('UPDATE conversations SET updated_at = NOW(), model_used = $2 WHERE id = $1',
      [prep.conversationId, result.modelUsed]);
    await recordUsage(c, {
      tenantId: user.tenant_id, groupId: user.group_id, userId: user.id,
      tokensUsed: result.tokensUsed, model: result.modelUsed, wasFlagged: false,
    });
  });

  res.json({
    conversationId: prep.conversationId,
    reply: result.content,
    tokensUsed: result.tokensUsed,
    model: result.modelUsed,
  });
}));

// List the caller's own conversations (RLS guarantees ownership).
router.get('/conversations', asyncHandler(async (req, res) => {
  const rows = await withUser(req.user, (c) => c.query(
    `SELECT id, title, model_used, created_at, updated_at
       FROM conversations ORDER BY updated_at DESC LIMIT 100`,
  ));
  res.json({ conversations: rows.rows });
}));

// Fetch decrypted messages for one of the caller's conversations.
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const out = await withUser(req.user, async (c) => {
    const owned = await c.query('SELECT id FROM conversations WHERE id = $1', [req.params.id]);
    if (!owned.rows.length) return null;
    const rows = await c.query(
      `SELECT sender_role, content, tokens_used, created_at FROM messages
        WHERE conversation_id = $1 ORDER BY created_at`,
      [req.params.id],
    );
    const messages = [];
    for (const r of rows.rows) {
      messages.push({
        role: r.sender_role,
        content: await decryptContent(r.content),
        tokensUsed: r.tokens_used,
        createdAt: r.created_at,
      });
    }
    return messages;
  });
  if (out === null) throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'No such conversation');
  res.json({ messages: out });
}));

function budgetMessage(reason) {
  switch (reason) {
    case 'POOL_EXHAUSTED': return 'Your workspace has used its token pool for this period.';
    case 'GROUP_EXHAUSTED': return 'This classroom/group has used its allocated credits.';
    case 'USER_CAP_REACHED': return 'You have reached your personal usage cap for this period.';
    case 'CONVERSATION_NOT_FOUND': return 'That conversation does not exist.';
    default: return 'Request cannot be completed.';
  }
}

export default router;
