import { normaliseCode, REP_CODE_SHAPE } from "./coupons";

/**
 * The affiliate as somebody who signs in, rather than as a record somebody
 * typed.
 *
 * Until now a `SalesRep` was a row an administrator created: a name, a code and
 * whatever coupons had been handed out. This module is what turns that row into
 * an account — a stranger registers, waits to be approved, mints their own
 * coupon and watches what it brings in.
 *
 * Pure on purpose, for the reason the rest of this folder is: a coupon code
 * decides whose commission an order becomes, so the rules about what a rep may
 * call one are checked in the browser and again on the server by the same
 * function, and neither can drift.
 */

// -------------------------------------------------------------- the lifecycle

/**
 * Where a rep stands with the company, which is a different question from
 * `SalesRep.active`.
 *
 * `active` is the attribution switch an administrator has always had: off, and
 * the codes stop earning. This is the *account* — whether a person who filled in
 * the registration form has been let in at all.
 *
 * They are kept apart because they are decided by different people for different
 * reasons. An approved rep who has gone quiet is deactivated; a stranger who has
 * just registered is not "inactive", they are unexamined, and showing them in the
 * team list beside people who actually sell would be a lie the first time
 * somebody counted the row.
 *
 * `Pending`   — registered, nobody has looked yet. May sign in and see exactly
 *               that, and nothing else.
 * `Active`    — approved. May mint coupons, and their codes attribute orders.
 * `Rejected`  — turned away. Cannot sign in.
 * `Suspended` — was approved and no longer is. Cannot sign in. Everything they
 *               have already earned is untouched, because it was earned.
 */
export const REP_STATUSES = ["Pending", "Active", "Rejected", "Suspended"] as const;
export type RepStatus = (typeof REP_STATUSES)[number];

/**
 * A rep's standing, defaulting to `Active` when the field is absent.
 *
 * Every rep created before this feature existed was typed in by an administrator,
 * which *is* the approval — there was no other way for the record to appear.
 * Reading a missing status as `Pending` would have put the entire existing sales
 * team into an approvals queue on the morning of the deploy, and stopped their
 * codes earning until somebody clicked forty times.
 */
export const repStatusOf = (rep: { status?: string | null } | null | undefined): RepStatus =>
  (REP_STATUSES as readonly string[]).includes(rep?.status ?? "") ? (rep!.status as RepStatus) : "Active";

/**
 * Whether this account may hold a session at all.
 *
 * `Pending` deliberately can: somebody who has just registered should be able to
 * sign in and be told, in the portal, that they are waiting — otherwise the only
 * feedback they ever get is a login form refusing them, which reads as a wrong
 * password and produces a phone call.
 */
export const mayHoldSession = (status: RepStatus) => status === "Pending" || status === "Active";

/**
 * Whether this rep may mint a coupon and earn on it.
 *
 * Both halves have to be true, and they are separate checks because they mean
 * separate things: `status` is the account, `active` is the attribution switch.
 * Every route that creates a coupon or admits an order asks this one function,
 * so there is one answer rather than four that can disagree.
 */
export const mayTrade = (rep: { status?: string | null; active?: boolean } | null | undefined): boolean =>
  Boolean(rep) && repStatusOf(rep) === "Active" && rep!.active !== false;

/** Why the portal is refusing, in a sentence fit to put on the screen. */
export function refusalFor(status: RepStatus, active: boolean): string | null {
  if (status === "Pending") return "Your account is waiting to be approved. You will be able to create a coupon code as soon as somebody has looked at it.";
  if (status === "Rejected") return "This application was not accepted. Please contact the company if you think that is a mistake.";
  if (status === "Suspended") return "This account has been suspended. Anything already earned is unaffected — please contact the company.";
  if (!active) return "Your codes have been switched off, so new orders will not be attributed to you. Anything already earned is unaffected.";
  return null;
}

export function repStatusTone(status: RepStatus): "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "Active": return "success";
    case "Pending": return "warn";
    case "Rejected": case "Suspended": return "danger";
    default: return "neutral";
  }
}

// ------------------------------------------------------------ coupon provisioning

/**
 * Whether a coupon code exists where it has to exist to work: in Shopify.
 *
 * A code held here and not there is the failure this whole field is for. The
 * customer types it at the checkout, Shopify says "not a valid discount", and
 * the rep — who can see it sitting in their portal — is certain the company is
 * cheating them. Naming the state is what lets both screens say the same true
 * thing instead of both implying it works.
 *
 * `Live`          — Shopify has it. Codes an administrator typed in are this by
 *                   definition: they were typed in *because* they already existed.
 * `Awaiting setup` — reserved here, not created there. Shopify is not connected,
 *                   or the rule has no customer discount set, so there was
 *                   nothing to create. It attributes orders if one ever carries
 *                   it; it just cannot be used yet.
 * `Failed`        — Shopify was asked and refused. `setupError` says why.
 */
export const COUPON_SETUP_STATES = ["Live", "Awaiting setup", "Failed"] as const;
export type CouponSetupState = (typeof COUPON_SETUP_STATES)[number];

/**
 * A coupon's setup state, defaulting to `Live` when absent — for the same reason
 * `repStatusOf` defaults to `Active`. Every code on record before this feature
 * was entered by hand from Shopify's own discount list.
 */
export const couponSetupOf = (coupon: { setup?: string | null } | null | undefined): CouponSetupState =>
  (COUPON_SETUP_STATES as readonly string[]).includes(coupon?.setup ?? "") ? (coupon!.setup as CouponSetupState) : "Live";

