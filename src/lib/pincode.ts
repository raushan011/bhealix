/**
 * The city and state an Indian pin code belongs to — what Shiprocket fills in
 * the moment a pin code is typed into its own order form, done here for ours.
 *
 * Shiprocket's lookup first, because its answer is the one the courier booking
 * will be checked against; India Post's public directory when Shiprocket has no
 * entry or does not answer. Kept in memory once found: a pin code's state does
 * not change, and the same few hundred pin codes are asked for all day.
 */

export type PincodePlace = { pinCode: string; city: string; state: string };

const SHIPROCKET = "https://apiv2.shiprocket.in/v1/external/open/postcode/details";
const INDIA_POST = "https://api.postalpincode.in/pincode";
const TIMEOUT = 4000;
const CACHE_LIMIT = 5000;

const cache = new Map<string, PincodePlace | null>();

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal, cache: "no-store" });
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fromShiprocket(pinCode: string): Promise<PincodePlace | null> {
  const data = await getJson<{ postcode_details?: { city?: string; state?: string } }>(`${SHIPROCKET}?postcode=${pinCode}`);
  const city = data?.postcode_details?.city?.trim();
  const state = data?.postcode_details?.state?.trim();
  return city && state ? { pinCode, city, state } : null;
}

async function fromIndiaPost(pinCode: string): Promise<PincodePlace | null> {
  const data = await getJson<{ Status?: string; PostOffice?: { District?: string; State?: string }[] | null }[]>(`${INDIA_POST}/${pinCode}`);
  const office = data?.[0]?.Status === "Success" ? data[0].PostOffice?.[0] : undefined;
  const city = office?.District?.trim();
  const state = office?.State?.trim();
  return city && state ? { pinCode, city, state } : null;
}

/** The place for a six-digit pin code, or null when neither directory knows it. */
export async function lookupPincode(pin: string): Promise<PincodePlace | null> {
  const pinCode = String(pin ?? "").trim();
  if (!/^[1-9]\d{5}$/.test(pinCode)) return null;
  if (cache.has(pinCode)) return cache.get(pinCode) ?? null;

  const place = await fromShiprocket(pinCode) ?? await fromIndiaPost(pinCode);
  // A miss is remembered too, but only once both directories have answered —
  // a timeout must not turn into "no such pin code" for the rest of the day.
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  if (place) cache.set(pinCode, place);
  return place;
}
