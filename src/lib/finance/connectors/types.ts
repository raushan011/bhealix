import type { ConnectorKey } from "../sources";

/**
 * What every vendor connector looks like from the outside.
 *
 * One shape, so the pull route and the settings screen do not each grow a switch
 * over four vendors — and so adding a fifth is a file and a line in the registry
 * rather than an edit in six places.
 *
 * The interesting part of the design is `fields`. Each connector declares the
 * credentials it needs *as data*, and the settings screen renders whatever it
 * finds. Four vendors want four completely different things — a login, a key
 * pair, a shop domain and a token, an account id and a long-lived token — and a
 * hand-written form per vendor is four forms to keep in step with four secret
 * stores. This way there is one form and one store.
 */

export type CredentialField = {
  name: string;
  label: string;
  /** Secrets are write-only: stored encrypted, never sent back, shown as a hint. */
  secret: boolean;
  placeholder?: string;
  hint?: string;
  required: boolean;
};

/** A month's worth of one vendor, as the vault will file it. */
export type FetchedDocument = {
  /** Stable across repeated fetches of the same month, so a re-pull replaces. */
  externalRef: string;
  fileName: string;
  contentType: string;
  data: Buffer;
  description: string;
  number?: string;
  documentDate?: Date;
  /** What the month came to, where the vendor's data says. */
  amount?: number;
  taxAmount?: number;
};

export type FetchResult = {
  documents: FetchedDocument[];
  /** Said on screen afterwards. Names what was found, and what was not. */
  message: string;
};

export type Credentials = Record<string, string>;

export type Connector = {
  key: ConnectorKey;
  label: string;
  /** Where the key is generated, linked from the settings screen. */
  consoleUrl: string;
  /** Written above the fields — what to create over there, and with what scope. */
  guidance: string;
  fields: readonly CredentialField[];

  /**
   * Proves the credentials work, without writing anything.
   *
   * Its own call rather than a side effect of the first pull, because the two
   * fail for completely different reasons and somebody typing a key into a form
   * wants to know *now* whether they typed it correctly — not at the end of the
   * month when a fetch comes back empty and could equally mean there were no
   * bills.
   */
  test(credentials: Credentials): Promise<string>;

  /** A month, as documents ready to file. Empty is a legitimate answer. */
  fetch(credentials: Credentials, period: string, actor: string): Promise<FetchResult>;
};