/**
 * Whether a stored setup state has been overtaken by the shop's own answer.
 *
 * One-way on purpose. Shopify listing a code as live *proves* the setup
 * finished, whoever did it and however; Shopify not listing one proves nothing
 * — it may be paused, scheduled, past its end date, or simply on a page the
 * catalogue has not read yet. Marking a working code as broken on that evidence
 * would be a worse error than the stale row it set out to fix, and it would be
 * shown to the partner as "your code does not work".
 */
export const setupIsStale = (
  coupon: { setup?: string | null } | null | undefined,
  liveInShopify: boolean
) => liveInShopify && couponSetupOf(coupon) !== "Live";

export function couponSetupTone(state: CouponSetupState): "success" | "warn" | "danger" {
  switch (state) {
    case "Live": return "success";
    case "Awaiting setup": return "warn";
    case "Failed": return "danger";
  }
}

/** What a rep is told about a code that is not yet usable. */
export function couponSetupNote(state: CouponSetupState): string | null {
  if (state === "Awaiting setup") return "Reserved for you. It will not work at the checkout until the company finishes setting it up — orders already carrying it are still yours.";
  if (state === "Failed") return "The shop refused to create this code. The company has been told; it is still reserved for you in the meantime.";
  return null;
}

// -------------------------------------------------------------- registration

export const PASSWORD_MIN = 8;

/**
 * A rep code proposed from somebody's name: "Priya Sharma" → "PRIYA".
 *
 * Only a suggestion the form fills in — the person can type over it. It is their
 * first name where that is long enough to be distinctive, because the rep code is
 * the front half of every coupon they will ever read out over the telephone, and
 * "PRIYA30" survives that call in a way "PS30" does not.
 */
export function suggestRepCode(name: string): string {
  const words = normaliseCode(name).replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "";

  // Join words until there is enough to be worth saying; a two-letter first name
  // takes the surname with it rather than standing alone.
  let code = "";
  for (const word of words) {
    code += word;
    if (code.length >= 4) break;
  }

  // A code has to start with a letter — it is half of a discount code, and
  // Shopify's own codes may not begin with a digit either.
  return code.replace(/^[^A-Z]+/, "").slice(0, 24);
}

/** What is wrong with a proposed rep code, or null when nothing is. */
export function repCodeProblem(value: string): string | null {
  const code = normaliseCode(value);
  if (!code) return "Choose a code — it is the front half of every coupon you will be given.";
  if (code.length < 2) return "A code needs at least two characters.";
  if (code.length > 24) return "A code can be at most 24 characters.";
  if (!REP_CODE_SHAPE.test(code)) return "A code is letters and digits with no spaces, starting with a letter — like PRIYA.";
  return null;
}

/** What is wrong with a proposed password, or null when nothing is. */
export function passwordProblem(value: string): string | null {
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (value.length > 200) return "That password is too long.";
  // Deliberately no character-class rules. They push people towards Priya@123,
  // which is worse than a long ordinary phrase and much harder to type on the
  // phone this portal is mostly used from.
  if (!/[^0-9]/.test(value)) return "Use something other than digits alone.";
  return null;
}

// ---------------------------------------------------------- coupon generation

/** Nobody needs more codes than this, and an unbounded array is an unbounded document. */
export const MAX_COUPONS_PER_REP = 12;

/** How much a rep may add between their own code and the rule's digits. */
const MIDDLE_SHAPE = /^[A-Z]{0,12}$/;

/**
 * The code a rep gets when they ask for one under a given rule.
 *
 * `PRIYA` + rule `30` → `PRIYA30`. With a word of their own — a campaign, a
 * second code for a different audience — `PRIYA` + `KIT` + `30` → `PRIYAKIT30`.
 */
export const generatedCode = (repCode: string, suffix: string, middle = "") =>
  `${normaliseCode(repCode)}${normaliseCode(middle)}${suffix}`;

/**
 * Whether a rep may have the code they are asking for.
 *
 * Three rules, and each of them is load-bearing:
 *
 * 1. **It starts with their own rep code.** Without this a rep could mint
 *    `DIWALI30` — a code indistinguishable from the company's own campaign —
 *    and be paid commission on every order the marketing department's promotion
 *    brought in. This is the rule that makes self-service safe at all.
 * 2. **It ends with the rule's digits.** The suffix is what the code pays under.
 *    Stored on the coupon and authoritative, but a code whose letters disagree
 *    with its rule is one somebody will eventually read the wrong way.
 * 3. **The middle is letters only.** Digits there would move where
 *    `parseCoupon` splits the code, so `PRIYA20` + `30` would read as suffix
 *    `030`. Attribution uses the stored suffix and would survive it, but a code
 *    that does not describe itself is a trap left for the next reader.
 *
 * Uniqueness is not checked here — that is the database's job, and only the
 * database can answer it (§4.6).
 */
export function generatedCodeProblem(code: string, repCode: string, suffix: string): string | null {
  const value = normaliseCode(code);
  const owner = normaliseCode(repCode);

  if (!/^[A-Z][A-Z0-9]*$/.test(value)) return "A coupon code is letters and digits with no spaces or punctuation.";
  if (value.length > 32) return "A coupon code can be at most 32 characters.";
  if (!value.startsWith(owner)) return `Your codes have to start with ${owner}, so an order carrying one is unmistakably yours.`;
  if (!value.endsWith(suffix)) return `A code paying under this rule has to end in ${suffix}.`;

  const middle = value.slice(owner.length, value.length - suffix.length);
  if (!MIDDLE_SHAPE.test(middle)) return "Between your code and the rule's number, use up to 12 letters and nothing else.";

  return null;
}
