import { describe, expect, it } from "vitest";
import { hasPermission } from "./access";
describe("role permissions",()=>{
  it("gives admins confidential access",()=>expect(hasPermission("ADMIN","confidential-note:read")).toBe(true));
  it("isolates MR records",()=>expect(hasPermission("MR","doctor:read:all")).toBe(false));
  it("allows explicit permission grants",()=>expect(hasPermission("HR","audit:read",["audit:read"])).toBe(true));
});
