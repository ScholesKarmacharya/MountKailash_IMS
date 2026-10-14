import { beforeEach, afterEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  signIn: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/services/offline", () => ({
  offlineIdentity: async () => ({
    id: "00000000-0000-0000-0000-000000000002",
    role: "DRIVER",
  }),
}));
vi.mock("@/data-access/offline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data-access/offline")>()),
  offlineRpc: fake.rpc,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: fake.getUser, signInWithPassword: fake.signIn },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: fake.set, delete: fake.del }),
}));
import { trustedDeviceCommand } from "@/services/trusted-device";
const device = crypto.randomUUID(),
  user = "00000000-0000-0000-0000-000000000002",
  secrets = { device, token: "a".repeat(64), secret: "b".repeat(64) };
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OFFLINE_DEVICE_RECOVERY_KEY", "c".repeat(64));
  fake.getUser.mockResolvedValue({
    data: { user: { id: user, email: "driver@fixture.example" } },
  });
  fake.signIn.mockResolvedValue({ data: { user: { id: user } }, error: null });
});
it("encrypts server recovery material with a private key and sets a routing-only cookie after approval", async () => {
  fake.rpc.mockResolvedValue({ registered: true, device });
  await trustedDeviceCommand({ action: "register", device, secrets });
  const [name, args] = fake.rpc.mock.calls[0]!;
  expect(name).toBe("trusted_device_register");
  expect(args.p_recovery).not.toContain(secrets.secret);
  expect(args.p_recovery).not.toContain(secrets.token);
  expect(fake.set).toHaveBeenCalledWith(
    "mk-driver-device",
    "1",
    expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
  );
});
it("requires fresh Supabase password reauthentication to recover the exact original encryption key", async () => {
  fake.rpc.mockResolvedValueOnce({ registered: true, device });
  await trustedDeviceCommand({ action: "register", device, secrets });
  const box = fake.rpc.mock.calls[0]![1].p_recovery;
  fake.rpc.mockResolvedValueOnce(box);
  expect(
    await trustedDeviceCommand({
      action: "recover",
      device,
      password: "reauth-password",
    }),
  ).toEqual(secrets);
  expect(fake.signIn).toHaveBeenCalledWith({
    email: "driver@fixture.example",
    password: "reauth-password",
  });
  expect(fake.rpc.mock.calls[1]).toEqual([
    "trusted_device_recovery",
    { p_device: device },
  ]);
});
it("rejects wrong passwords before reading recovery data", async () => {
  fake.signIn.mockResolvedValue({
    data: { user: null },
    error: new Error("bad"),
  });
  await expect(
    trustedDeviceCommand({ action: "recover", device, password: "wrong" }),
  ).rejects.toMatchObject({ status: 401 });
  expect(fake.rpc).not.toHaveBeenCalled();
});
it("fails closed when the deployment has no dedicated recovery encryption key", async () => {
  vi.stubEnv("OFFLINE_DEVICE_RECOVERY_KEY", "");
  await expect(
    trustedDeviceCommand({ action: "register", device, secrets }),
  ).rejects.toMatchObject({ status: 503, code: "CONFIGURATION" });
  expect(fake.rpc).not.toHaveBeenCalled();
  expect(fake.set).not.toHaveBeenCalled();
});
it("binds encrypted recovery material to the driver and device", async () => {
  fake.rpc.mockResolvedValueOnce({ registered: true, device });
  await trustedDeviceCommand({ action: "register", device, secrets });
  fake.rpc.mockResolvedValueOnce(fake.rpc.mock.calls[0]![1].p_recovery);
  await expect(
    trustedDeviceCommand({
      action: "recover",
      device: crypto.randomUUID(),
      password: "reauth-password",
    }),
  ).rejects.toThrow();
});
it("refuses to change the trust cookie when server authorization fails", async () => {
  fake.rpc.mockRejectedValue(new Error("Suspended driver"));
  await expect(
    trustedDeviceCommand({ action: "register", device, secrets }),
  ).rejects.toThrow("Suspended");
  expect(fake.set).not.toHaveBeenCalled();
});
