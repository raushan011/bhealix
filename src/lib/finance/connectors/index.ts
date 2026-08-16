import type { ConnectorKey } from "../sources";
import { meta } from "./meta";
import { razorpay } from "./razorpay";
import { shiprocket } from "./shiprocket";
import { shopify } from "./shopify";
import type { Connector } from "./types";

/**
 * The registry every screen and route reads.
 *
 * Adding a fifth vendor is a file beside these four and a line here — the
 * settings form renders whatever fields a connector declares, and the pull route
 * dispatches by key. Neither has a switch over vendor names in it.
 */
export const CONNECTORS_BY_KEY: Record<ConnectorKey, Connector> = {
  shiprocket, razorpay, shopify, meta
};

export const connectorFor = (key: ConnectorKey): Connector => CONNECTORS_BY_KEY[key];

export const ALL_CONNECTORS: readonly Connector[] = Object.values(CONNECTORS_BY_KEY);

export type { Connector, CredentialField, Credentials, FetchResult, FetchedDocument } from "./types";
