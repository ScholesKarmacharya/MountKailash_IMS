import { describe, expect, it } from "vitest";
import {
  can,
  homeFor,
  isRole,
  type Profile,
  type Permission,
} from "@/domain/auth/roles";
const admin: Profile = {
  id: "admin",
  name: "Demo",
  role: "ADMIN",
  is_active: true,
};
const driver: Profile = { ...admin, id: "driver", role: "DRIVER" };
describe("server permission policy", () => {
  it("recognizes only trusted role values", () => {
    expect(isRole("ADMIN")).toBe(true);
    expect(isRole("DRIVER")).toBe(true);
    for (const value of ["admin", null, {}, "OWNER"])
      expect(isRole(value)).toBe(false);
  });
  it("redirects each role to its own home", () => {
    expect(homeFor("ADMIN")).toBe("/admin/dashboard");
    expect(homeFor("DRIVER")).toBe("/driver/home");
  });
  it.each<Permission>([
    "admin:read",
    "trip:assign",
    "trip:approve",
    "stock:adjust",
    "product:manage",
    "day:open",
    "day:close",
  ])("denies driver %s", (permission) => {
    expect(can(driver, permission)).toBe(false);
    expect(can(admin, permission)).toBe(true);
  });
  it("allows driver workspace reads only for enabled users", () => {
    expect(can(driver, "driver:read")).toBe(true);
    expect(can({ ...driver, is_active: false }, "driver:read")).toBe(false);
  });
  it("allows contact operations for active admins and drivers without granting loading or financial management", () => {
    expect(can(admin, "customer:operate")).toBe(true);
    expect(can(driver, "customer:operate")).toBe(true);
    expect(can({ ...driver, is_active: false }, "customer:operate")).toBe(
      false,
    );
    expect(can(null, "customer:operate")).toBe(false);
    expect(can(driver, "finance:manage")).toBe(false);
    expect(can(driver, "trip:assign")).toBe(false);
  });
  it.each<Permission>([
    "admin:read",
    "driver:read",
    "trip:assign",
    "trip:approve",
    "stock:adjust",
    "product:manage",
    "day:open",
    "day:close",
  ])("rejects missing and disabled identities for %s", (permission) => {
    expect(can(null, permission)).toBe(false);
    expect(can({ ...admin, is_active: false }, permission)).toBe(false);
  });
});
