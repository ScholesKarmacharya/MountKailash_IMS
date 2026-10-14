import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ profile: vi.fn(), rpc: vi.fn() }));
vi.mock("@/data-access/profiles", () => ({
  readCurrentProfile: mocks.profile,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
import { GET } from "@/app/api/driver/customers/[id]/context/route";
import {
  CustomerLookupError,
  customerDatabaseError,
  customerErrorMessages,
} from "@/domain/operations/customer-errors";
import { confirmedCustomerContext } from "@/domain/operations/confirmed-customer";
import { fetchCustomerContext } from "@/lib/customers/request";
import { ProfileAccessError } from "@/domain/auth/access-errors";
const user = crypto.randomUUID(),
  customer = crypto.randomUUID(),
  trip = crypto.randomUUID();
it("distinguishes a lookup timeout from unavailable internet", async () => {
  const controller = new AbortController(),
    reason = new DOMException("Timed out", "TimeoutError");
  controller.abort(reason);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(reason));
  await expect(
    fetchCustomerContext(trip, customer, controller.signal),
  ).rejects.toMatchObject({ code: "TEMPORARY", status: 503 });
});
it("preserves cancellation rather than reporting a network outage", async () => {
  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));
  await expect(
    fetchCustomerContext(trip, customer, controller.signal),
  ).rejects.toBe(controller.signal.reason);
});
const context = () => ({
  customer: { id: customer, name: "Regular", is_active: true },
  prices: [],
  credit: [],
  custody: [],
  custody_history: [],
  credit_history: [],
  billing: null,
});
const lookup = (id = customer, round = trip) =>
  GET(
    new Request(
      `http://localhost/api/driver/customers/${id}/context?trip=${round}`,
    ),
    { params: Promise.resolve({ id }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.profile.mockResolvedValue({
    id: user,
    role: "DRIVER",
    is_active: true,
    approval_status: "APPROVED",
  });
  mocks.rpc.mockResolvedValue({ data: context(), error: null, status: 200 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("returns a confirmed customer contract with cookie-specific no-store headers", async () => {
  const response = await lookup();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(await response.json()).toMatchObject({
    user,
    trip,
    data: {
      customer: { id: customer, supply_type: "REGULAR", house_status: "NONE" },
    },
  });
  expect(mocks.rpc).toHaveBeenCalledWith("delivery_customer_context", {
    p_trip: trip,
    p_customer: customer,
  });
});
it.each([
  [null, 401, "AUTHENTICATION"],
  [
    { id: user, role: "DRIVER", is_active: true, approval_status: "PENDING" },
    403,
    "AUTHORIZATION",
  ],
  [
    { id: user, role: "DRIVER", is_active: false, approval_status: "APPROVED" },
    403,
    "AUTHORIZATION",
  ],
])(
  "rejects absent/unapproved/inactive identity before requesting customer data",
  async (profile, status, code) => {
    mocks.profile.mockResolvedValue(profile);
    const response = await lookup();
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it("rejects malformed customer/trip identifiers", async () => {
  expect((await lookup("wrong")).status).toBe(400);
  expect((await lookup(customer, "wrong")).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["NETWORK", "TEMPORARY", "SCHEMA"] as const)(
  "distinguishes identity %s failure from an expired session",
  async (code) => {
    mocks.profile.mockRejectedValue(new ProfileAccessError(code));
    const response = await lookup();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code });
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it.each([
  [
    "25006",
    "cannot execute SELECT FOR SHARE in a read-only transaction",
    405,
    "SCHEMA",
    503,
  ],
  ["42703", "missing column", 400, "SCHEMA", 503],
  ["PGRST202", "missing RPC", 404, "SCHEMA", 503],
  ["42501", "not authorized", 403, "AUTHORIZATION", 403],
  ["22023", "Customer is missing or inactive", 400, "NOT_FOUND", 404],
  ["22023", "Changed delivery round", 400, "CONFLICT", 409],
  ["PGRST301", "expired JWT", 401, "AUTHENTICATION", 401],
  ["40P01", "deadlock", 500, "TEMPORARY", 503],
  ["", "fetch failed", 0, "NETWORK", 503],
])(
  "maps database error %s to actionable HTTP/code without exposing provider details",
  async (dbCode, message, providerStatus, code, status) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: dbCode, message },
      status: providerStatus,
    });
    const response = await lookup();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      code,
      message:
        customerErrorMessages[code as keyof typeof customerErrorMessages],
    });
    expect(console.error).toHaveBeenCalledWith("customer_lookup_failed", {
      rpc: "delivery_customer_context",
      status: providerStatus,
      databaseCode: dbCode,
    });
  },
);
it("normalizes legacy regular customers and never infers HOUSE approval from a zero price", () => {
  expect(
    confirmedCustomerContext({
      ...context(),
      prices: [{ customer_id: customer, price: "0.00" }],
    }).customer.supply_type,
  ).toBe("REGULAR");
  expect(() =>
    confirmedCustomerContext({
      ...context(),
      customer: {
        ...context().customer,
        supply_type: "HOUSE",
        house_status: "APPROVED",
      },
    }),
  ).toThrow(CustomerLookupError);
  expect(() =>
    confirmedCustomerContext({
      ...context(),
      credit: [
        {
          customer_id: crypto.randomUUID(),
          available: "0.00",
          outstanding: "1.00",
        },
      ],
    }),
  ).toThrow(CustomerLookupError);
  expect(() =>
    confirmedCustomerContext(context(), crypto.randomUUID()),
  ).toThrow(CustomerLookupError);
});
it("validates same customer/trip identity and uses authenticated uncached browser requests", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ user, trip, data: context() }));
  vi.stubGlobal("fetch", fetch);
  expect((await fetchCustomerContext(trip, customer)).data.customer.id).toBe(
    customer,
  );
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
  });
  fetch.mockResolvedValue(
    Response.json({ user, trip: crypto.randomUUID(), data: context() }),
  );
  await expect(fetchCustomerContext(trip, customer)).rejects.toMatchObject({
    code: "SCHEMA",
  });
});
it("distinguishes transport failure and expired credentials without trusting server message text", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("connection lost"));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchCustomerContext(trip, customer)).rejects.toMatchObject({
    code: "NETWORK",
  });
  fetch.mockResolvedValue(
    Response.json(
      { message: "provider detail", code: "AUTHENTICATION" },
      { status: 401 },
    ),
  );
  await expect(fetchCustomerContext(trip, customer)).rejects.toMatchObject({
    code: "AUTHENTICATION",
    message: customerErrorMessages.AUTHENTICATION,
  });
  expect(customerDatabaseError({ code: "42883" }).code).toBe("SCHEMA");
});
