// The bank's own accounts.
//
// Double-entry means every customer movement needs a bank-side leg: a clearing
// account for outbound payments, a nostro for cross-border, fee income, an FX
// position account. These are ordinary ledger accounts owned by the bank entity
// with `enforceFunds: false`, because the bank's clearing account legitimately
// runs an intraday position.

export const BANK_ENTITY_ID = 'ent_bank';

export class BankAccountError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BankAccountError';
    this.code = code;
  }
}

export async function resolveBankAccount(store, { purpose, currency }) {
  const [account] = (await store.find('accounts', { entityId: BANK_ENTITY_ID, purpose, currency }));
  if (!account) {
    throw new BankAccountError(
      `The bank has no ${purpose} account in ${currency}`,
      'BANK_ACCOUNT_MISSING',
    );
  }
  return account;
}
