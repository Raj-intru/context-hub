# Privacy Notice — TEMPLATE (not legal advice)

> ⚠️ **Drafting template, not a finished legal document.** Review with counsel.
> Every statement below must match your real configuration and contracts. It
> deliberately avoids the inaccurate claims in the original material (e.g. an
> unqualified "zero-training guarantee"); see `docs/COMPLIANCE.md`.

_Last updated: [DATE] · Controller: [LEGAL ENTITY]._

## 1. What we collect
- **Account data:** name, email, role, workspace/group membership.
- **Conversation content:** the prompts you submit and the AI responses,
  retained so you can resume chats.
- **Usage metadata:** token counts, model used, timestamps, and whether a
  supervised message was blocked by moderation (no message text is stored in
  these aggregates).
- **Billing data:** handled by Stripe; we receive limited billing metadata, not
  your card number.

## 2. How your content is protected
- Conversation content is **encrypted at rest** using AES-256-GCM.
- Access is **isolated per user** using database Row-Level Security. Workspace
  administrators (parents, teachers, IT admins) can view **usage totals only**,
  and cannot read the content of other members' conversations through the
  Service.

## 3. AI processing and model training
- Prompts from supervised accounts are first sent to a **content-moderation
  service** ([OpenAI]) and, if permitted, to a **model provider** (via
  OpenRouter). These are separate processors with their own terms.
- Whether your content may be used to improve third-party models depends on the
  **provider terms we rely on**. We configure providers to use API/enterprise
  data terms that restrict training on your content where such terms are offered;
  we identify the providers and link their terms at [LINK]. We do not promise
  behaviour we cannot control on a provider's behalf.

## 4. Retention and deletion
- We retain conversation content for [RETENTION PERIOD] and then [DELETE/ANONYMIZE].
- You may request export or deletion of your data at [CONTACT]; deleting an
  account removes its conversations. [Implement the export/delete path before
  publishing this section — see the SECURITY/COMPLIANCE to-dos.]

## 5. Children's privacy
- Accounts for minors are created by an authorized adult (a parent/guardian, or a
  school). We rely on that adult's consent/authority.
- We do not sell personal information, do not use children's content for
  advertising, and apply content moderation to supervised accounts.
- Parents/guardians and (where applicable) schools may review usage, and request
  access to or deletion of a child's data at [CONTACT].

## 6. Subprocessors
We share data with the processors necessary to run the Service (model routing,
moderation, payments, email, hosting). Current list: [LINK]. We maintain data
processing agreements with them.

## 7. Your rights and contact
Depending on your location you may have rights to access, correct, delete, or
port your data, or to object to processing. Contact [EMAIL/ADDRESS/DPO].
