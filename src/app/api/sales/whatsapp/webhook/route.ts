import { connectDb } from "@/lib/db/mongoose";
import { applyStatuses, recordReplies } from "@/lib/sales/outreach-engine";
import { loadCredentials } from "@/lib/sales/settings";
import { parseWebhook, verifySignature } from "@/lib/sales/whatsapp";

/**
 * Meta telling us what became of a message, and what came back.
 *
 * **Public by necessity**, like the Shopify webhook next door — Meta has no
 * session with us — so the signature is the whole of the authentication. It is
 * signed over the raw bytes, which is why the body is read as text and only
 * then parsed. With no app secret stored the post is refused: accepting
 * unverified traffic would let anybody write "replies" into the inbox.
 *
 * Always 200 once the signature is good, whatever the payload held. Meta
 * retries anything else with growing delays and eventually stops delivering,
 * and a template-status notification this application does not care about is
 * not a failure.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    await connectDb();
    const settings = await loadCredentials();

    if (!settings.whatsappAppSecret) return new Response("not configured", { status: 401 });
    if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), settings.whatsappAppSecret)) {
      return new Response("bad signature", { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return Response.json({ ok: true, ignored: "not json" });
    }

    const { statuses, inbound } = parseWebhook(payload, settings.whatsappPhoneNumberId);
    const updated = await applyStatuses(statuses);
    const filed = await recordReplies(inbound);

    return Response.json({ ok: true, statuses: updated, replies: filed });
  } catch (error) {
    // A 500 has Meta retry, which is right for a transient database problem.
    console.error("WhatsApp webhook failed", error);
    return new Response("error", { status: 500 });
  }
}

/**
 * Meta's one-time handshake when the address is registered: it sends the
 * verify token and a challenge, and expects the challenge echoed back if the
 * token matches the one typed into the panel.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  await connectDb();
  const settings = await loadCredentials();
  const expected = settings.whatsappVerifyToken;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}
