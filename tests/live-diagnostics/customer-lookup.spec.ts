import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Workspace } from "../../src/domain/operations/types";
test("existing approved driver reads regular and HOUSE customer details through the browser", async ({
  page,
}) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const email = process.env.DEMO_DRIVER_EMAIL ?? "driver@mount-kailash.example";
  const password = process.env.DEMO_DRIVER_PASSWORD!;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = await client.auth.signInWithPassword({ email, password });
  expect(auth.error).toBeNull();
  const result = await client.rpc("operations_workspace", { p_trip: null });
  expect(result.error).toBeNull();
  const workspace = result.data as Workspace;
  const trip = workspace.trips.find((t) => t.status === "ACTIVE")!;
  expect(trip).toBeDefined();
  const customers = [
    workspace.customers.find((c) => c.is_active && c.supply_type === "REGULAR"),
    workspace.customers.find(
      (c) =>
        c.is_active &&
        c.supply_type === "HOUSE" &&
        c.house_status === "APPROVED",
    ),
  ];
  expect(customers.every(Boolean)).toBe(true);
  await page.goto("/sign-in");
  await page.getByLabel(/Email address|इमेल ठेगाना/).fill(email);
  await page.getByLabel(/Password|पासवर्ड/, { exact: true }).fill(password);
  await page.getByRole("button", { name: /^(Sign in|साइन इन)$/ }).click();
  await page.waitForURL("**/driver/home");
  for (const customer of customers) {
    // Exercise authoritative reads without creating a competing writer.
    const path = `/api/driver/customers/${customer!.id}/context?trip=${trip.id}`;
    const response = await page.evaluate(async (path) => {
      const r = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
      });
      return { status: r.status, body: await r.json() };
    }, path);
    const body = response.body;
    // Sanitized diagnostic output: no cookies, credentials or full customer data.
    console.log(
      JSON.stringify({
        request: path.split("?")[0],
        type: customer!.supply_type,
        status: response.status,
        code: body.code ?? null,
      }),
    );
    if (process.env.EXPECT_LOOKUP_SCHEMA === "1") {
      expect(response.status).toBe(503);
      expect(body.code).toBe("SCHEMA");
    } else {
      expect(response.status).toBe(200);
      expect(body.data.customer.id).toBe(customer!.id);
      expect(body.data.customer.supply_type).toBe(customer!.supply_type);
      expect(body.trip).toBe(trip.id);
      expect(body.user).toBe(auth.data.user!.id);
      for (const field of [
        "prices",
        "credit",
        "custody",
        "custody_history",
        "credit_history",
      ])
        expect(Array.isArray(body.data[field])).toBe(true);
    }
  }
  const round = await client
    .from("driver_offline_rounds")
    .select("trip_id,phase,confirmed_sequence,reported_pending")
    .eq("trip_id", trip.id)
    .maybeSingle();
  expect(round.error).toBeNull();
  console.log(
    JSON.stringify({
      roundLookupStatus: round.status,
      registered: !!round.data,
      phase: round.data?.phase,
      confirmedSequence: round.data?.confirmed_sequence,
      reportedPending: round.data?.reported_pending,
    }),
  );
  if (round.data) {
    await page.goto('/driver/delivery?customer='+customers[0]!.id);
    await expect(page).toHaveURL(/\/driver\/delivery\?customer=/);
    await page.getByRole("button",{name:"English",exact:true}).click();
    await expect(page.getByRole("heading",{name:"New Sale",exact:true})).toBeVisible();
    await expect(page.getByLabel("Offline passphrase")).toHaveCount(0);
    await expect(page.locator('#add-delivery input[name="customer"]')).toHaveValue(customers[0]!.id);
    await expect(page.getByTestId("driver-sync-status").getByText("Online",{exact:true})).toBeVisible();
    // Fresh diagnostic browser never registers a device or writes business data.
  }
});
