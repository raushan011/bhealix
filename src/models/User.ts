import { Schema, model, models } from "mongoose";
import { ROLES } from "@/constants/access";
import { LEAVE_TYPES } from "@/lib/hr/leave";
import { EMPLOYMENT_STATUSES } from "@/lib/hr/payroll";

/**
 * Leave the employee starts the year with, where it differs from the company
 * default. Absent means the default applies, so raising the default raises it
 * for everyone who was never given a figure of their own.
 */
const EntitlementSchema = new Schema(
  Object.fromEntries(LEAVE_TYPES.filter(type => type !== "Unpaid").map(type => [type, { type: Number, min: 0 }])),
  { _id: false }
);

const UserSchema = new Schema({
  employeeId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, required: true },
  permissions: [String],
  active: { type: Boolean, default: true },
  lastLoginAt: Date,

  // ------------------------------------------------- employment record (HR)
  designation: String,
  department: String,
  joiningDate: String,
  /** Who they report to. A reference, so a change of name follows by itself. */
  reportingTo: { type: Schema.Types.ObjectId, ref: "User" },
  employmentType: { type: String, enum: ["Full time", "Part time", "Contract", "Intern"] },
  workLocation: String,
  /**
   * Where they stand in their employment. `active` says whether they can sign
   * in; this says what the company's relationship with them is, which is a
   * different question — somebody serving notice signs in every day.
   */
  employmentStatus: { type: String, enum: EMPLOYMENT_STATUSES },
  confirmationDate: String,
  /**
   * Their last working day. Payroll pays up to it and no further, so an exit
   * halfway through a month settles itself instead of being paid in full and
   * recovered afterwards.
   */
  exitDate: String,
  exitReason: String,

  phone: String,
  dateOfBirth: String,
  bloodGroup: String,
  address: String,
  emergencyContact: { name: String, relation: String, phone: String },

  // Identification and payroll details an HR desk is expected to hold.
  panNumber: String,
  aadhaarLastFour: String,
  bankAccountNo: String,
  bankIfsc: String,
  bankName: String,
  /** The provident fund's universal account number, which follows a person between employers. */
  uan: String,
  esicNumber: String,

  leaveEntitlement: { type: EntitlementSchema, default: undefined },
  notes: String
}, { timestamps: true });

export const User = models.User ?? model("User", UserSchema);
