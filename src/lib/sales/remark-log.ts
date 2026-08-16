import { leadWhere, like, withLeadStatus } from "./leads";

/**
 * Reading the remarks across every lead at once.
 *
 * The thread on a row answers "what happened with this parlour". This answers
 * the questions a week of prospecting actually raises — what did we say to
 * anybody on Tuesday, which calls turned into an `Interested`, what has Priya
 * been doing — and none of those can be answered by opening two hundred rows.
 *
 * Built by unwinding the embedded array rather than as a collection of its own,
 * for the reason the model gives: remarks are read with their lead ninety-nine
 * times out of a hundred, and paying a join on the list screen to make this one
 * screen simpler is the wrong trade.
 *
 * Pure: plain objects, no mongoose. The log screen and the spreadsheet export
 * both build their query from here, so a download can never carry a different
 * set of rows than the screen it was pressed from.
 */

/** Newest first, with the lead id breaking ties so paging cannot repeat a row. */
export const REMARK_SORT: Record<string, 1 | -1> = { "remarks.at": -1, _id: 1 };

/** How many remarks one spreadsheet carries. Well past a year of real work. */
export const REMARK_EXPORT_LIMIT = 20000;

/** A `yyyy-mm-dd` filter bound, read in local time — see `lib/time.ts` on why not UTC. */
const dayStart = (iso: string) => new Date(`${iso}T00:00:00`);
const dayEnd = (iso: string) => new Date(`${iso}T23:59:59.999`);

/** One row of the log, in the shape `LeadRemarkRow` describes. */
export const REMARK_PROJECTION = {
  _id: "$remarks._id",
  text: "$remarks.text",
  channel: "$remarks.channel",
  status: "$remarks.status",
  at: "$remarks.at",
  byName: "$remarks.byName",
  lead: {
    _id: "$_id",
    name: "$name",
    type: "$type",
    status: "$status",
    phone: "$phone",
    area: "$area",
    city: "$city"
  }
} as const;

/**
 * The pipeline in two halves.
 *
 * `stages` is everything both the rows and the per-channel tallies agree on;
 * `channel` is the one narrowing applied to the rows alone, so the tallies can
 * still say how many calls and how many messages there were in the window
 * somebody is looking at. Folding it in would leave every channel but the
 * selected one reporting zero — the same trap the status counts avoid next door.
 */
export function remarkStages(params: URLSearchParams) {
  /**
   * `q` is pulled out of the lead filter and re-asked after the unwind, because
   * here it has to reach the wording of the remark as well. Somebody searching
   * "Diwali" wants the calls where Diwali was mentioned, not the parlours with
   * Diwali in their name.
   */
  const scoped = new URLSearchParams(params);
  scoped.delete("q");

  const stages: Record<string, unknown>[] = [
    { $match: withLeadStatus(leadWhere(scoped), params.get("status")) },
    { $unwind: "$remarks" }
  ];

  const q = (params.get("q") ?? "").trim();
  if (q) {
    const match = like(q);
    stages.push({ $match: { $or: [
      { name: match }, { phone: match }, { city: match }, { "remarks.text": match }, { "remarks.byName": match }
    ] } });
  }

  const from = params.get("from");
  const to = params.get("to");
  if (from || to) {
    stages.push({ $match: { "remarks.at": {
      ...(from ? { $gte: dayStart(from) } : {}),
      ...(to ? { $lte: dayEnd(to) } : {})
    } } });
  }

  const channel = params.get("channel");
  return { stages, channel: channel ? [{ $match: { "remarks.channel": channel } }] : [] };
}
