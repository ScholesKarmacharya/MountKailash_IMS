import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ permission: vi.fn(), rpc: vi.fn() }));
vi.mock("@/services/auth", () => ({ requirePermission: fake.permission }));
vi.mock("@/data-access/offline", async (original) => ({
  ...(await original<typeof import("@/data-access/offline")>()),
  offlineRpc: fake.rpc,
}));
import {
  getDriverOfflineAccess,
  resetDriverOfflineAccess,
} from "@/services/offline-admin";
import { OfflineServerError } from "@/data-access/offline";
const driver = crypto.randomUUID(),
  trip = crypto.randomUUID(),
  key = crypto.randomUUID();
function form() {
  const f = new FormData();
  for (const [name, value] of Object.entries({ driver, trip, key }))
    f.set(name, value);
  return f;
}
beforeEach(() => vi.resetAllMocks());
it("authorizes before reading status or resetting, with no RPC for a denied caller", async () => {
  fake.permission.mockRejectedValue(new Error("Admin required"));
  await expect(getDriverOfflineAccess(driver)).rejects.toThrow(
    "Admin required",
  );
  await expect(resetDriverOfflineAccess(form())).rejects.toThrow(
    "Admin required",
  );
  expect(fake.permission).toHaveBeenCalledWith("admin:read");
  expect(fake.rpc).not.toHaveBeenCalled();
});
it("uses validated driver, displayed trip and stable key, with an audited default reason", async () => {
  await resetDriverOfflineAccess(form());
  expect(fake.rpc).toHaveBeenCalledWith("offline_admin_reset_access", {
    p_driver: driver,
    p_trip: trip,
    p_key: key,
    p_reason: "Reset offline access from driver management",
  });
  const f = form();
  f.set("trip", "");
  f.set("reason", "  New phone approved  ");
  await resetDriverOfflineAccess(f);
  expect(fake.rpc).toHaveBeenLastCalledWith(
    "offline_admin_reset_access",
    expect.objectContaining({ p_trip: null, p_reason: "New phone approved" }),
  );
});
it("validates reason and identifiers before calling SQL", async () => {
  const f = form();
  f.set("reason", "x");
  await expect(resetDriverOfflineAccess(f)).rejects.toThrow("reason");
  f.set("reason", "Valid reason");
  f.set("driver", "wrong");
  await expect(resetDriverOfflineAccess(f)).rejects.toThrow();
  expect(fake.rpc).not.toHaveBeenCalled();
});
it("shows needs update and disables reset when deployment lacks the new RPC", async () => {
  fake.rpc.mockRejectedValue(
    new OfflineServerError("MIGRATION_REQUIRED", "Missing function", 503),
  );
  expect(await getDriverOfflineAccess(driver)).toMatchObject({
    available: false,
    status: "Needs update",
    can_reset: false,
  });
});
it("does not disguise authorization failures as a deployment update", async () => {
  fake.rpc.mockRejectedValue(
    new OfflineServerError("AUTHORIZATION", "Admin required", 403),
  );
  await expect(getDriverOfflineAccess(driver)).rejects.toMatchObject({
    code: "AUTHORIZATION",
  });
});
