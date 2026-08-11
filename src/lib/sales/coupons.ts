/**
 * Coupon codes, and how a code on an order becomes a person to pay.
 *
 * A rep is given two codes built from their own name and a number — RAUSHAN10
 * and RAUSHAN30. The number is not decoration: it says which commission rule
 * applies. Splitting a code into its rep part and its rule part is therefore the
 * whole of attribution, and it is done here, once, so the sync, the screens and
 * the tests cannot disagree about what RAUSHAN30 means.
 *
 * Pure on purpose — the browser validates a new rep's codes with the same
 * function the sync attributes orders with.
 */

/** Codes are compared upper-case with surrounding space gone; Shopify is not consistent about either. */
export const normaliseCode = (code: string) => code.trim().toUpperCase();

/**
 * A code is a name followed by digits. Anything else is somebody's seasonal
 * offer — DIWALI25, FREESHIP — and must not be read as a rep called DIWALI.
 * Those are left unattributed rather than guessed at.
 */
const CODE_SHAPE = /^([A-Z][A-Z0-9_.-]*?)(\d{1,3})$/;

export type ParsedCoupon = { repCode: string; suffix: string };

/** `"raushan30"` → `{ repCode: "RAUSHAN", suffix: "30" }`; anything unparseable → null. */
export function parseCoupon(code: string | null | undefined): ParsedCoupon | null {
  if (!code) return null;
  const match = CODE_SHAPE.exec(normaliseCode(code));
  if (!match) return null;
  return { repCode: match[1], suffix: match[2] };
}

/** The codes a rep holds, built from their own code and the rules in force. */
export const couponFor = (repCode: string, suffix: string) => `${normaliseCode(repCode)}${suffix}`;

/**
 * The rep code itself: letters and digits, no spaces, because it is half of a
 * coupon code that somebody has to read out over the phone.
 */
export const REP_CODE_SHAPE = /^[A-Z][A-Z0-9_.-]{1,23}$/;
export const isRepCode = (value: string) => REP_CODE_SHAPE.test(normaliseCode(value));

/**
 * Picks the rep's coupon out of everything applied to an order.
 *
 * A customer can stack a rep's code with a site-wide offer, and Shopify hands
 * back both. The first code that belongs to a known rep wins; the order of the
 * list is Shopify's, which is the order they were applied in.
 */
export function attributeOrder(codes: readonly string[], known: ReadonlyMap<string, string>): { code: string; repId: string } | null {
  for (const raw of codes) {
    const code = normaliseCode(raw);
    const repId = known.get(code);
    if (repId) return { code, repId };
  }
  return null;
}
