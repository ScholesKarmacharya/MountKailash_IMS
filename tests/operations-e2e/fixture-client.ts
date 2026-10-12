import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import type { Workspace } from "../../src/domain/operations/types";

// Fixed loopback fixture only. Never reads .env.local or contacts Supabase Cloud.
const provider = "http://127.0.0.1:17777";
export const fixtureIds = {
  driver: "00000000-0000-0000-0000-000000000002",
  jar: "00000000-0000-0000-0000-000000000011",
};
export async function fixtureClient(
  request: APIRequestContext,
  role = "admin",
) {
  const login = await request.post(`${provider}/auth/v1/token`, {
    data: { email: `${role}@fixture.example`, password: "fixture-password" },
  });
  expect(login.ok()).toBe(true);
  const session = (await login.json()) as { access_token: string };
  async function rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const response = await request.post(`${provider}/rest/v1/rpc/${name}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      data: args,
    });
    expect(response.ok()).toBe(true);
    return (await response.json()) as T;
  }
  return {
    rpc,
    workspace: (trip: string | null = null) =>
      rpc<Workspace>("operations_workspace", { p_trip: trip }),
  };
}
export async function activeFixtureTrip(
  request: APIRequestContext,
  load = 100,
  cartons = 0,
) {
  expect((await request.post(`${provider}/reset`)).ok()).toBe(true);
  const admin = await fixtureClient(request);
  const customer = randomUUID(),
    vehicle = randomUUID(),
    trip = randomUUID();
  await admin.rpc("save_customer", {
    p_id: customer,
    p_name: "Refresh customer",
    p_shop: "",
    p_phone: "",
    p_address: "",
    p_notes: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated refresh test",
    p_key: randomUUID(),
  });
  await admin.rpc("save_vehicle", {
    p_id: vehicle,
    p_plate: "TEST-REFRESH",
    p_description: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated refresh test",
    p_key: randomUUID(),
  });
  const day = (await admin.workspace()).days.find(
    (d) => d.status === "OPEN",
  )!.id;
  await admin.rpc("create_trip", {
    p_id: trip,
    p_driver: fixtureIds.driver,
    p_vehicle: vehicle,
    p_day: day,
    p_customers: [],
    p_notes: "",
    p_key: randomUUID(),
  });
  await admin.rpc("load_trip", {
    p_trip: trip,
    p_items: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: load },
      ...(cartons
        ? [
            {
              product_id: "00000000-0000-0000-0000-000000000012",
              stock_kind: "BOTTLE_CARTON",
              quantity: cartons,
            },
          ]
        : []),
    ],
    p_key: randomUUID(),
  });
  const driver = await fixtureClient(request, "driver");
  await driver.rpc("transition_trip", {
    p_trip: trip,
    p_action: "START",
    p_reason: "",
    p_key: randomUUID(),
  });
  return { admin, driver, customer, trip };
}
