"use client";
import {
  T,
  Message,
  DateValue,
  Value,
  LocalizedTextarea,
} from "@/components/localization";

import { useActionState, useEffect, useRef, useState } from "react";
import { operationAction } from "@/app/operations-actions";
import {
  fetchCustomerContext,
  notifyConfirmedCustomer,
} from "@/lib/customers/request";
import { CustomerLookupError } from "@/domain/operations/customer-errors";
import type { Customer, Workspace } from "@/domain/operations/types";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import { npr } from "@/domain/finance/money";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { PendingJars } from "./pending-jars";
import { HouseCustomerFields } from "./house-customer-fields";
import { useDriverRuntime } from "./driver-runtime-context";

export function useDeliveryCustomer(trip: string, enabled: boolean) {
  const runtime = useDriverRuntime();
  const [customer, setCustomer] = useState("");
  const [context, setContext] = useState<DeliveryCustomerContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Development effect replay immediately mounts again. Only cancel an
      // actual unmount; otherwise a valid selection becomes a spurious outage.
      queueMicrotask(() => {
        if (!mounted.current) {
          // This is a live request counter, not a DOM ref captured at mount.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          sequence.current++;
          request.current?.abort();
        }
      });
    };
  }, []);
  useEffect(() => {
    if (!runtime || !customer || !context || error) return;
    const updated = runtime.cachedCustomer(customer);
    if (updated && JSON.stringify(updated) !== JSON.stringify(context))
      queueMicrotask(() => setContext(updated));
    // Only confirmed business changes replace this selected context. Routine
    // fetch timestamps and connectivity checks cannot invalidate a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime?.revision, customer]);
  async function selectCustomer(id: string) {
    const current = ++sequence.current;
    request.current?.abort();
    setCustomer(id);
    setContext(null);
    setError(null);
    setLoading(!!id && enabled);
    if (!id || !enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException("Customer lookup timed out", "TimeoutError"),
        ),
      15000,
    );
    try {
      const result = runtime
        ? {
            data: await runtime.customer(trip, id, controller.signal),
            user: "",
          }
        : await fetchCustomerContext(trip, id, controller.signal);
      if (sequence.current !== current) return;
      setContext(result.data);
      if (!runtime) notifyConfirmedCustomer(result.user, trip);
    } catch (failure) {
      if (sequence.current !== current) return;
      setError(
        failure instanceof CustomerLookupError
          ? failure.message
          : "Customer details are temporarily unavailable. Retry; your draft is preserved.",
      );
    } finally {
      clearTimeout(timer);
      if (sequence.current === current) setLoading(false);
    }
  }
  return { customer, context, loading, error, selectCustomer };
}

export function DeliveryCustomerForm({
  trip,
  customer,
  onSaved,
  onCancel,
  detailsEnabled = false,
}: {
  trip: string;
  customer?: Customer;
  onSaved: (id: string) => void;
  onCancel: () => void;
  detailsEnabled?: boolean;
}) {
  const runtime = useDriverRuntime();
  const [id] = useState(() => customer?.id ?? crypto.randomUUID());
  const [key] = useState(() => crypto.randomUUID());
  const [contacts, setContacts] = useState({
    name: customer?.name ?? "",
    shop_name: customer?.shop_name ?? "",
    phone: customer?.phone ?? "",
    address: customer?.address ?? "",
    contact_person: customer?.contact_person ?? "",
    customer_type: customer?.customer_type ?? "",
    delivery_notes: customer?.delivery_notes ?? "",
  });
  const [duplicate, setDuplicate] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: Parameters<typeof operationAction>[0], form: FormData) => {
      const result = runtime
        ? await runtime.submit(form)
        : await operationAction(previous, form);
      if (result?.id && result.success) onSaved(result.id);
      return result;
    },
    null,
  );
  const contactField = (
    field: keyof typeof contacts,
    label: string,
    maxLength: number,
    required = false,
  ) => (
    <label key={field} className="grid gap-2 text-sm font-semibold">
      <Message value={label} />
      {runtime && field === "address" ? (
        <LocalizedTextarea
          name={field}
          value={contacts[field]}
          rows={2}
          maxLength={maxLength}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring"
          onChange={(e) =>
            setContacts({ ...contacts, [field]: e.target.value })
          }
        />
      ) : (
        <Input
          name={field}
          value={contacts[field]}
          required={required}
          autoFocus={field === "name"}
          type={field === "phone" ? "tel" : "text"}
          maxLength={maxLength}
          onChange={(e) => {
            setContacts({ ...contacts, [field]: e.target.value });
            setDuplicate(false);
          }}
        />
      )}
    </label>
  );
  return (
    <Card id="customer-editor" className="space-y-4 border-primary">
      <h3 className="text-lg font-bold">
        <Message
          value={customer ? "Edit customer contact" : "Add New Customer"}
        />
      </h3>
      {!runtime && (
        <p className="text-sm text-muted-foreground">
          <T k="Save contact details and continue this delivery. Prices, credit, deposits and jar balances are managed separately." />
        </p>
      )}
      <form action={action} className="space-y-4">
        <input
          type="hidden"
          name="operation"
          value={detailsEnabled ? "delivery-contact" : "delivery-customer"}
        />
        <input type="hidden" name="trip" value={trip} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="key" value={key} />
        <input type="hidden" name="version" value={customer?.version ?? 0} />
        {runtime && (
          <input
            type="hidden"
            name="delivery_notes"
            value={contacts.delivery_notes}
          />
        )}
        <fieldset disabled={pending} className="space-y-4">
          {detailsEnabled && <HouseCustomerFields customer={customer} />}
          {contactField("name", "Customer name", 120, true)}
          {!runtime && contactField("shop_name", "Shop name (optional)", 160)}
          {contactField("phone", "Customer phone (optional)", 40)}
          {contactField("address", "Customer address (optional)", 500)}
          {runtime ? (
            <details className="rounded-lg border border-border p-3">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold">
                <T k="More customer details" />
              </summary>
              <div className="space-y-4">
                {contactField("shop_name", "Shop name (optional)", 160)}
                {detailsEnabled && (
                  <>
                    {contactField(
                      "contact_person",
                      "Contact person (optional)",
                      120,
                    )}
                    {contactField(
                      "customer_type",
                      "Customer type (optional)",
                      80,
                    )}
                  </>
                )}
              </div>
            </details>
          ) : (
            detailsEnabled && (
              <>
                {contactField(
                  "contact_person",
                  "Contact person (optional)",
                  120,
                )}
                {contactField("customer_type", "Customer type (optional)", 80)}
                {contactField(
                  "delivery_notes",
                  "Delivery notes (optional)",
                  2000,
                )}
              </>
            )
          )}
          {(duplicate || state?.error?.includes("matching customer")) && (
            <label className="flex min-h-14 items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm">
              <input
                name="duplicate_confirmed"
                type="checkbox"
                checked={duplicate}
                onChange={(e) => setDuplicate(e.target.checked)}
                className="size-5"
              />{" "}
              <T k="I checked the directory; this is a separate customer with matching details." />{" "}
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              className="min-h-14"
              type="submit"
              disabled={!!runtime && runtime.offlinePrepState !== "READY"}
            >
              <Message
                value={
                  pending
                    ? "Saving…"
                    : customer
                      ? "Save contact details"
                      : "Save and select customer"
                }
              />
            </Button>
            <Button
              className="min-h-14"
              variant="outline"
              type="button"
              onClick={onCancel}
            >
              <T k="Cancel contact changes" />
            </Button>
          </div>
        </fieldset>
        {state?.error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
          >
            <Message value={state.error} />
          </p>
        )}
      </form>
    </Card>
  );
}

