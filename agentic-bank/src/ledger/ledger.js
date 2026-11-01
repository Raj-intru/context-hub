// Double-entry ledger.
//
// The agent layer never reaches this module. Every path into it runs through
// the kernel (src/kernel/), and the ledger itself enforces the invariants that
// hold no matter what any policy says:
//
//   1. Every transaction balances to zero, per currency.
//   2. Postings are append-only. Corrections are new postings, never edits.
//   3. No account goes past its available balance (balance + overdraft - holds)
//      unless it is explicitly a bank-internal account.
//   4. Every write carries an idempotency key, so a retried instruction is not
//      a second payment.

import {
  add, assertMoney, compare, format, formatWithCurrency, minor, money,
  subtract, zero, isPositive,
} from './money.js';
import { newId } from '../util/ids.js';

export class LedgerError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.details = details;
  }
}

/** Which side increases this account's balance. */
const NORMAL_SIDE = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
};

export const ACCOUNT_TYPES = Object.keys(NORMAL_SIDE);

export function createLedger({ store, clock }) {
  /** Signed delta this posting applies to the account's balance. */
  function signedDelta(account, direction, amount) {
    const normal = NORMAL_SIDE[account.type];
    return direction === normal ? minor(amount) : -minor(amount);
  }

  async function readBalanceRow(tx, accountId) {
    const row = await tx.get('balances', accountId);
    if (!row) throw new LedgerError(`No balance row for ${accountId}`, 'LEDGER_NO_BALANCE');
    return row;
  }

  async function activeHoldTotal(tx, accountId, currency) {
    const holds = await tx.find('holds', { accountId, status: 'active' });
    let total = zero(currency);
    for (const h of holds) total = add(total, h.amount);
    return total;
  }

  /** balance + overdraft - active holds. */
  function availableFrom({ balanceMinor, currency, overdraftLimit, holdTotal }) {
    const cleared = money(balanceMinor, currency);
    return subtract(add(cleared, overdraftLimit), holdTotal);
  }

  return {
    async openAccount({
      id = newId('account'),
      entityId,
      name,
      type,
      currency,
      purpose = 'customer_deposit',
      overdraftLimit = null,
      enforceFunds = true,
      status = 'active',
      metadata = {},
    }) {
      if (!NORMAL_SIDE[type]) {
        throw new LedgerError(`Unknown account type: ${type}`, 'LEDGER_BAD_ACCOUNT_TYPE');
      }
      const limit = overdraftLimit ?? zero(currency);
      assertMoney(limit);
      if (limit.currency !== currency) {
        throw new LedgerError('Overdraft limit currency must match the account', 'CURRENCY_MISMATCH');
      }

      return store.withTransaction(async (tx) => {
        const account = {
          id, entityId, name, type, currency, purpose,
          overdraftLimit: limit, enforceFunds, status, metadata,
          openedAt: clock.now().toISOString(),
        };
        await tx.insert('accounts', account);
        await tx.insert('balances', { id, accountId: id, currency, balanceMinor: '0' });
        return account;
      });
    },

    async getAccount(accountId) {
      return store.get('accounts', accountId);
    },

    async listAccounts(entityId) {
      return store.find('accounts', { entityId });
    },

    async setAccountStatus(accountId, status) {
      if (!['active', 'frozen', 'closed'].includes(status)) {
        throw new LedgerError(`Unknown account status: ${status}`, 'LEDGER_BAD_STATUS');
      }
      return store.withTransaction((tx) => tx.update('accounts', accountId, { status }));
    },

    async getBalance(accountId) {
      const account = await store.get('accounts', accountId);
      if (!account) throw new LedgerError(`No account ${accountId}`, 'LEDGER_NO_ACCOUNT');
      const row = await store.get('balances', accountId);
      const holds = await store.find('holds', { accountId, status: 'active' });
      let holdTotal = zero(account.currency);
      for (const h of holds) holdTotal = add(holdTotal, h.amount);
      const cleared = money(row.balanceMinor, account.currency);
      return {
        accountId,
        currency: account.currency,
        cleared,
        holds: holdTotal,
        overdraftLimit: account.overdraftLimit,
        available: availableFrom({
          balanceMinor: row.balanceMinor,
          currency: account.currency,
          overdraftLimit: account.overdraftLimit,
          holdTotal,
        }),
      };
    },

    /**
     * Post a balanced set of entries.
     *
     * `entries` is `[{ accountId, direction: 'debit'|'credit', amount, narrative }]`.
     * The whole set succeeds or none of it does.
     */
    async post({
      idempotencyKey,
      reference,
      type = 'transfer',
      valueDate = null,
      entries,
      metadata = {},
    }) {
      if (!idempotencyKey) {
        throw new LedgerError('Every posting needs an idempotency key', 'LEDGER_NO_IDEMPOTENCY');
      }
      if (!Array.isArray(entries) || entries.length < 2) {
        throw new LedgerError('A transaction needs at least two entries', 'LEDGER_TOO_FEW_ENTRIES');
      }

      return store.withTransaction(async (tx) => {
        const existing = await tx.findOne('transactions', { idempotencyKey });
        if (existing) return { transaction: existing, replayed: true };

        // 1. Balance check, per currency.
        const totals = new Map();
        for (const entry of entries) {
          if (!['debit', 'credit'].includes(entry.direction)) {
            throw new LedgerError(`Bad direction: ${entry.direction}`, 'LEDGER_BAD_DIRECTION');
          }
          assertMoney(entry.amount);
          if (!isPositive(entry.amount)) {
            throw new LedgerError(
              'Entry amounts must be positive; use the direction to express sign',
              'LEDGER_NON_POSITIVE_ENTRY',
            );
          }
          const current = totals.get(entry.amount.currency) ?? {
            debit: zero(entry.amount.currency),
            credit: zero(entry.amount.currency),
          };
          current[entry.direction] = add(current[entry.direction], entry.amount);
          totals.set(entry.amount.currency, current);
        }
        for (const [currency, { debit, credit }] of totals) {
          if (compare(debit, credit) !== 0) {
            throw new LedgerError(
              `Unbalanced in ${currency}: debits ${format(debit)} vs credits ${format(credit)}`,
              'LEDGER_UNBALANCED',
              { currency, debit, credit },
            );
          }
        }

        // 2. Resolve accounts and accumulate the net effect on each.
        const touched = new Map();
        for (const entry of entries) {
          const account = await tx.get('accounts', entry.accountId);
          if (!account) {
            throw new LedgerError(`No account ${entry.accountId}`, 'LEDGER_NO_ACCOUNT', {
              accountId: entry.accountId,
            });
          }
          if (account.currency !== entry.amount.currency) {
            throw new LedgerError(
              `Account ${account.id} is ${account.currency}; entry is ${entry.amount.currency}`,
              'CURRENCY_MISMATCH',
              { accountId: account.id },
            );
          }
          if (account.status === 'closed') {
            throw new LedgerError(`Account ${account.id} is closed`, 'LEDGER_ACCOUNT_CLOSED', {
              accountId: account.id,
            });
          }
          if (account.status === 'frozen' && !metadata.allowFrozen) {
            throw new LedgerError(`Account ${account.id} is frozen`, 'LEDGER_ACCOUNT_FROZEN', {
              accountId: account.id,
            });
          }
          const state = touched.get(account.id) ?? { account, delta: 0n };
          state.delta += signedDelta(account, entry.direction, entry.amount);
          touched.set(account.id, state);
        }

        // 3. Funds check on the accounts that are decreasing.
        for (const [accountId, { account, delta }] of touched) {
          if (delta >= 0n || !account.enforceFunds) continue;
          const row = await readBalanceRow(tx, accountId);
          const holdTotal = await activeHoldTotal(tx, accountId, account.currency);
          const availableAfter = availableFrom({
            balanceMinor: (BigInt(row.balanceMinor) + delta).toString(),
            currency: account.currency,
            overdraftLimit: account.overdraftLimit,
            holdTotal,
          });
          if (minor(availableAfter) < 0n) {
            throw new LedgerError(
              `Insufficient available funds on ${accountId}: short by ${formatWithCurrency(
                money(-minor(availableAfter), account.currency),
              )}`,
              'LEDGER_INSUFFICIENT_FUNDS',
              { accountId, shortfall: money(-minor(availableAfter), account.currency) },
            );
          }
        }

        // 4. Write. Postings are inserted, never updated.
        const now = clock.now().toISOString();
        const transactionId = newId('transaction');
        const transaction = {
          id: transactionId,
          idempotencyKey,
          reference: reference ?? transactionId,
          type,
          postedAt: now,
          valueDate: valueDate ?? now.slice(0, 10),
          currencies: [...totals.keys()],
          metadata,
        };
        await tx.insert('transactions', transaction);

        let sequence = 0;
        for (const entry of entries) {
          sequence += 1;
          await tx.insert('postings', {
            id: newId('posting'),
            transactionId,
            sequence,
            accountId: entry.accountId,
            direction: entry.direction,
            amount: entry.amount,
            narrative: entry.narrative ?? reference ?? type,
            postedAt: now,
            valueDate: transaction.valueDate,
          });
        }

        for (const [accountId, { delta }] of touched) {
          const row = await readBalanceRow(tx, accountId);
          await tx.update('balances', accountId, {
            balanceMinor: (BigInt(row.balanceMinor) + delta).toString(),
          });
        }

        return { transaction, replayed: false };
      });
    },

    /** Reduce available balance without moving money (card auth, payment in flight). */
    async placeHold({ accountId, amount, reference, expiresAt = null, metadata = {} }) {
      assertMoney(amount);
      if (!isPositive(amount)) {
        throw new LedgerError('A hold must be positive', 'LEDGER_NON_POSITIVE_HOLD');
      }
      return store.withTransaction(async (tx) => {
        const account = await tx.get('accounts', accountId);
        if (!account) throw new LedgerError(`No account ${accountId}`, 'LEDGER_NO_ACCOUNT');
        if (account.currency !== amount.currency) {
          throw new LedgerError('Hold currency must match the account', 'CURRENCY_MISMATCH');
        }
        if (account.status !== 'active') {
          throw new LedgerError(`Account ${accountId} is ${account.status}`, 'LEDGER_ACCOUNT_FROZEN');
        }

        const row = await readBalanceRow(tx, accountId);
        const holdTotal = await activeHoldTotal(tx, accountId, account.currency);
        const available = availableFrom({
          balanceMinor: row.balanceMinor,
          currency: account.currency,
          overdraftLimit: account.overdraftLimit,
          holdTotal,
        });
        if (account.enforceFunds && compare(available, amount) < 0) {
          throw new LedgerError(
            `Insufficient available funds to hold ${formatWithCurrency(amount)}`,
            'LEDGER_INSUFFICIENT_FUNDS',
            { accountId, available },
          );
        }

        const hold = {
          id: newId('hold'),
          accountId,
          amount,
          reference,
          status: 'active',
          placedAt: clock.now().toISOString(),
          expiresAt,
          metadata,
        };
        await tx.insert('holds', hold);
        return hold;
      });
    },

    async releaseHold(holdId) {
      return store.withTransaction(async (tx) => {
        const hold = await tx.get('holds', holdId);
        if (!hold) throw new LedgerError(`No hold ${holdId}`, 'LEDGER_NO_HOLD');
        if (hold.status !== 'active') return hold;
        return tx.update('holds', holdId, {
          status: 'released',
          releasedAt: clock.now().toISOString(),
        });
      });
    },

    /** Mark a hold as settled. The caller posts the matching transaction. */
    async captureHold(holdId, transactionId) {
      return store.withTransaction(async (tx) => {
        const hold = await tx.get('holds', holdId);
        if (!hold) throw new LedgerError(`No hold ${holdId}`, 'LEDGER_NO_HOLD');
        if (hold.status !== 'active') {
          throw new LedgerError(`Hold ${holdId} is ${hold.status}`, 'LEDGER_HOLD_NOT_ACTIVE');
        }
        return tx.update('holds', holdId, {
          status: 'captured',
          capturedAt: clock.now().toISOString(),
          transactionId,
        });
      });
    },

    async getStatement(accountId, { limit = 50 } = {}) {
      const postings = await store.find('postings', { accountId });
      postings.sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0));
      return postings.slice(0, limit);
    },

    async getTransaction(transactionId) {
      const transaction = await store.get('transactions', transactionId);
      if (!transaction) return null;
      const postings = await store.find('postings', { transactionId });
      postings.sort((a, b) => a.sequence - b.sequence);
      return { ...transaction, postings };
    },

    /**
     * Integrity check: recompute an account's balance from its postings and
     * compare with the cached row. Used by the test suite and by the
     * /admin/integrity endpoint. A mismatch means the cache and the journal
     * disagree, which is the one failure a ledger must never hide.
     */
    async verifyBalance(accountId) {
      const account = await store.get('accounts', accountId);
      if (!account) throw new LedgerError(`No account ${accountId}`, 'LEDGER_NO_ACCOUNT');
      const postings = await store.find('postings', { accountId });
      let computed = 0n;
      for (const p of postings) computed += signedDelta(account, p.direction, p.amount);
      const row = await store.get('balances', accountId);
      const cached = BigInt(row.balanceMinor);
      return {
        accountId,
        ok: computed === cached,
        computed: money(computed, account.currency),
        cached: money(cached, account.currency),
        postings: postings.length,
      };
    },

    /** Every transaction in the book balances. O(n) — admin/report use only. */
    async verifyJournal() {
      const transactions = await store.all('transactions');
      const failures = [];
      for (const transaction of transactions) {
        const postings = await store.find('postings', { transactionId: transaction.id });
        const totals = new Map();
        for (const p of postings) {
          const t = totals.get(p.amount.currency) ?? { debit: 0n, credit: 0n };
          t[p.direction] += minor(p.amount);
          totals.set(p.amount.currency, t);
        }
        for (const [currency, { debit, credit }] of totals) {
          if (debit !== credit) {
            failures.push({ transactionId: transaction.id, currency, debit: debit.toString(), credit: credit.toString() });
          }
        }
      }
      return { ok: failures.length === 0, transactions: transactions.length, failures };
    },
  };
}
