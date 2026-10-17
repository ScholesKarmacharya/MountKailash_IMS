"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Zap, Droplets, Warehouse, Wallet, UserRound } from "lucide-react";
import type { DriverData } from "./driver-application";
import type { LocalState, OfflineKind } from "@/domain/offline/types";
import { T } from "./localization";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { DriverHomeView } from "./driver-home-view";
import { DriverTripCard } from "./driver-trip-card";
import { DriverSalesView } from "./driver-sales-view";
import { DriverCustomers } from "./driver-customers";
import { DeliveryForm } from "./trip-forms";
import { DriverStockSummary } from "./driver-stock";
import { OfflineReturnForm } from "./offline/workspace";
import { OfflineCollection } from "./offline/collection";
import { DriverPendingJars } from "./driver-pending-jars";
import { InstantDriver } from "./instant-delivery";
import { SignOutButton } from "./sign-out-button";
import { OperationForm } from "./operation-form";

// Visiting another tab, polling and reconnecting cannot discard a form. Only
// Save + Continue resets that screen; a different trip resets all screens.
function Screen({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return visited || active ? (
    <div hidden={!active} data-driver-screen={active}>
      {children}
    </div>
  ) : null;
}
export function DriverWorkspaceScreens({
  path,
  params,
  data,
  state,
  busy,
  epochs,
  online,
  record,
}: {
  path: string;
  params: URLSearchParams;
  data: DriverData;
  state?: LocalState;
  busy: boolean;
  epochs: Record<string, number>;
  online: boolean;
  record: (kind: OfflineKind, value: unknown) => Promise<boolean>;
}) {
  const trip = data.trip;
  const query = params.toString();
  const [queries, setQueries] = useState<Record<string, string>>({});
  if (queries[path] !== query) setQueries({ ...queries, [path]: query });
  const customerFor = (route: string) =>
    new URLSearchParams(route === path ? query : (queries[route] ?? "")).get(
      "customer",
    ) ?? undefined;
  const actions = [
    ["Instant Delivery", "/driver/instant-delivery", Zap],
    ["Unreturned Jars", "/driver/pending-jars", Droplets],
    ["Collections", "/driver/collections", Wallet],
    ["Return to Warehouse", "/driver/return", Warehouse],
    ["My Profile", "/account/profile", UserRound],
  ] as const;
  return (
    <>
      <Screen active={path === "/driver/home"}>
        <DriverHomeView data={data} state={state} />
      </Screen>
      <Screen active={path === "/driver/delivery"}>
        <div className="mx-auto max-w-3xl space-y-4">
          <h1 className="text-2xl font-bold">
            <T k="New Sale" />
          </h1>
          {trip && data.delivering ? (
            <Card id="add-delivery">
              <DeliveryForm
                key={`${trip.id}:${epochs["/driver/delivery"] ?? 0}`}
                simplifiedPayment
                workspace={data.workspace}
                finance={data.finance}
                trip={trip}
                requestKey={crypto.randomUUID()}
                initialCustomer={customerFor("/driver/delivery")}
              />
            </Card>
          ) : (
            <DriverTripCard data={data} />
          )}
        </div>
      </Screen>
      <Screen active={path === "/driver/customers"}>
        <DriverCustomers
          workspace={data.workspace}
          finance={data.finance}
          state={state}
          trip={data.delivering ? trip : undefined}
        />
      </Screen>
      <Screen active={path === "/driver/pending-jars"}>
        <DriverPendingJars
          key={customerFor("/driver/pending-jars") ?? "directory"}
          workspace={data.workspace}
          pending={data.pending}
          state={state}
          trip={data.delivering ? trip : undefined}
          customer={customerFor("/driver/pending-jars")}
        />
      </Screen>
      <Screen active={path === "/driver/instant-delivery"}>
        <InstantDriver
          key={`${trip?.id ?? "idle"}:${epochs["/driver/instant-delivery"] ?? 0}`}
          data={data}
          state={state}
          online={online}
        />
      </Screen>
      <Screen active={path === "/driver/sales"}>
        <DriverSalesView
          data={data}
          state={state}
          q={{
            from: params.get("from") ?? undefined,
            to: params.get("to") ?? undefined,
          }}
        />
      </Screen>
      <Screen active={path === "/driver/collections"}>
        <div className="mx-auto max-w-3xl space-y-4">
          <h1 className="text-2xl font-bold">
            <T k="Collections" />
          </h1>
          {data.delivering && state ? (
            <OfflineCollection
              key={`collection:${epochs["/driver/collections"] ?? 0}`}
              state={state}
              initialCustomer={customerFor("/driver/collections")}
              busy={busy}
              save={(d) => record("PAYMENT", d)}
            />
          ) : data.delivering ? (
            <p role="status">
              <T k="Preparing trip for offline use..." />
            </p>
          ) : (
            <DriverTripCard data={data} />
          )}
        </div>
      </Screen>
      <Screen active={path === "/driver/return"}>
        <div className="mx-auto max-w-3xl space-y-5">
          <h1 className="text-2xl font-bold">
            <T k="Return to Warehouse" />
          </h1>
          <DriverTripCard data={data} primary={!data.delivering} />
          {trip && data.delivering && (
            <DriverStockSummary
              workspace={data.workspace}
              trip={trip}
              returning
            />
          )}
          {state?.sealed ||
          (trip &&
            ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(
              trip.status,
            )) ? (
            <Card>
              <p role="status">
                <T k="Return submitted. Waiting for warehouse confirmation." />
              </p>
            </Card>
          ) : data.delivering && state ? (
            <Card>
              <OfflineReturnForm
                state={state}
                busy={busy}
                save={(counts) =>
                  record("SUBMIT", {
                    counts,
                    manifest: state.operations.map((o) => ({
                      id: o.id,
                      fingerprint: o.fingerprint,
                    })),
                  })
                }
              />
            </Card>
          ) : (
            data.delivering && (
              <p role="status">
                <T k="Preparing trip for offline use..." />
              </p>
            )
          )}
        </div>
      </Screen>
      <Screen active={path === "/driver/more"}>
        <div className="mx-auto max-w-3xl space-y-5">
          <h1 className="text-2xl font-bold">
            <T k="More" />
          </h1>
          <nav
            aria-label="More driver actions"
            className="grid gap-3 sm:grid-cols-2"
          >
            {actions.map(([label, href, Icon]) => (
              <Link
                key={href}
                href={href}
                className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-card px-4 font-semibold text-primary"
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <T k={label} />
              </Link>
            ))}
          </nav>
          {trip && data.delivering && data.round?.phase === "ACTIVE" && (
            <details className="rounded-xl border border-border bg-card p-4">
              <summary className="min-h-11 cursor-pointer font-semibold">
                <T k="Overnight stop" />
              </summary>
              <p className="mb-4 text-sm">
                <T k="Save today's work and ask the warehouse to continue this trip tomorrow." />
              </p>
              <OperationForm
                operation="pause"
                trip={trip.id}
                requestKey={crypto.randomUUID()}
                label="Pause for overnight carryover"
                confirm="Pause deliveries until the warehouse approves continuing this trip?"
              />
            </details>
          )}
          <Button asChild variant="outline">
            <Link href="/driver/home">
              <T k="Back to Home" />
            </Link>
          </Button>
          <div className="border-t border-border pt-4">
            <SignOutButton user={data.profile.id} driver />
          </div>
        </div>
      </Screen>
    </>
  );
}
