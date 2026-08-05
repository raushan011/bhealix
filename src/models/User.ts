import { Schema, model, models } from "mongoose";
import { ROLES } from "@/constants/access";
import { LEAVE_TYPES } from "@/lib/hr/leave";

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

  leaveEntitlement: { type: EntitlementSchema, default: undefined },
  notes: String
}, { timestamps: true });

export const User = models.User ?? model("User", UserSchema);
