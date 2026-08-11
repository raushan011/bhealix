import { couponFor } from "./coupons";
import { loadSettings, rulesOf } from "./settings";

/**
 * The codes a new rep is given.
 *
 * Built from the rules that are switched on, rather than from a hard-coded pair,
 * so adding a third commission rule means the next rep is issued three codes
 * without anybody editing a route. The two that exist today produce exactly what
 * the operation already uses: RAUSHAN10 and RAUSHAN30.
 */
export async function couponsFor(repCode: string) {
  const settings = await loadSettings();
  return rulesOf(settings)
    .filter(rule => rule.active)
    .map(rule => ({ code: couponFor(repCode, rule.suffix), suffix: rule.suffix, active: true, note: rule.label }));
}