export function DeliveryCustomerHistory({
  context,
  products,
}: {
  context: DeliveryCustomerContext;
  products: Workspace["products"];
}) {
  const runtime = useDriverRuntime();
  return (
    <details className="rounded-lg border border-border p-4 text-sm">
      <summary className="min-h-11 cursor-pointer font-semibold">
        <T k="Customer credit and jar history" />
      </summary>
      <div className="mt-4 space-y-4">
        {context.free_deliveries?.length ? (
          <div className="space-y-2">
            <h4 className="font-semibold">
              <T k="Free Supply" />
            </h4>
            {context.free_deliveries.map((r) => (
              <p key={`${r.visit_id}:${r.product_id}`}>
                <DateValue value={r.occurred_at} /> · {r.product_name} ·{" "}
                <Value value={r.full_jars + r.cartons} /> ·{" "}
                <T k="Empty Jars Returned" />: <Value value={r.empty_jars} /> ·{" "}
                <T k="Value of Free Supply" />:{" "}
                <Value value={npr(r.reference_value)} /> · {r.driver_name}
              </p>
            ))}
          </div>
        ) : null}
        <PendingJars
          workspace={{
            available: context.pending_jars !== undefined,
            rows: context.pending_jars ?? [],
          }}
        />
        {context.jar_allocations && context.jar_allocations.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer font-semibold">
              <T
                k={
                  runtime
                    ? "Jar return history"
                    : "FIFO empty-return allocations"
                }
              />
            </summary>
            {context.jar_allocations.map((a) => (
              <p
                className="py-2"
                key={`${a.return_entry_id}:${a.delivery_entry_id}`}
              >
                <T
                  k="{0} jars · {1} · {2} against original date {3}"
                  values={[
                    <Value key="v0" value={a.quantity} />,
                    <Message key="v1" value={a.source} />,
                    <DateValue key="v2" value={a.returned_at} time />,
                    <DateValue key="v3" value={a.original_date} time />,
                  ]}
                />
              </p>
            ))}
          </details>
        )}
        <div>
          <h4 className="font-semibold">
            <T k="Recent credit entries" />
          </h4>
          {!context.credit_history.length && (
            <p>
              <T k="No credit history recorded." />
            </p>
          )}
          {context.credit_history.map((e) => (
            <p key={e.id} className="py-2">
              <Message value={e.kind.replaceAll("_", " ")} /> ·{" "}
              <Value value={npr(e.amount)} /> ·{" "}
              <DateValue value={e.created_at} time />
            </p>
          ))}
        </div>
        <div>
          <h4 className="font-semibold">
            <T k="Recent jar entries" />
          </h4>
          {!context.custody_history.length && (
            <p>
              <T k="No jar history recorded." />
            </p>
          )}
          {context.custody_history.map((e) => (
            <p key={e.id} className="py-2">
              <T
                k="{0} · {1} {2} jars · balance {3} · {4}"
                values={[
                  products.find((p) => p.id === e.product_id)?.name,
                  e.delta > 0 ? "+" : "",
                  e.delta,
                  e.resulting_balance,
                  <DateValue key="v4" value={e.created_at} time />,
                ]}
              />
            </p>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <T
            k={
              runtime
                ? "Recent customer activity."
                : "Latest 50 entries per ledger. Posted transactions remain immutable."
            }
          />
        </p>
      </div>
    </details>
  );
}
