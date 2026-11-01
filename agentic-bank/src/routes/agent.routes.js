import { Router } from 'express';
import { handler } from '../middleware/errors.js';
import { requireEntityMatch } from '../middleware/auth.js';

export function agentRoutes({ bank }) {
  const router = Router();

  /**
   * The agentic endpoint. The mobile app is a client of this, not of a
   * separate screen-shaped API — which is what makes this an agent-first bank
   * rather than a bank with an agent bolted on.
   */
  router.post('/turns', requireEntityMatch, handler(async (req, res) => {
    const { message, history = [], sessionId = null } = req.body ?? {};
    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: '`message` is required' });
    }
    const result = await bank.agent.runTurn({
      entityId: req.entityId,
      actor: req.identity.actor,
      message,
      history,
      sessionId,
    });
    return res.json({
      turnId: result.turn.id,
      reply: result.turn.reply,
      stoppedBecause: result.turn.stoppedBecause,
      steps: result.turn.steps,
      capabilitiesInScope: result.scope.capabilityIds,
      model: result.turn.model,
      provider: result.turn.provider,
    });
  }));

  /**
   * The agent-to-agent surface: what a customer's OWN agent needs to call the
   * bank directly. Served from the same registry as the bank's agent uses, so
   * the two can never drift.
   */
  router.get('/capabilities', handler(async (req, res) => {
    const entity = await bank.store.get('entities', req.identity.entityId);
    if (!entity) return res.status(404).json({ error: 'ENTITY_NOT_FOUND' });

    const scope = await bank.agent.scopeTools({
      entityId: entity.id,
      actor: req.identity.actor,
      segment: entity.segment,
    });

    return res.json({
      segment: entity.segment,
      // What the segment offers, and separately what this caller may use. Two
      // different questions, answered separately on purpose.
      catalogue: bank.registry.catalogue({ segment: entity.segment }),
      inScopeForYou: scope.capabilityIds,
      mandates: scope.mandates.map((m) => ({
        id: m.id,
        label: m.label,
        autonomy: m.autonomy,
        capabilities: m.capabilities,
        accounts: m.accounts,
      })),
      toolDefinitions: scope.tools,
      conventions: {
        amounts: 'Decimal strings with the currency\'s exact minor-unit precision, e.g. "1250.00".',
        idempotency: 'Mutating calls require an Idempotency-Key header.',
        outcomes: ['executed', 'pending_approval', 'denied'],
        note:
          'A 200 does not mean money moved. Read `status`. `pending_approval` means a human '
          + 'has not yet approved and nothing has settled.',
      },
    });
  }));

  return router;
}
