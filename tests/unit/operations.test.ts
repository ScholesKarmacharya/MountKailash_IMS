import { describe, it, expect } from "vitest";
import { parseCommand } from "@/domain/operations/commands";
import {
  moneyTotal,
  emptyWorkspace,
  vehicleCounts,
  type Trip,
} from "@/domain/operations/types";
import { can, type Profile } from "@/domain/auth/roles";
const id = "00000000-0000-0000-0000-000000000001";
function form(operation: string, fields: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    operation,
    key: id,
    trip: id,
    ...fields,
  }))
    f.set(k, v);
  return f;
}
describe("operations request and quantity boundaries", () => {
  it("computes indicative totals in exact integer cents", () => {
    expect(
      moneyTotal([
        { price: "150.25", quantity: 80 },
        { price: "0.10", quantity: 3 },
      ]),
    ).toBe("12020.30");
  });
  it("whitelists actor, ownership and payment verification out of server RPC arguments", () => {
    const command = parseCommand(
      form("visit", {
        customer: id,
        walk_name: "",
        walk_phone: "",
        items: "[]",
        payment: "FONEPAY",
        amount: "100.10",
        reference: "receipt",
        notes: "",
        actor: id,
        role: "ADMIN",
        verified: "true",
        vehicle: id,
        price: "0",
      }),
    );
    expect(command.admin).toBe(false);
    expect(command.args).not.toHaveProperty("actor");
    expect(command.args).not.toHaveProperty("price");
    expect(command.args.p_payment).toEqual({
      selection: "FONEPAY",
      reported_amount: "100.10",
      reference: "receipt",
    });
  });
  it.each([
    "customer",
    "vehicle",
    "driver",
    "create",
    "load",
    "route",
    "review",
    "cancel",
    "reconcile",
    "custody",
  ])("does not classify admin %s as driver operation", (operation) => {
    const fields = {
      id,
      name: "Name",
      shop_name: "",
      phone: "",
      address: "",
      notes: "",
      active: "true",
      version: "0",
      reason: "Verified reason",
      plate_number: "TEST",
      description: "",
      driver: id,
      vehicle: id,
      day: id,
      customer: id,
      items: "[]",
      counts: "[]",
      product: id,
      delta: "5",
    };
    expect(parseCommand(form(operation, fields)).admin).toBe(true);
  });
  it.each(["start", "submit"])(
    "allows assigned driver %s requests to reach the ownership-checked RPC",
    (operation) =>
      expect(parseCommand(form(operation, { counts: "[]" })).admin).toBe(false),
  );
  it("rejects unknown commands, invalid IDs and fractional custody changes", () => {
    expect(() => parseCommand(form("destroy"))).toThrow("Unknown");
    expect(() => parseCommand(form("start", { trip: "not-an-id" }))).toThrow(
      "identifier",
    );
    expect(() =>
      parseCommand(
        form("custody", {
          customer: id,
          product: id,
          day: id,
          delta: "1.2",
          reason: "Correction",
        }),
      ),
    ).toThrow("delta");
  });
  it("permits enabled drivers to operate trips without warehouse privileges", () => {
    const p: Profile = { id, name: "Driver", role: "DRIVER", is_active: true };
    expect(can(p, "trip:operate")).toBe(true);
    expect(can(p, "stock:adjust")).toBe(false);
    expect(can({ ...p, is_active: false }, "trip:operate")).toBe(false);
  });
  it("selects only the trip vehicle and its assigned products", () => {
    const w = {
      ...emptyWorkspace,
      vehicles: [
        {
          id,
          plate_number: "TEST",
          location_id: "vehicle",
          description: "",
          version: 1,
          is_active: true,
        },
      ],
      loads: [
        {
          trip_id: id,
          product_id: id,
          stock_kind: "FULL_JAR" as const,
          quantity: 100,
        },
      ],
      balances: [
        {
          location_id: "vehicle",
          product_id: id,
          stock_kind: "FULL_JAR" as const,
          quantity: 20,
        },
        {
          location_id: "warehouse",
          product_id: id,
          stock_kind: "FULL_JAR" as const,
          quantity: 999,
        },
        {
          location_id: "vehicle",
          product_id: "other",
          stock_kind: "FULL_JAR" as const,
          quantity: 999,
        },
      ],
    };
    expect(vehicleCounts(w, { vehicle_id: id } as Trip)).toEqual([
      { product_id: id, stock_kind: "FULL_JAR", quantity: 20 },
    ]);
  });
});
