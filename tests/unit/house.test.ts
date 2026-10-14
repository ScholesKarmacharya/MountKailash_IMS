import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { houseFilter, freeGroups, freeProduct } from "@/domain/house/pricing";
import { freeExportRows } from "@/domain/house/export";
import { excelWorkbook } from "@/services/xlsx";
import { OfflineDatabase, OfflineVault } from "@/lib/offline/store";
import { emptyWorkspace } from "@/domain/operations/types";
import { emptyFinance } from "@/domain/finance/types";
import {
  localStock,
  localCustomers,
  effectivePrice,
} from "@/domain/offline/operations";
import type {
  OfflineSnapshot,
  DeliveryDraft,
  LocalState,
} from "@/domain/offline/types";
import type { FreeDelivery } from "@/domain/house/types";
import {
  canonicalDate,
  bsMonthRange,
  adToBs,
} from "@/domain/localization/calendar";
import { message } from "@/lib/i18n/messages";
const user = crypto.randomUUID(),
  trip = crypto.randomUUID(),
  jar = crypto.randomUUID(),
  customer = crypto.randomUUID(),
  vehicle = crypto.randomUUID(),
  location = crypto.randomUUID();
function snapshot(): OfflineSnapshot {
  const c = {
    id: customer,
    name: "Owner House",
    shop_name: "",
    phone: "",
    address: "",
    notes: "",
    is_active: true,
    version: 1,
    supply_type: "HOUSE" as const,
    house_status: "APPROVED" as const,
    house_version: 1,
  };
  return {
    profile: {
      id: user,
      name: "Driver",
      role: "DRIVER",
      is_active: true,
      approval_status: "APPROVED",
    },
    locale: "en",
    receipts: [],
    fetchedAt: new Date().toISOString(),
    authorizedUntil: new Date(Date.now() + 86400000).toISOString(),
    finance: structuredClone(emptyFinance),
    round: {
      trip_id: trip,
      driver_id: user,
      device_id: crypto.randomUUID(),
      phase: "ACTIVE",
      confirmed_sequence: 0,
      registered_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      reported_pending: 0,
      checkpoint_at: null,
    },
    workspace: {
      ...structuredClone(emptyWorkspace),
      available: true,
      customers: [c],
      products: [
        {
          id: jar,
          name: "20L",
          sku: "20L",
          kind: "FULL_JAR",
          unit: "jar",
          default_price: "50.00",
          is_active: true,
          version: 1,
          house_eligible: true,
          reference_price: "50.00",
          house_version: 1,
        },
      ],
      trips: [
        {
          id: trip,
          trip_number: 1,
          driver_id: user,
          driver_name: "Driver",
          vehicle_id: vehicle,
          plate_number: "TEST",
          business_day_id: crypto.randomUUID(),
          date_label: "2026-10-13",
          status: "ACTIVE",
          notes: "",
          created_at: new Date().toISOString(),
          close_reason: "",
        },
      ],
      vehicles: [
        {
          id: vehicle,
          plate_number: "TEST",
          description: "",
          location_id: location,
          is_active: true,
          version: 1,
        },
      ],
      loads: [
        {
          trip_id: trip,
          product_id: jar,
          stock_kind: "FULL_JAR",
          quantity: 100,
        },
      ],
      balances: [
        {
          location_id: location,
          product_id: jar,
          stock_kind: "FULL_JAR",
          quantity: 100,
        },
      ],
    },
    contexts: [
      {
        customer: c,
        billing: null,
        prices: [],
        credit: [],
        custody: [],
        custody_history: [],
        credit_history: [],
        house_products: [
          {
            id: jar,
            house_eligible: true,
            house_version: 1,
            reference_price: "50.00",
          },
        ],
      },
    ],
  };
}
const draft = (): DeliveryDraft => ({
  customer,
  walk_name: "",
  walk_phone: "",
  items: [{ product_id: jar, full_jars: 15, empty_jars: 10, cartons: 0 }],
  status: "FREE_SUPPLY",
  received: null,
  total: "0.00",
  notes: "",
  prices: [],
  custody: [],
});
it("durable IndexedDB HOUSE delivery survives unlock and carries confirmed approval/product evidence", async () => {
  const s = snapshot(),
    db = new OfflineDatabase(`house-${crypto.randomUUID()}`);
  try {
    await db.settings.put({ key: "active-user", value: user });
    const vault = await OfflineVault.create(
      db,
      s,
      s.round.device_id,
      "d".repeat(64),
      "safe-test-passphrase",
    );
    await vault.record("DELIVERY", draft());
    const unlocked = await OfflineVault.unlock(
        db,
        vault.id,
        "safe-test-passphrase",
      ),
      state = await unlocked.read();
    expect(state.operations).toHaveLength(1);
    expect(JSON.parse(state.operations[0]!.payload)).toMatchObject({
      status: "FREE_SUPPLY",
      total: "0.00",
      house: {
        version: 1,
        products: [
          { product_id: jar, eligible: true, reference_price: "50.00" },
        ],
      },
    });
    expect(
      localStock(state).find((b) => b.stock_kind === "FULL_JAR")?.quantity,
    ).toBe(85);
    expect(
      localStock(state).find((b) => b.stock_kind === "EMPTY_JAR")?.quantity,
    ).toBe(10);
    expect(effectivePrice(state, customer, jar)).toBe("0.00");
  } finally {
    await db.delete();
  }
});
it("locally created HOUSE requests never become approved or eligible without confirmed server context", () => {
  const s = snapshot();
  s.contexts = [];
  s.workspace.customers = [];
  const state = {
    snapshot: s,
    operations: [
      {
        kind: "CUSTOMER",
        id: crypto.randomUUID(),
        payload: JSON.stringify({
          id: customer,
          name: "Local House",
          shop_name: "",
          phone: "",
          address: "",
          version: 0,
          supply_type: "HOUSE",
          house_status: "APPROVED",
        }),
      },
    ],
  } as LocalState;
  expect(localCustomers(state)[0]?.house_status).toBe("PENDING");
  expect(effectivePrice(state, customer, jar)).toBe("50.00");
  expect(freeProduct(localCustomers(state)[0], { house_eligible: true })).toBe(
    false,
  );
});
it("BS ranges and monthly groups use Nepal dates, including UTC crossing midnight", () => {
  const at = "2026-10-12T19:00:00Z",
    bs = adToBs("2026-10-13");
  expect(canonicalDate(at)).toBe("2026-10-13");
  expect(houseFilter({ preset: "today" }, new Date(at))).toMatchObject({
    from: "2026-10-13",
    to: "2026-10-13",
  });
  expect(houseFilter({ preset: "month" }, new Date(at))).toMatchObject(
    bsMonthRange(bs.year, bs.month),
  );
  expect(() =>
    houseFilter({ preset: "custom", from: "2026-10-14", to: "2026-10-13" }),
  ).toThrow();
  const row = {
    customer_id: customer,
    customer_name: "House",
    driver_id: user,
    driver_name: "Driver",
    occurred_at: at,
    full_jars: 15,
    cartons: 0,
    reference_value: "750.00",
  } as FreeDelivery;
  expect(freeGroups([row], "month")[0]?.value).toBe("750.00");
  expect(freeGroups([row], "date", "ne")[0]?.label).toMatch(/[०-९]/);
});
it("English/Nepali free supply exports preserve reference values and produce a real XLSX without formula injection", () => {
  expect(message("ne", "HOUSE")).toBe("घर");
  expect(message("ne", "No Payment Required")).toBe("पैसा तिर्नु पर्दैन");
  const rows = freeExportRows(
    {
      available: true,
      products: [],
      customers: [],
      drivers: [],
      rows: [],
      adjustments: [],
    },
    "ne",
  );
  expect(rows[0]?.[0]).toBe(message("ne", "Free Supply Summary"));
  const excel = excelWorkbook([...rows, ["=SUM(A1)", "<Owner & परिवार>"]]);
  expect(excel.readUInt32LE()).toBe(0x04034b50);
  const body = excel.toString("utf8");
  expect(body).toContain('t="inlineStr"');
  expect(body).toContain("&lt;Owner &amp; परिवार&gt;");
  expect(body).not.toContain("<f>");
});
