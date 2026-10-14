import { afterEach, expect, it, vi } from "vitest";
import { connectivityFailure } from "@/domain/offline/connectivity";
import { offlineRequest } from "@/lib/offline/sync";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("a slow sync request is a temporary server timeout, not an internet disconnection", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Timeout", "AbortError")),
          ),
        ),
    ),
  );
  const pending = expect(
    offlineRequest({ action: "status" }),
  ).rejects.toMatchObject({ code: "TEMPORARY", status: 503 });
  await vi.advanceTimersByTimeAsync(15000);
  await pending;
});
it("an unreachable sync transport remains a genuine connectivity error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );
  await expect(offlineRequest({ action: "status" })).rejects.toMatchObject({
    code: "NETWORK",
    status: 0,
  });
});
it.each([
  [{ code: "NETWORK", status: 0 }, "OFFLINE"],
  [{ code: "NETWORK", status: 503 }, "SERVER_UNAVAILABLE"],
  [{ code: "AUTHENTICATION", status: 401 }, "AUTHENTICATION"],
  [{ code: "AUTHORIZATION", status: 403 }, "AUTHORIZATION"],
  [{ code: "SCHEMA", status: 503 }, "DATABASE"],
  [{ code: "MIGRATION_REQUIRED", status: 503 }, "DATABASE"],
  [{ code: "TEMPORARY", status: 500 }, "SERVER_UNAVAILABLE"],
  [{ code: "NOT_FOUND", status: 404 }, "SERVER_UNAVAILABLE"],
] as const)("classifies the independent probe %j as %s", (error, expected) => {
  expect(connectivityFailure(error)).toBe(expected);
});
