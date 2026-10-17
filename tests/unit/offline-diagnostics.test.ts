import { afterEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/data-access/offline", () => ({ offlineRpc: rpc }));
import { diagnoseOfflineOwnership } from "@/services/offline-diagnostics";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rpc.mockReset();
});
it("never queries or logs ownership diagnostics outside development", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  await diagnoseOfflineOwnership(crypto.randomUUID(), null, "STATUS");
  expect(rpc).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});
it("logs only whitelisted metadata even if an RPC unexpectedly returns sensitive fields", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const driver = crypto.randomUUID();
  rpc.mockResolvedValue({
    driver_id: driver,
    trusted_device_exists: true,
    token: "never-log",
    token_hash: "never-log",
    secret: "never-log",
    round_phase: "PRIVATE-DATA",
  });
  await diagnoseOfflineOwnership(driver, null, "STATUS");
  expect(log).toHaveBeenCalledOnce();
  const output = JSON.stringify(log.mock.calls);
  expect(output).toContain(driver);
  expect(output).not.toMatch(/never-log|PRIVATE-DATA|token|hash|secret/);
});
