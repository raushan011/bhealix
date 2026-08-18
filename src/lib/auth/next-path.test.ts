import { describe, expect, it } from "vitest";
import { landingPath } from "./next-path";

describe("landingPath", () => {
  it("keeps a path on this site", () => {
    expect(landingPath("/admin/sales/orders?page=2", "/")).toBe("/admin/sales/orders?page=2");
  });

  it("refuses anything that would leave the site or loop back to the form", () => {
    expect(landingPath("https://evil.example/", "/admin")).toBe("/admin");
    expect(landingPath("//evil.example", "/admin")).toBe("/admin");
    expect(landingPath("/login?next=/admin", "/admin")).toBe("/admin");
    expect(landingPath("/partner/login", "/partner")).toBe("/partner");
    expect(landingPath(null, "/admin")).toBe("/admin");
    expect(landingPath("", "/admin")).toBe("/admin");
  });
});
