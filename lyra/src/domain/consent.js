// Consent text + version for provisioning a minor (child/student) account.
// Bump CONSENT_TEXT_VERSION whenever the wording materially changes so that
// prior consents remain distinguishable and can be re-collected if needed.

export const CONSENT_TYPE_MINOR = 'minor_provisioning';
export const CONSENT_TEXT_VERSION = 'minor-provisioning-v1';

export const CONSENT_TEXT = `I confirm I am authorized to consent to this minor's use of Lyra — `
  + `as a parent/guardian, or as a school acting in loco parentis under applicable law — `
  + `and I authorize the creation of a supervised account for them. I understand their `
  + `conversations are moderated and encrypted, and that I can see usage summaries but not `
  + `the content of their chats.`;
