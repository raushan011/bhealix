import { Doctor } from "@/models/Doctor";

/**
 * The BHX-00123 number every doctor carries, and the one safe way to claim one.
 *
 * Counting the collection and adding one — the obvious version — hands the same
 * number to two people adding a doctor at the same moment, and the loser is
 * turned away with "a matching record already exists" for a doctor nobody has
 * ever entered. The count is not the highest code either: it drifts the first
 * time a record is removed, and then every code after it is a collision.
 *
 * So the number is read from the top of the series and the insert is retried
 * past whatever arrived in between. The clash is rare; recovering from it is
 * cheap; and neither the desk nor a rep in a corridor ever sees it.
 */

const PREFIX = "BHX-";

/** Codes are padded to five digits, so the highest string is the highest number. */
const CODE_PATTERN = new RegExp(`^${PREFIX}\\d+$`);

export const doctorCode = (sequence: number) => `${PREFIX}${String(sequence).padStart(5, "0")}`;

/** The number in use at the top of the series, or 0 when the directory is empty. */
export async function highestDoctorSequence(): Promise<number> {
  const latest = await Doctor.findOne({ code: CODE_PATTERN })
    .sort({ code: -1 }).select("code").lean() as { code?: string } | null;
  return Number(latest?.code?.slice(PREFIX.length)) || 0;
}

const isDuplicateCode = (error: unknown) =>
  error instanceof Error && error.message.includes("duplicate key") && error.message.includes("code");

/**
 * Saves a doctor under the next free code.
 *
 * `after` carries the last number this caller used, so an import of five
 * hundred does not re-read the top of the series once per row.
 */
export async function createDoctor(fields: Record<string, unknown>, after?: number) {
  let sequence = after ?? await highestDoctorSequence();

  for (let attempt = 0; attempt < 5; attempt++) {
    sequence++;
    try {
      const doctor = await Doctor.create({ ...fields, code: doctorCode(sequence) });
      return { doctor, sequence };
    } catch (error) {
      if (!isDuplicateCode(error)) throw error;
      // Somebody else took it. Start again from wherever the series has got to.
      sequence = Math.max(sequence, await highestDoctorSequence());
    }
  }

  throw new Error("Could not find a free code for this doctor. Please try again.");
}
