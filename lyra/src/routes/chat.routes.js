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
import { rateLimit } from '../middleware/rateLimit.js';
import { isSupervised } from '../domain/roles.js';
import { moderate, moderateImages } from '../services/moderation.js';
import { complete, LlmError } from '../services/llm.js';
import { buildMessages } from '../services/prompts.js';
import { retrieve, formatContext } from '../services/retrieval.js';
import { chooseModel } from '../services/router.js';
import { resolveGateway } from '../services/gateway.js';
import { LIBRARY_TENANT_ID } from '../domain/library.js';
import { checkBudget, recordUsage } from '../services/tokens.js';
import { encryptContent, decryptContent } from '../crypto/content.js';
import config from '../config.js';

const router = Router();
router.use(requireAuth);

const HISTORY_LIMIT = 20;

const chatLimiter = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'chat' });

router.post('/chat', chatLimiter, asyncHandler(async (req, res) => {
  const user = req.user;
  const { prompt, model: requestedModel, conversationId } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new HttpError(400, 'EMPTY_PROMPT', 'A non-empty prompt is required');
  }
  if (prompt.length > 12_000) {
    throw new HttpError(413, 'PROMPT_TOO_LONG', 'Prompt exceeds the maximum length');
  }

  const attachments = validateAttachments(req.body?.attachments);
  const needsVision = attachments.length > 0;

  const supervised = isSupervised(user.role);
  // Modality-aware OSS<->paid routing: a vision-capable model when an image is
  // attached; cheap OSS for supervised/simple, frontier paid for complex adult
  // prompts. Supervised accounts are LOCKED to the routed model (router.js).
  const { model } = chooseModel({ role: user.role, prompt, requestedModel, supervised, needsVision });

  // 1. Moderation for supervised accounts (fails closed by default) — both the
  // text prompt AND any attached images.
  if (supervised) {
    const verdict = await moderate(prompt);
    const imgVerdict = needsVision ? await moderateImages(attachments) : { flagged: false };
    if (verdict.flagged || imgVerdict.flagged) {
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

    // Does this workspace have its own knowledge base? (RLS-scoped to tenant.)
    const kb = await c.query('SELECT 1 FROM knowledge_sources LIMIT 1');
    // A supervised child may also have selected shared curriculum packs.
    let childCtx = null;
    if (supervised) {
      const cc = await c.query(
        'SELECT scope_keys, enabled_source_ids FROM child_context WHERE child_user_id = $1', [user.id]);
      childCtx = cc.rows[0] || null;
    }
    return { conversationId: convId, history, familyHasKB: kb.rows.length > 0, childCtx };
  });

  if (prep.blocked) {
    const status = prep.blocked === 'CONVERSATION_NOT_FOUND' ? 404 : 402;
    throw new HttpError(status, prep.blocked, budgetMessage(prep.blocked));
  }

  // 3b. Grounded retrieval (outside a held transaction). Merge the workspace's
  // own sources with any shared curriculum packs the child has selected, then
  // gate to the most relevant — or refuse if nothing is in scope.
  let grounding = null;
  let citations = [];
  const scopeKeys = prep.childCtx?.scope_keys || [];
  const sourceIds = prep.childCtx?.enabled_source_ids || null;
  if (prep.familyHasKB || scopeKeys.length) {
    const hits = [];
    if (prep.familyHasKB) {
      const r = await withUser(user, (c) => retrieve(c, { query: prompt, sourceIds }));
      hits.push(...r.hits);
    }
    if (scopeKeys.length) {
      const r = await withUser({ ...user, tenant_id: LIBRARY_TENANT_ID }, (c) => retrieve(c, { query: prompt, scopeKeys }));
      hits.push(...r.hits);
    }
    hits.sort((a, b) => a.distance - b.distance);
    const fmt = formatContext(hits.slice(0, 5));
    grounding = { sources: fmt.sources, inScope: fmt.citations.length > 0 };
    citations = fmt.citations;
  }

  // 4. Model call (no DB transaction held here). Routed through the tenant's
  // gateway ("universal key") so provider keys never live in this process, and
  // a BYOK tenant can be mapped to its own in-region gateway.
  const messages = buildMessages({ supervised, userPrompt: prompt, history: prep.history, grounding, attachments });
  const { baseUrl, apiKey } = resolveGateway(user.tenant_id);
  let result;
  try {
    result = await complete({ model, messages, baseUrl, apiKey });
  } catch (err) {
    if (err instanceof LlmError) throw new HttpError(err.status, err.code, err.message);
    throw err;
  }

  // 4b. OUTPUT moderation for supervised accounts (fails closed, like input).
  // The model was already called, so we still account the token spend, but a
  // flagged answer is never shown to or stored for a minor — it is replaced by
  // a safe message and the event is marked flagged for the admin dashboard.
  let replyContent = result.content;
  let outputFlagged = false;
  if (supervised) {
    const outVerdict = await moderate(result.content);
    if (outVerdict.flagged) {
      outputFlagged = true;
      replyContent = SAFE_OUTPUT_REPLACEMENT;
      citations = [];
    }
  }

  // 5. Persist both turns (encrypted) + record usage atomically.
  await withUser(user, async (c) => {
    const encUser = await encryptContent(prompt);
    const encAssistant = await encryptContent(replyContent);
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
      tokensUsed: result.tokensUsed, model: result.modelUsed, wasFlagged: outputFlagged,
    });
  });

  res.json({
    conversationId: prep.conversationId,
    reply: replyContent,
    blocked: outputFlagged || undefined,
    tokensUsed: result.tokensUsed,
    model: result.modelUsed,
    citations,
  });
}));

// Shown to a minor when the model's own answer trips the safety filter.
const SAFE_OUTPUT_REPLACEMENT =
  "I can't share that response. Let's keep things school-appropriate — try " +
  'asking a different way, or check with a teacher or parent.';

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

// Validate + normalize image attachments. Accepts [{ url }] where url is a
// data: image URL (inline upload) or an https image URL. Caps the count; throws
// a clean 4xx on anything malformed.
function validateAttachments(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'BAD_ATTACHMENTS', 'attachments must be an array');
  if (raw.length > config.maxAttachments) {
    throw new HttpError(413, 'TOO_MANY_ATTACHMENTS', `At most ${config.maxAttachments} images per message`);
  }
  return raw.map((a) => {
    const url = typeof a === 'string' ? a : a?.url;
    if (typeof url !== 'string' || !url) {
      throw new HttpError(400, 'BAD_ATTACHMENTS', 'each attachment needs a url');
    }
    const ok = /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(url) || /^https:\/\//i.test(url);
    if (!ok) throw new HttpError(400, 'BAD_ATTACHMENTS', 'attachment url must be an https or data:image URL');
    return { url };
  });
}

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
