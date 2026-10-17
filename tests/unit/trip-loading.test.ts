import { describe, it, expect } from "vitest";
import { parseCommand } from "@/domain/operations/commands";
import { emptyWorkspace, type Trip } from "@/domain/operations/types";
import {
  availableTripAssignments,
  invalidProposedLoad,
  warehouseAvailable,
} from "@/domain/operations/trip-loading";

const id = "00000000-0000-0000-0000-000000000001";
describe("admin trip preparation boundary", () => {
  it("whitelists one atomic RPC, explicit draft/physical confirmation and canonical date", () => {
    for (const intent of ["DRAFT", "CONFIRM"]) {
      const f = new FormData();
      for (const [key, value] of Object.entries({
        operation: "prepare-trip",
        key: id,
        id,
        driver: id,
        vehicle: id,
        day: id,
        scheduled: "2026-10-16",
        notes: "",
        items: "[]",
        intent,
        actor: "forged",
        stock: "999",
        status: "ACTIVE",
      }))
        f.set(key, value);
      expect(parseCommand(f)).toEqual({
        admin: true,
        rpc: "create_trip_with_load",
        args: {
          p_id: id,
          p_driver: id,
          p_vehicle: id,
          p_day: id,
          p_scheduled: "2026-10-16",
          p_notes: "",
          p_items: [],
          p_confirm: intent === "CONFIRM",
          p_key: id,
        },
      });
      f.set("intent", "ACTIVE");
      expect(() => parseCommand(f)).toThrow(/draft or confirm/);
      f.set("intent", intent);
      f.set("scheduled", "2026-02-30");
      expect(() => parseCommand(f)).toThrow();
    }
  });
  it("keeps draft proposal saving separate from confirmed inventory loading", () => {
    const f = new FormData();
    for (const [key, value] of Object.entries({
      operation: "load",
      key: id,
      trip: id,
      items: "[]",
    }))
      f.set(key, value);
    expect(parseCommand(f).rpc).toBe("load_trip");
    f.set("draft", "true");
    expect(parseCommand(f)).toEqual({
      rpc: "save_trip_draft_load",
      admin: true,
      args: { p_trip: id, p_items: [], p_key: id },
    });
  });
  it("uses the actual warehouse product state and excludes reserved or physically occupied vehicles", () => {
    const w = {
      ...emptyWorkspace,
      products: [
        {
          id,
          name: "Water",
          sku: "W",
          kind: "FULL_JAR" as const,
          is_active: true,
          unit: "jar",
          default_price: "100",
          version: 1,
        },
      ],
      locations: [{ id: "main", code: "MAIN", kind: "WAREHOUSE" }],
      drivers: ["free", "busy", "closed"].map((id) => ({
        id,
        name: id,
        is_active: true,
        version: 1,
      })),
      vehicles: ["free", "busy", "stocked"].map((id) => ({
        id,
        location_id: id,
        plate_number: id,
        description: "",
        is_active: true,
        version: 1,
      })),
      trips: [
        { driver_id: "busy", vehicle_id: "busy", status: "DRAFT" },
        { driver_id: "closed", status: "CLOSED" },
      ] as Trip[],
      balances: [
        {
          location_id: "main",
          product_id: id,
          stock_kind: "EMPTY_JAR" as const,
          quantity: 999,
        },
        {
          location_id: "main",
          product_id: id,
          stock_kind: "FULL_JAR" as const,
          quantity: 65,
        },
        {
          location_id: "stocked",
          product_id: id,
          stock_kind: "EMPTY_JAR" as const,
          quantity: 1,
        },
      ],
    };
    expect(warehouseAvailable(w, id)).toBe(65);
    expect(availableTripAssignments(w).drivers.map((d) => d.id)).toEqual([
      "free",
      "closed",
    ]);
    expect(availableTripAssignments(w).vehicles.map((v) => v.id)).toEqual([
      "free",
    ]);
    expect(
      invalidProposedLoad(w, [
        { product_id: id, stock_kind: "FULL_JAR", quantity: 65 },
      ]),
    ).toBe(false);
    expect(
      invalidProposedLoad(w, [
        { product_id: id, stock_kind: "FULL_JAR", quantity: 66 },
      ]),
    ).toBe(true);
    expect(
      invalidProposedLoad(w, [
        { product_id: id, stock_kind: "EMPTY_JAR", quantity: 1 },
      ]),
    ).toBe(true);
  });
});
