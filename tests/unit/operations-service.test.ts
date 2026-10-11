import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@/services/auth", () => ({ requirePermission: mocks.guard }));
vi.mock("@/data-access/operations", () => ({
  readOperations: mocks.read,
  writeOperation: mocks.write,
}));
import { getOperations, saveOperation } from "@/services/operations";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockRejectedValue(new Error("Forbidden"));
});
it.each([true, false])(
  "guards workspace reads for admin=%s before data access",
  async (admin) => {
    await expect(getOperations(admin)).rejects.toThrow("Forbidden");
    expect(mocks.guard).toHaveBeenCalledWith(
      admin ? "admin:read" : "driver:read",
    );
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it.each(["start", "load"])(
  "guards %s mutations before database access",
  async (operation) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      operation,
      key: "00000000-0000-0000-0000-000000000001",
      trip: "00000000-0000-0000-0000-000000000002",
      items: "[]",
    }))
      form.set(key, value);
    await expect(saveOperation(form)).rejects.toThrow("Forbidden");
    expect(mocks.guard).toHaveBeenCalledWith(
      operation === "start" ? "trip:operate" : "trip:assign",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  },
);
