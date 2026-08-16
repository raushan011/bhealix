import { Schema, model, models } from "mongoose";
import { HALF_DAY_OPTIONS, LEAVE_STATUSES, LEAVE_TYPES } from "@/lib/hr/leave";
import { ATTENDANCE_SOURCES, ATTENDANCE_STATUSES } from "@/lib/hr/attendance";

/**
 * One request for time off, from asking to decided.
 *
 * The days are stored as "yyyy-mm-dd" strings rather than Dates: leave is a
 * calendar matter, not an instant, and a Date would drag a timezone into a
 * question that has none — a day off is the whole of that day wherever the
 * server happens to be running.
 */
const LeaveRequestSchema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: LEAVE_TYPES, required: true },
  fromDate: { type: String, required: true },
  toDate: { type: String, required: true },
  /** Only meaningful on a single-day request; ignored on a range. */
  halfDay: { type: String, enum: HALF_DAY_OPTIONS },
  /** Computed on the server from the dates — never taken from the client. */
  days: { type: Number, required: true, min: 0.5 },
  /** The financial year the request falls in, so a balance can be asked for one year. */
  leaveYear: { type: String, required: true, index: true },
  reason: { type: String, required: true },
  contactNumber: String,

  status: { type: String, enum: LEAVE_STATUSES, default: "Pending", index: true },
  decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
  decidedAt: Date,
  decisionNote: String
}, { timestamps: true });

LeaveRequestSchema.index({ employee: 1, fromDate: -1 });
LeaveRequestSchema.index({ status: 1, fromDate: -1 });
// The leave screen sorts by when a request was raised, not by the dates it
// covers — the two indexes above are for the calendar, these for the queue.
LeaveRequestSchema.index({ createdAt: -1 });
LeaveRequestSchema.index({ employee: 1, createdAt: -1 });

export const LeaveRequest = models.LeaveRequest ?? model("LeaveRequest", LeaveRequestSchema);

/**
 * One employee, one day, one mark.
 *
 * Only days that differ from the ordinary are stored. A rep who completed
 * visits is present by the evidence of those visits, and approved leave marks
 * itself — writing a row for every person every day would be a great deal of
 * data saying very little. The unique index is what makes marking a day twice
 * an update rather than a duplicate.
 */
const AttendanceSchema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  /** "yyyy-mm-dd", for the same reason leave dates are strings. */
  date: { type: String, required: true, index: true },
  status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
  source: { type: String, enum: ATTENDANCE_SOURCES, default: "Manual" },
  note: String,
  markedBy: { type: Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ date: 1, status: 1 });

export const Attendance = models.Attendance ?? model("Attendance", AttendanceSchema);

/**
 * A company-wide non-working day. Applies to everybody, so it is one row per
 * date rather than one per person per date.
 */
const HolidaySchema = new Schema({
  date: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  note: String,
  createdBy: { type: Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

export const Holiday = models.Holiday ?? model("Holiday", HolidaySchema);
