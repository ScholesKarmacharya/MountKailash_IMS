import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  identity: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/services/auth", () => ({
  requirePermission: mocks.permission,
  requireIdentity: mocks.identity,
}));
vi.mock("@/data-access/accounts", () => ({
  writeAccount: mocks.write,
  readDriverAccounts: mocks.read,
}));
import { getDriverAccounts, saveAccount } from "@/services/accounts";
import { parseAccountCommand } from "@/domain/auth/accounts";
const id = "00000000-0000-0000-0000-000000000001";
const form = (operation: string) => {
  const f = new FormData();
  for (const [key, value] of Object.entries({
    operation,
    id,
    key: id,
    version: "0",
    name: "Ram Thapa",
    phone: "",
    reason: "Reviewed identity",
  }))
    f.set(key, value);
  return f;
};
describe("account authorization and input boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.write.mockResolvedValue(id);
  });
  it("allows verified pending users to update only their own contact fields", async () => {
    const f = form("account:profile");
    f.set("role", "ADMIN");
    f.set("approval_status", "APPROVED");
    f.set("is_active", "true");
    f.set("id", "another-user");
    await saveAccount(f);
    expect(mocks.identity).toHaveBeenCalledOnce();
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.write.mock.calls[0]![0].args).toEqual({
      p_name: "Ram Thapa",
      p_phone: "",
      p_version: 0,
      p_key: id,
    });
  });
  it.each(["account:driver", "account:status"])(
    "requires an admin before writing %s",
    async (operation) => {
      const f = form(operation);
      f.set("version", "1");
      f.set("status", "APPROVED");
      mocks.permission.mockRejectedValue(new Error("Forbidden"));
      await expect(saveAccount(f)).rejects.toThrow("Forbidden");
      expect(mocks.permission).toHaveBeenCalledWith("admin:read");
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
  it("protects the contact/approval directory before reads", async () => {
    mocks.permission.mockRejectedValue(new Error("Forbidden"));
    await expect(getDriverAccounts()).rejects.toThrow("Forbidden");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("requires valid versions, request IDs, explicit approval and an admin reason", () => {
    expect(parseAccountCommand(form("account:driver")).args.p_approve).toBe(
      false,
    );
    const f = form("account:driver");
    f.set("approve", "true");
    expect(parseAccountCommand(f).args.p_approve).toBe(true);
    f.set("reason", "");
    expect(() => parseAccountCommand(f)).toThrow("reason");
    const own = form("account:profile");
    own.set("version", "1.5");
    expect(() => parseAccountCommand(own)).toThrow("version");
    own.set("version", "1");
    own.set("key", "x".repeat(36));
    expect(() => parseAccountCommand(own)).toThrow("identifier");
    expect(() => parseAccountCommand(form("account:unknown"))).toThrow(
      "operation",
    );
  });
});
