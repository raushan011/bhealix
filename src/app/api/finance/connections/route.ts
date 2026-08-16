import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { IntegrationError } from "@/lib/sales/http";
import { connectorFor } from "@/lib/finance/connectors";
import { clearCredentials, describeConnections, loadCredentials, recordTest, storeCredentials } from "@/lib/finance/connections";
import { CONNECTORS, type ConnectorKey } from "@/lib/finance/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isConnector = (value: unknown): value is ConnectorKey =>
  (CONNECTORS as readonly unknown[]).includes(value);

/**
 * The vendor API keys.
 *
 * Every route here is `manageFinance`, which is the super administrator alone.
 * These are live keys into accounts that hold money — a Razorpay secret reads
 * every payment this company has taken — and there is no reading of them that
 * belongs to the desk that raises invoices on doctors.
 */

/** What is stored, minus the secrets. They are never sent back to a browser. */
export async function GET() {
  try {
    const auth = await apiSession(can.viewFinance);
    if ("response" in auth) return auth.response;
    await connectDb();
    return ok({ connections: await describeConnections() });
  } catch (error) {
    return fail(error);
  }
}

const saveSchema = z.object({
  connector: z.string().refine(isConnector, "Unknown connector"),
  /** Whatever fields the connector declared. A blank secret means "leave it". */
  values: z.record(z.string(), z.string().max(500)),
  /** Save and immediately prove it works, which is what the button actually does. */
  test: z.boolean().optional()
});

/**
 * Saves a key, and usually tests it in the same breath.
 *
 * Testing after saving rather than before is deliberate: the test reads the
 * credentials back out of the database, so testing first would prove the *old*
 * key still worked while showing the new one on screen — the same trap the
 * affiliate settings screen fell into.
 */
export async function PUT(request: Request) {
  try {
    const auth = await apiSession(can.manageFinance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = saveSchema.parse(await request.json());


    await storeCredentials(input.connector, input.values, auth.session.userId);
    await record({
      actor: auth.session.userId,
      action: "finance.connection.updated",
      entityType: "FinanceConnection",
      entityId: input.connector,
      // Never the values. Which fields were touched is the useful part, and the
      // only part that is safe to keep.
      metadata: { connector: input.connector, fields: Object.keys(input.values) }
    });

    if (!input.test) return ok({ saved: true, connections: await describeConnections() });

    const outcome = await runTest(input.connector);
    return ok({ saved: true, ...outcome, connections: await describeConnections() });
  } catch (error) {
    return fail(error);
  }
}

/** Tests what is already stored, without saving anything. */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageFinance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { connector } = z.object({ connector: z.string().refine(isConnector) }).parse(await request.json());
    return ok({ ...await runTest(connector), connections: await describeConnections() });
  } catch (error) {
    return fail(error);
  }
}

/** Removes a vendor's key. */
export async function DELETE(request: Request) {
  try {
    const auth = await apiSession(can.manageFinance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const connector = new URL(request.url).searchParams.get("connector");
    if (!isConnector(connector)) return badRequest("Unknown connector");

    await clearCredentials(connector);
    await record({
      actor: auth.session.userId,
      action: "finance.connection.removed",
      entityType: "FinanceConnection",
      entityId: connector,
      metadata: { connector }
    });

    return ok({ removed: true, connections: await describeConnections() });
  } catch (error) {
    return fail(error);
  }
}

/**
 * One test, with its outcome written down.
 *
 * Recorded rather than only returned so the settings screen can say "last tested
 * on Tuesday, worked" on load — a key that stopped working three weeks ago is
 * otherwise invisible until somebody happens to press Fetch.
 */
async function runTest(key: ConnectorKey): Promise<{ ok: boolean; message: string }> {
  const connector = connectorFor(key);
  const credentials = await loadCredentials(key);

  if (!credentials) {
    const message = `Fill in every required field for ${connector.label} first.`;
    await recordTest(key, false, message);
    return { ok: false, message };
  }

  try {
    const message = await connector.test(credentials);
    await recordTest(key, true, message);
    return { ok: true, message };
  } catch (error) {
    // The vendor's own refusal, verbatim. "Razorpay refused the request (401)"
    // names the field to check; "could not connect" names nothing.
    const message = error instanceof IntegrationError || error instanceof Error
      ? error.message
      : `${connector.label} refused the credentials.`;
    await recordTest(key, false, message);
    return { ok: false, message };
  }
}
