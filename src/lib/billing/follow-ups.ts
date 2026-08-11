import { z } from "zod";
import { fromDateInput } from "@/lib/time";

/**
 * The chases scheduled against a bill.
 *
 * A bill is rarely collected on the first call. What used to be a single
 * `followUpDate` could only ever hold the next one, so agreeing three dates with
 * a doctor meant overwriting the first two and losing the trail of what had
 * already been promised. The list is the record; `followUpDate` survives as a
 * cached mirror of the earliest one still outstanding, which is what the lists,
 * the indexes and the rep's phone sort by.
 *
 * Pure on purpose — no mongoose, no `lib/api`. Both the routes and the browser
 * read these helpers, and `lib/api` reaches for `next/server`, which cannot be
 * pulled into a client bundle. That is also why the object-id shape below is
 * spelled out again here rather than imported.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;

/** More than anybody chases one bill; a guard against a runaway client. */
export const FOLLOW_UP_LIMIT = 20;

export const followUpInputSchema = z.object({
  /** Present for a follow-up already on the bill, so editing keeps its identity. */
  _id: z.string().regex(OBJECT_ID).optional(),
  date: z.string().regex(ISO_DATE, "Enter a valid follow-up date"),
  note: z.string().trim().max(200).optional(),
  /** Whether the call has been made. Omitted leaves the mark as it stands. */
  done: z.boolean().optional()
});

export const followUpListSchema = z.array(followUpInputSchema)
  .max(FOLLOW_UP_LIMIT, `A bill can carry at most ${FOLLOW_UP_LIMIT} follow-ups`);

export type FollowUpInput = z.infer<typeof followUpInputSchema>;

/** A follow-up as it is stored, and as the screens read it back. */
export type FollowUpLike = {
  _id?: unknown;
  date: Date | string;
  note?: string;
  doneAt?: Date | string | null;
  createdBy?: unknown;
};

/** Anything carrying the list and its mirror — an invoice document, or a plain object in a test. */
type Followed = { followUps?: FollowUpLike[] | null; followUpDate?: Date | null };

const time = (value: Date | string) => new Date(value).getTime();

/** Every follow-up in the order they fall due, whether or not they have been made. */
export function sortedFollowUps<E extends FollowUpLike>(list?: E[] | null): E[] {
  return [...(list ?? [])].sort((a, b) => time(a.date) - time(b.date));
}

/**
 * The chase that matters now: the earliest one nobody has made yet. A follow-up
 * whose day has passed unmade is still the next one — letting it fall off the
 * list is how a bill goes quiet.
 */
export function nextFollowUp<E extends FollowUpLike>(list?: E[] | null): E | undefined {
  return sortedFollowUps(list).find(entry => !entry.doneAt);
}

/** Brings `followUpDate` back in step with the list. Called by everything that touches it. */
export function syncFollowUpDate<T extends Followed>(invoice: T): T {
  const next = nextFollowUp(invoice.followUps);
  invoice.followUpDate = next ? new Date(next.date) : undefined;
  return invoice;
}

/**
 * Replaces the list with what a form sent, keeping what the client has no
 * business restating: who scheduled each chase, and when it was marked made.
 */
export function applyFollowUps<T extends Followed>(invoice: T, list: FollowUpInput[], userId?: unknown): T {
  const existing = new Map((invoice.followUps ?? []).map(entry => [String(entry._id ?? ""), entry]));

  invoice.followUps = list.map(entry => {
    const previous = entry._id ? existing.get(entry._id) : undefined;
    return {
      // A new follow-up gets its own id from the schema; an edited one keeps the
      // id it already had, so marking it made later still finds it.
      ...(previous?._id ? { _id: previous._id } : {}),
      date: fromDateInput(entry.date),
      note: entry.note || undefined,
      doneAt: entry.done === undefined
        ? previous?.doneAt ?? undefined
        : entry.done ? previous?.doneAt ?? new Date() : undefined,
      createdBy: previous?.createdBy ?? userId
    };
  });

  return syncFollowUpDate(invoice);
}

/** Adds one chase without disturbing the rest — the path the rep takes after taking money. */
export function appendFollowUp<T extends Followed>(invoice: T, entry: FollowUpInput, userId?: unknown): T {
  invoice.followUps = [
    ...(invoice.followUps ?? []),
    { date: fromDateInput(entry.date), note: entry.note || undefined, createdBy: userId }
  ];
  return syncFollowUpDate(invoice);
}

/**
 * The single-date form of the same thing, kept because `PATCH {followUpDate}` is
 * a documented way to move a bill's chase and predates the list.
 *
 * A date moves the earliest outstanding chase rather than adding another, which
 * is what "change the follow-up" has always meant. Clearing it drops the chases
 * nobody has made; the ones already made stay, because they are history.
 */
export function setFollowUpDate<T extends Followed>(invoice: T, date: string | null, userId?: unknown): T {
  if (!date) {
    invoice.followUps = (invoice.followUps ?? []).filter(entry => Boolean(entry.doneAt));
    return syncFollowUpDate(invoice);
  }

  const next = nextFollowUp(invoice.followUps);
  if (!next) return appendFollowUp(invoice, { date }, userId);

  next.date = fromDateInput(date);
  return syncFollowUpDate(invoice);
}
