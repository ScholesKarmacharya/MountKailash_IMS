"use client";
import { LocalizedSelect } from "@/components/localization";
import { BsDatePicker } from "./bs-date-picker";

import {
  T,
  Message,
  DateValue,
  Value,
  useLocale,
} from "@/components/localization";
import { ProductDeliverySummary } from "./product-delivery-summary";
import {
  deliveryText,
  deliveryHeading,
  productDeliveries,
} from "@/domain/operations/product-delivery";
import { tr } from "@/domain/localization/format";

import { AmountInput, PaymentButtons } from "./finance-payment";
import { cents, decimal, sum, npr } from "@/domain/finance/money";
import { paymentPlan } from "@/domain/finance/payment-plan";
import { driverPaymentPlan } from "@/domain/finance/driver-payment";
import { canonical } from "@/domain/offline/operations";
import { DriverPayment } from "./driver-payment";
import { freeProduct, approvedHouse } from "@/domain/house/pricing";
import type { FinanceWorkspace, PaymentDraft } from "@/domain/finance/types";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Count, Trip, Workspace } from "@/domain/operations/types";
import { moneyTotal, vehicleCounts } from "@/domain/operations/types";
import { stockLabels } from "@/domain/inventory/validation";
import { OperationForm, Counter, Field } from "./operation-form";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { TripLoadProducts } from "./trip-load-products";
import {
  offlinePreparingMessage,
  useDriverRuntime,
} from "./driver-runtime-context";
import {
  DeliveryCustomerForm,
  DeliveryCustomerHistory,
  useDeliveryCustomer,
} from "./delivery-customers";

export function TripPreparationForms({
  workspace: w,
  trip,
}: {
  workspace: Workspace;
  trip: Trip;
}) {
  const open = w.days.find((d) => d.status === "OPEN");
  if (!open) return null;
  return (
    <div className="space-y-5">
      {["DRAFT", "LOADED"].includes(trip.status) && (
        <OperationForm
          operation="reschedule"
          trip={trip.id}
          requestKey={crypto.randomUUID()}
          label="Reschedule trip"
        >
          <BsDatePicker
            name="scheduled"
            label="Scheduled delivery date"
            defaultValue={trip.scheduled_date ?? trip.date_label}
            min={open.date_label}
            required
          />
          <Field
            name="reason"
            label="Rescheduling reason"
            required
            maxLength={500}
          />
        </OperationForm>
      )}
      {trip.status === "DRAFT" && (
        <OperationForm
          operation="cancel"
          trip={trip.id}
          requestKey={crypto.randomUUID()}
          label="Cancel draft trip"
        >
          <Field
            name="reason"
            label="Cancellation reason"
            required
            maxLength={500}
          />
        </OperationForm>
      )}
      {trip.status === "LOADED" && (
        <OperationForm
          operation="unload-cancel"
          trip={trip.id}
          requestKey={crypto.randomUUID()}
          label="Confirm physical unloading and cancel"
          confirm="Confirm that all counted stock has physically returned to the warehouse?"
        >
          <p className="text-sm">
            <T k="Cancellation requires physical unloading. Confirm every vehicle count; the original loading history is preserved." />
          </p>
          <UnloadingCounts workspace={w} trip={trip} />
          <Field
            name="reason"
            label="Cancellation reason"
            required
            maxLength={500}
          />
        </OperationForm>
      )}
      {trip.status === "ACTIVE" && !trip.carryover_pending && (
        <OperationForm
          operation="carryover"
          trip={trip.id}
          requestKey={crypto.randomUUID()}
          label="Authorize overnight carryover"
          confirm="Pause this trip for the next business day, retaining vehicle stock and pending settlement?"
        >
          <p className="text-sm">
            <T k="Carryover pauses deliveries until the next day is opened and the driver resumes. An unsealed offline queue still blocks closing." />
          </p>
          <Field
            name="reason"
            label="Carryover reason"
            required
            maxLength={500}
          />
        </OperationForm>
      )}
    </div>
  );
}
function UnloadingCounts({
  workspace: w,
  trip,
}: {
  workspace: Workspace;
  trip: Trip;
}) {
  const { t } = useLocale();
  const [counts, setCounts] = useState(vehicleCounts(w, trip));
  return (
    <>
      <input type="hidden" name="counts" value={JSON.stringify(counts)} />
      {counts.map((c, i) => (
        <Counter
          key={`${c.product_id}:${c.stock_kind}`}
          label={`${w.products.find((p) => p.id === c.product_id)?.name} · ${t(stockLabels[c.stock_kind])}`}
          value={c.quantity}
          onChange={(quantity) =>
            setCounts((old) =>
              old.map((r, n) => (n === i ? { ...r, quantity } : r)),
            )
          }
        />
      ))}
    </>
  );
}
export function LoadTripForm({
  workspace: w,
  trip,
  requestKey,
}: {
  workspace: Workspace;
  trip: Trip;
  requestKey: string;
}) {
  const products = w.products.filter((p) => p.is_active);
  const { locale, number } = useLocale();
  const [selected, setSelected] = useState<Count[]>(
    trip.proposed_load_items ?? [],
  );
  return (
    <OperationForm
      operation="load"
      trip={trip.id}
      requestKey={requestKey}
      label="Confirm warehouse loading"
      preserveFields
      actions={
        <Button
          type="submit"
          name="draft"
          value="true"
          variant="outline"
          data-confirm="Save proposed quantities without confirming physical loading?"
        >
          <T k="Save proposed quantities" />
        </Button>
      }
      confirm={tr(locale, "Load {0} onto {1}?", [
        selected
          .map(
            (i) =>
              `${number(i.quantity)} ${products.find((p) => p.id === i.product_id)?.name}`,
          )
          .join(", "),
        trip.plate_number,
      ])}
    >
      <p className="text-sm text-muted-foreground">
        <T k="Choose products and quantities. A jar product can be assigned with zero full jars to permit empty collection; at least one load quantity must be positive." />
      </p>
      <input type="hidden" name="items" value={JSON.stringify(selected)} />
      <TripLoadProducts
        workspace={w}
        items={selected}
        onChange={setSelected}
        selectProducts
      />
    </OperationForm>
  );
}
export function DeliveryForm({
  workspace: w,
  finance: f,
  trip,
  requestKey,
  initialCustomer,
  simplifiedPayment = false,
}: {
  finance?: FinanceWorkspace;
  workspace: Workspace;
  trip: Trip;
  requestKey: string;
  initialCustomer?: string;
  simplifiedPayment?: boolean;
}) {
  const { locale, t, number } = useLocale();
  const [search, setSearch] = useState(""),
    [walk, setWalk] = useState(false),
    [walkName, setWalkName] = useState(""),
    [phone, setPhone] = useState("");
  const lookup = useDeliveryCustomer(trip.id, w.driver_workflow);
  const { customer, context } = lookup;
  useEffect(() => {
    if (initialCustomer) void lookup.selectCustomer(initialCustomer);
    // Query selection initializes a draft; it must not overwrite later edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomer, trip.id]);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const [payment, setPayment] = useState("CASH"),
    [amount, setAmount] = useState(""),
    [driverReceived, setDriverReceived] = useState<string | null>(null),
    [reference, setReference] = useState(""),
    [notes, setNotes] = useState(""),
    [review, setReview] = useState(false);
  const [quantities, setQuantities] = useState<
    Record<string, { full_jars: number; empty_jars: number; cartons: number }>
  >({});
  const [oldAmount, setOldAmount] = useState(""),
    [deposit, setDeposit] = useState(""),
    [fonepayPart, setFonepayPart] = useState("");
  const runtime = useDriverRuntime();
  const credit =
    context?.credit ??
    f?.credit.filter((i) => i.customer_id === customer) ??
    [];
  const custody = context?.custody ?? w.custody;
  const counts = vehicleCounts(w, trip);
  const products = w.products.filter((p) =>
    w.loads.some((l) => l.product_id === p.id),
  );
  const quantity = (id: string) =>
    quantities[id] ?? { full_jars: 0, empty_jars: 0, cartons: 0 };
  const update = (
    id: string,
    field: "full_jars" | "empty_jars" | "cartons",
    value: number,
  ) => {
    setQuantities({ ...quantities, [id]: { ...quantity(id), [field]: value } });
    setReview(false);
  };
  const items = products
    .map((p) => ({ product_id: p.id, ...quantity(p.id) }))
    .filter((i) => i.full_jars + i.empty_jars + i.cartons > 0);
  const selected =
    context?.customer ?? w.customers.find((c) => c.id === customer);
  const isFree = (p: Workspace["products"][number]) =>
    !walk &&
    (!w.driver_workflow || (!!context && !lookup.loading && !lookup.error)) &&
    freeProduct(
      selected,
      context?.house_products?.find((h) => h.id === p.id) ?? p,
    );
  const hasFree = items.some(
    (i) =>
      i.full_jars + i.cartons > 0 &&
      isFree(products.find((p) => p.id === i.product_id)!),
  );
  const fullyFree =
    hasFree &&
    items
      .filter((i) => i.full_jars + i.cartons > 0)
      .every((i) => isFree(products.find((p) => p.id === i.product_id)!));
  const total = moneyTotal(
    products.map((p) => ({
      price: isFree(p)
        ? "0.00"
        : ((context?.prices ?? f?.prices)?.find(
            (r) =>
              r.customer_id === (walk ? null : customer) &&
              r.product_id === p.id &&
              r.active,
          )?.price ?? p.default_price),
      quantity: quantity(p.id).full_jars + quantity(p.id).cartons,
    })),
  );
  const tax =
    f?.company?.tax_mode === "EXPLICIT"
      ? decimal((cents(total) * cents(f.company.tax_rate) + 5000n) / 10000n)
      : "0.00";
  const payable = sum([total, tax]);
  const receivedAmount = driverReceived ?? payable;
  const hasSale = items.some((i) => i.full_jars + i.cartons > 0);
  const driverStatus = hasSale
    ? fullyFree
      ? "FREE_SUPPLY"
      : payment === "UNPAID"
        ? "CREDIT"
        : payment === "FONEPAY"
          ? "FONEPAY"
          : "PAID"
    : "RETURN_ONLY";
  let financeProblem = "",
    payments: PaymentDraft[] = [];
  if (f?.available) {
    try {
      if (cents(payable) > 99999999999999n)
        throw new Error(
          "This delivery exceeds the supported invoice amount. Reduce quantities.",
        );
      payments = fullyFree
        ? []
        : simplifiedPayment
          ? driverPaymentPlan({
              status: driverStatus,
              total: payable,
              amount: receivedAmount,
              customer: walk ? null : customer || null,
            })
          : paymentPlan({
              selection: payment,
              total: payable,
              amount,
              oldAmount: walk ? "0" : oldAmount,
              deposit: walk ? "0" : deposit,
              fonepayPart,
              reference,
              credit,
            });
      if (
        walk &&
        payments.reduce((s, p) => s + cents(p.current_amount ?? "0"), 0n) <
          cents(payable)
      )
        throw new Error(
          "Walk-in invoice requires full cash or pending Fonepay coverage.",
        );
    } catch (e) {
      financeProblem = (e as Error).message;
    }
  }
  const customers = w.customers.filter(
    (c) =>
      c.is_active &&
      `${c.name} ${c.shop_name} ${c.phone} ${c.address}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const walkProblem =
    walk &&
    ((!simplifiedPayment && (payment === "UNPAID" || payment === "PARTIAL")) ||
      items.some((i) => i.full_jars !== i.empty_jars));
  const custodyProblem =
    !walk &&
    items.some(
      (i) =>
        i.empty_jars >
        (custody.find(
          (c) => c.customer_id === customer && c.product_id === i.product_id,
        )?.quantity ?? 0) +
          i.full_jars,
    );
  const stockProblem = items.some((i) =>
    (
      [
        ["FULL_JAR", i.full_jars],
        ["BOTTLE_CARTON", i.cartons],
      ] as const
    ).some(
      ([kind, quantity]) =>
        quantity >
        (counts.find(
          (c) => c.product_id === i.product_id && c.stock_kind === kind,
        )?.quantity ?? 0),
    ),
  );
  const eligible =
    items.length > 0 &&
    (walk
      ? w.driver_workflow || !!walkName.trim()
      : !!customer && (!w.driver_workflow || !!context)) &&
    (walk || (!lookup.loading && !lookup.error)) &&
    !editor &&
    !walkProblem &&
    !custodyProblem &&
    !stockProblem &&
    !financeProblem;
  const canReview = eligible && (!simplifiedPayment || !!f?.available);
  // Online context and local projection can order object keys differently.
  // Compare canonical business values so that readiness never closes a review.
  const reviewContract = canonical({
    // History arriving after an acknowledgement must not close an unchanged
    // review. Prices, custody, credit, eligibility and physical stock still do.
    context: context
      ? {
          // Workspace contacts omit server audit fields. Those fields do not
          // affect the reviewed customer or their supply eligibility.
          customer: {
            id: context.customer.id,
            name: context.customer.name,
            is_active: context.customer.is_active,
            supply_type: context.customer.supply_type ?? "REGULAR",
            house_status: context.customer.house_status ?? "NONE",
            house_version:
              context.customer.supply_type === "HOUSE"
                ? (context.customer.house_version ?? 0)
                : 0,
          },
          billing: context.billing ?? null,
          prices: context.prices,
          credit: context.credit,
          // The local projection includes explicit zero balances that the online
          // context omits. They are the same business state, not a review change.
          custody: context.custody
            .filter((c) => c.quantity !== 0)
            .map(({ product_id, quantity }) => ({ product_id, quantity }))
            .sort((a, b) => a.product_id.localeCompare(b.product_id)),
          // HOUSE metadata arrives when a new contact is confirmed. It does
          // not change a regular customer's reviewed sale or price.
          house_products:
            context.customer.supply_type === "HOUSE"
              ? (context.house_products ?? [])
              : [],
        }
      : null,
    counts: counts
      .filter((c) => c.quantity !== 0)
      .sort((a, b) =>
        `${a.product_id}:${a.stock_kind}`.localeCompare(
          `${b.product_id}:${b.stock_kind}`,
        ),
      ),
    tax: f?.company?.tax_rate ?? null,
    mode: f?.company?.tax_mode ?? null,
  });
  useEffect(() => {
    queueMicrotask(() => setReview(false));
  }, [reviewContract]);
  const router = useRouter();
  return (
    <div className="space-y-5">
      {!simplifiedPayment && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <T k="Remaining stock is checked again when saving." />
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setReview(false);
              if (runtime) void runtime.refresh();
              else router.refresh();
            }}
          >
            <T k="Refresh stock" />
          </Button>
        </div>
      )}
      {editor && w.driver_workflow && (
        <DeliveryCustomerForm
          key={editor === "edit" ? selected?.id : "new"}
          trip={trip.id}
          detailsEnabled={w.customer_details}
          customer={editor === "edit" ? selected : undefined}
          onCancel={() => setEditor(null)}
          onSaved={(id) => {
            setEditor(null);
            setWalk(false);
            setReview(false);
            setOldAmount("");
            setDeposit("");
            void lookup.selectCustomer(id);
          }}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={walk ? "outline" : "default"}
          onClick={() => {
            setWalk(false);
            setReview(false);
          }}
        >
          <T k="Registered" />
        </Button>
        <Button
          type="button"
          variant={walk ? "default" : "outline"}
          onClick={() => {
            setWalk(true);
            setOldAmount("");
            setDeposit("");
            setReview(false);
          }}
        >
          <T k="Walk-in" />
        </Button>
      </div>
      <OperationForm
        operation={simplifiedPayment ? "driver-visit" : "visit"}
        trip={trip.id}
        requestKey={requestKey}
        showSubmit={review && canReview}
        label="Save Delivery"
        preserveFields
        submitDisabled={!!runtime && runtime.offlinePrepState !== "READY"}
        submitBlockedMessage={offlinePreparingMessage}
        submitHint={
          runtime &&
          runtime.offlinePrepState !== "READY" && (
            <p role="status" className="text-sm text-muted-foreground">
              <T
                k={
                  runtime.offlinePrepState === "FAILED"
                    ? "Offline data is not ready. Retry above."
                    : "Preparing offline data..."
                }
              />
            </p>
          )
        }
        confirm={
          simplifiedPayment
            ? tr(locale, "Save {0}: {1} · {2} · {3}?", [
                walk ? walkName : selected?.name,
                productDeliveries(items, products)
                  .map((i) => deliveryText(i, locale))
                  .join("; "),
                tr(
                  locale,
                  driverStatus === "RETURN_ONLY"
                    ? "Empty jar return"
                    : fullyFree
                      ? "Free Supply"
                      : payment === "UNPAID"
                        ? "Credit"
                        : "Paid",
                ),
                number(npr(payable)),
              ])
            : tr(locale, "Save {0} {1}: {2}? {3}", [
                f?.available
                  ? payments
                      .map((p) =>
                        tr(locale, "{0} {1} NPR (deposit {2})", [
                          t(p.method),
                          number(p.amount),
                          number(p.deposit_amount),
                        ]),
                      )
                      .join("; ")
                  : "",
                walk ? walkName : selected?.name,
                productDeliveries(items, products)
                  .map((i) => deliveryText(i, locale))
                  .join("; "),
                t(
                  f?.available
                    ? "Cash is recorded; Fonepay remains pending."
                    : "Payment remains unverified.",
                ),
              ])
        }
      >
        {simplifiedPayment && (
          <>
            <input type="hidden" name="reviewed_total" value={payable} />
            <input type="hidden" name="payment_status" value={driverStatus} />
            <input
              type="hidden"
              name="received_amount"
              value={
                ["PAID", "FONEPAY"].includes(driverStatus) ? receivedAmount : ""
              }
            />
          </>
        )}
        {f?.available && !simplifiedPayment && (
          <input
            type="hidden"
            name="finance_payments"
            value={JSON.stringify(payments)}
          />
        )}
        <input type="hidden" name="customer" value={walk ? "" : customer} />
        <input type="hidden" name="items" value={JSON.stringify(items)} />
        <input type="hidden" name="walk_name" value={walk ? walkName : ""} />
        <input type="hidden" name="walk_phone" value={walk ? phone : ""} />
        {!simplifiedPayment && (
          <>
            <input
              type="hidden"
              name="payment"
              value={fullyFree ? "FREE_SUPPLY" : payment}
            />
            <input
              type="hidden"
              name="amount"
              value={
                fullyFree || f?.available || payment === "UNPAID" ? "" : amount
              }
            />
            <input type="hidden" name="reference" value={reference} />
          </>
        )}
        <input
          type="hidden"
          name="notes"
          value={simplifiedPayment ? "" : notes}
        />
        {!walk && selected?.supply_type === "HOUSE" && (
          <div className="rounded-lg bg-teal-50 p-4 font-semibold">
            <T k="HOUSE" /> /{" "}
            <T
              k={approvedHouse(selected) ? "Free Supply" : "Approval Required"}
            />
            {fullyFree && (
              <p>
                <T k="No Payment Required" />
              </p>
            )}
          </div>
        )}
        {!review ? (
          <>
            {walk ? (
              <label className="grid gap-2 text-sm font-semibold">
                {" "}
                <T k="Walk-in name (optional)" />{" "}
                <Input
                  value={walkName}
                  maxLength={120}
                  required={!w.driver_workflow}
                  onChange={(e) => setWalkName(e.target.value)}
                />
              </label>
            ) : (
              <div className="space-y-3">
                <label className="grid gap-2 text-sm font-semibold">
                  {" "}
                  <T k="Search active customers" />{" "}
                  <Input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="max-h-64 space-y-2 overflow-auto">
                  {customers.map((c) => (
                    <Button
                      key={c.id}
                      data-customer-id={c.id}
                      type="button"
                      variant={customer === c.id ? "default" : "outline"}
                      className="min-h-14 w-full justify-start whitespace-normal text-left"
                      onClick={() => {
                        void lookup.selectCustomer(c.id);
                        setOldAmount("");
                        setDeposit("");
                        setReview(false);
                      }}
                    >
                      {c.name}
                      {c.shop_name && ` · ${c.shop_name}`}
                      <span className="ml-auto text-xs">{c.phone}</span>
                    </Button>
                  ))}
                  {customers.length === 0 && (
                    <p className="text-sm">
                      <T k="No matching active customers. Add a customer here or use a walk-in for an immediate exchange." />
                    </p>
                  )}
                </div>
                {selected && (
                  <p className="text-sm font-semibold">
                    <T k="Selected: {0}" values={[selected.name]} />
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    id="add-customer"
                    type="button"
                    variant="outline"
                    className="min-h-14"
                    disabled={!w.driver_workflow}
                    onClick={() => {
                      setEditor("new");
                      setReview(false);
                    }}
                  >
                    <T k="Add New Customer" />
                  </Button>
                  {selected && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-14"
                      disabled={!w.driver_workflow || lookup.loading}
                      onClick={() => {
                        setEditor("edit");
                        setReview(false);
                      }}
                    >
                      <T k="Edit customer contact" />
                    </Button>
                  )}
                </div>
                {!w.driver_workflow && (
                  <p role="status" className="text-sm text-amber-800">
                    <T k="The driver customer workflow migration is required for customer creation and unrestricted destination selection." />
                  </p>
                )}
                {lookup.loading && (
                  <p role="status">
                    <T k="Loading customer balances…" />
                  </p>
                )}
                {lookup.error && (
                  <p role="alert" className="text-red-800">
                    <Message value={lookup.error} />{" "}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void lookup.selectCustomer(customer)}
                    >
                      <T k="Retry customer lookup" />
                    </Button>
                  </p>
                )}
                {context && (
                  <DeliveryCustomerHistory
                    context={context}
                    products={w.products}
                  />
                )}
              </div>
            )}
            {walk && (
              <label className="grid gap-2 text-sm font-semibold">
                {" "}
                <T k="Walk-in phone (optional)" />{" "}
                <Input
                  value={phone}
                  maxLength={40}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            )}
            {products.map((p) => {
              const q = quantity(p.id);
              const available = (kind: string) =>
                counts.find(
                  (c) => c.product_id === p.id && c.stock_kind === kind,
                )?.quantity ?? 0;
              return (
                <Card
                  key={p.id}
                  className={
                    simplifiedPayment ? "space-y-3 p-4" : "space-y-5 p-4"
                  }
                >
                  <h3 className="font-semibold">
                    <T k={deliveryHeading(p.kind)} />
                  </h3>
                  <p className="text-sm text-muted-foreground">{p.name}</p>
                  <p className="text-sm">
                    <T
                      k="Unit price: {0} / {1}"
                      values={[
                        <Value
                          key="v0"
                          value={npr(
                            isFree(p)
                              ? "0.00"
                              : ((context?.prices ?? f?.prices)?.find(
                                  (r) =>
                                    r.customer_id ===
                                      (walk ? null : customer) &&
                                    r.product_id === p.id &&
                                    r.active,
                                )?.price ?? p.default_price),
                          )}
                        />,
                        <Message key="v1" value={p.unit} />,
                      ]}
                    />
                  </p>
                  {isFree(p) && (
                    <p className="text-sm text-teal-800">
                      <T k="Free Supply" /> · <T k="Reference Price" />:{" "}
                      <Value
                        value={npr(
                          context?.house_products?.find((h) => h.id === p.id)
                            ?.reference_price ??
                            p.reference_price ??
                            p.default_price,
                        )}
                      />
                    </p>
                  )}
                  {p.kind === "FULL_JAR" ? (
                    <>
                      <p className="text-sm">
                        {" "}
                        <T k="Vehicle:" />{" "}
                        <strong>
                          <T k="{0} full" values={[available("FULL_JAR")]} />
                        </strong>{" "}
                        · {available("EMPTY_JAR")} <T k="empty" />{" "}
                      </p>
                      <Counter
                        label="Jars Delivered"
                        value={q.full_jars}
                        max={p.is_active ? available("FULL_JAR") : 0}
                        onChange={(n) => update(p.id, "full_jars", n)}
                      />
                      <Counter
                        label="Empty Jars Returned"
                        value={q.empty_jars}
                        onChange={(n) => update(p.id, "empty_jars", n)}
                      />
                      {!simplifiedPayment && (
                        <p className="text-sm">
                          <T k="Unreturned Jars" /> (
                          <T k="net change from this visit" />
                          ): <Value value={q.full_jars - q.empty_jars} />
                        </p>
                      )}
                      {!simplifiedPayment && selected && !walk && (
                        <p className="text-xs text-muted-foreground">
                          <T
                            k="Customer holds {0} jars before this visit."
                            values={[
                              <Value
                                key="v0"
                                value={
                                  custody.find(
                                    (c) =>
                                      c.customer_id === customer &&
                                      c.product_id === p.id,
                                  )?.quantity ?? 0
                                }
                              />,
                            ]}
                          />
                        </p>
                      )}
                      {simplifiedPayment && selected && !walk && (
                        <p className="rounded-lg bg-muted p-3 text-sm font-semibold">
                          <T
                            k="Updated Pending Balance: {0}"
                            values={[
                              (custody.find(
                                (c) =>
                                  c.customer_id === customer &&
                                  c.product_id === p.id,
                              )?.quantity ?? 0) +
                                q.full_jars -
                                q.empty_jars,
                            ]}
                          />
                        </p>
                      )}
                      {!simplifiedPayment && selected && !walk && (
                        <div className="rounded-lg bg-muted p-3 text-sm">
                          <p>
                            <T
                              k="Previous Pending Jars: {0}"
                              values={[
                                <Value
                                  key="v0"
                                  value={
                                    custody.find(
                                      (c) =>
                                        c.customer_id === customer &&
                                        c.product_id === p.id,
                                    )?.quantity ?? 0
                                  }
                                />,
                              ]}
                            />
                          </p>
                          <p>
                            <T
                              k="New Delivered Jars: {0} · Empty Jars Collected: {1}"
                              values={[
                                <Value key="v0" value={q.full_jars} />,
                                <Value key="v1" value={q.empty_jars} />,
                              ]}
                            />
                          </p>
                          <p className="font-semibold">
                            <T
                              k="Updated Pending Balance: {0}"
                              values={[
                                <Value
                                  key="v0"
                                  value={
                                    (custody.find(
                                      (c) =>
                                        c.customer_id === customer &&
                                        c.product_id === p.id,
                                    )?.quantity ?? 0) +
                                    q.full_jars -
                                    q.empty_jars
                                  }
                                />,
                              ]}
                            />
                          </p>
                          {context?.pending_jars?.filter(
                            (r) => r.product_id === p.id,
                          ).length ? (
                            <p>
                              <T
                                k="Oldest Pending Date: {0}"
                                values={[
                                  <DateValue
                                    key="v0"
                                    value={
                                      context.pending_jars
                                        .filter((r) => r.product_id === p.id)
                                        .map((r) => r.original_date)
                                        .sort()[0]!
                                    }
                                  />,
                                ]}
                              />
                            </p>
                          ) : (
                            <p>
                              <T k="No earlier pending jars." />
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm">
                        {" "}
                        <T k="Vehicle:" />{" "}
                        <strong>
                          <T
                            k="{0} cartons"
                            values={[available("BOTTLE_CARTON")]}
                          />
                        </strong>
                      </p>
                      <Counter
                        label="Cartons Delivered"
                        value={q.cartons}
                        max={p.is_active ? available("BOTTLE_CARTON") : 0}
                        onChange={(n) => update(p.id, "cartons", n)}
                      />
                    </>
                  )}
                </Card>
              );
            })}
            {fullyFree ? (
              <p className="text-xl font-bold">
                <T k="Total Amount" />: <Value value={npr(payable)} /> ·{" "}
                <T k="No Payment Required" />
              </p>
            ) : simplifiedPayment ? (
              <div className="space-y-4">
                <p className="text-xl font-bold">
                  <T
                    k="Total Amount: {0}"
                    values={[<Value key="payable" value={npr(payable)} />]}
                  />
                </p>
                {!f?.available ? (
                  <p role="alert">
                    <T k="Finance migration required before saving a delivery." />
                  </p>
                ) : !hasSale ? (
                  <p className="text-sm">
                    <T k="Empty jar return" />
                  </p>
                ) : (
                  <>
                    <DriverPayment
                      credit={payment === "UNPAID"}
                      amount={receivedAmount}
                      onCreditChange={(credit) => {
                        setPayment(credit ? "UNPAID" : "CASH");
                        setDriverReceived(null);
                        setReview(false);
                      }}
                      onAmountChange={(value) => {
                        setDriverReceived(value);
                        setReview(false);
                      }}
                    />
                    {payment !== "UNPAID" && (
                      <label className="grid gap-2 text-sm font-semibold">
                        <T k="Payment method" />
                        <select
                          aria-label={t("Payment method")}
                          value={payment}
                          className="min-h-12 rounded-lg border p-3"
                          onChange={(e) => {
                            setPayment(e.target.value);
                            setReview(false);
                          }}
                        >
                          <option value="CASH">
                            <T k="Cash" />
                          </option>
                          <option value="FONEPAY">
                            <T k="Fonepay" />
                          </option>
                        </select>
                        {payment === "FONEPAY" && (
                          <p>
                            <T k="Fonepay remains pending until verified by admin." />
                          </p>
                        )}
                      </label>
                    )}
                  </>
                )}
                {financeProblem && (
                  <p role="alert" className="text-sm text-red-700">
                    <Message value={financeProblem} />
                  </p>
                )}
              </div>
            ) : f?.available ? (
              <div className="space-y-5">
                <p className="text-xl font-bold">
                  <T
                    k="Total Amount: {0}"
                    values={[<Value key="v0" value={npr(payable)} />]}
                  />
                </p>
                <p className="text-sm">
                  <T
                    k="Amount collected: {0} (Fonepay stays pending). Physical quantities are independent of payment amounts."
                    values={[
                      <Value
                        key="v0"
                        value={npr(sum(payments.map((p) => p.amount)))}
                      />,
                    ]}
                  />
                </p>
                <PaymentButtons
                  value={payment}
                  onChange={(v) => {
                    setPayment(v);
                    setAmount("");
                    setFonepayPart("");
                    setReview(false);
                  }}
                />
                {payment !== "UNPAID" && (
                  <AmountInput
                    label="Amount received for this invoice (NPR)"
                    value={amount}
                    onChange={setAmount}
                    required={payment === "PARTIAL"}
                  />
                )}
                {payment === "PARTIAL" && (
                  <AmountInput
                    label="Additional Fonepay amount (pending, NPR)"
                    value={fonepayPart}
                    onChange={setFonepayPart}
                  />
                )}
                <p>
                  <T
                    k="Remaining outstanding after cash: {0}"
                    values={[
                      <Value
                        key="v0"
                        value={npr(
                          decimal(
                            cents(payable) -
                              payments
                                .filter((p) => p.method === "CASH")
                                .reduce(
                                  (s, p) => s + cents(p.current_amount ?? "0"),
                                  0n,
                                ),
                          ),
                        )}
                      />,
                    ]}
                  />
                </p>
                {!walk && selected && (
                  <>
                    <p>
                      <T
                        k="Previous outstanding: {0} - Available: {1}"
                        values={[
                          <Value
                            key="v0"
                            value={npr(sum(credit.map((i) => i.outstanding)))}
                          />,
                          <Value
                            key="v1"
                            value={npr(sum(credit.map((i) => i.available)))}
                          />,
                        ]}
                      />
                    </p>
                    <AmountInput
                      label="Previous credit received (NPR)"
                      value={oldAmount}
                      onChange={setOldAmount}
                    />
                    {(context
                      ? context.billing?.deposit_mode === "MANUAL"
                      : f.billing.some(
                          (b) =>
                            b.customer_id === customer &&
                            b.deposit_mode === "MANUAL",
                        )) && (
                      <AmountInput
                        label="Refundable jar deposit received (NPR)"
                        value={deposit}
                        onChange={setDeposit}
                      />
                    )}
                  </>
                )}
                <label className="grid gap-2 text-sm font-semibold">
                  {" "}
                  <T k="Transaction reference (unverified)" />{" "}
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    maxLength={200}
                  />
                </label>
                <p className="text-sm text-muted-foreground">
                  <T k="Blank cash or Fonepay amount covers the full invoice. Previous credit and deposits use the selected method; unpaid or partial uses cash. Fonepay does not reduce credit until admin reconciliation." />
                </p>
                {financeProblem && (
                  <p role="alert" className="text-red-700">
                    <Message value={financeProblem} />
                  </p>
                )}
              </div>
            ) : (
              <>
                {" "}
                <label className="grid gap-2 text-sm font-semibold">
                  {" "}
                  <T k="Payment instruction" />{" "}
                  <LocalizedSelect
                    value={payment}
                    onChange={(e) => setPayment(e.target.value)}
                    className="min-h-14 rounded-lg border border-input bg-background px-3"
                  >
                    <option value="CASH">
                      <T k="Cash" />
                    </option>
                    <option value="FONEPAY">
                      <T k="Fonepay" />
                    </option>
                    <option value="UNPAID">
                      <T k="Monthly credit / unpaid" />
                    </option>
                    <option value="PARTIAL">
                      <T k="Partial payment" />
                    </option>
                  </LocalizedSelect>
                </label>
                {payment !== "UNPAID" && (
                  <label className="grid gap-2 text-sm font-semibold">
                    {" "}
                    <T k="Reported amount (NPR)" />{" "}
                    <Message value={payment !== "PARTIAL" && " — optional"} />
                    <Input
                      inputMode="decimal"
                      value={amount}
                      required={payment === "PARTIAL"}
                      pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                      maxLength={15}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                )}
                <label className="grid gap-2 text-sm font-semibold">
                  {" "}
                  <T k="Reference (optional)" />{" "}
                  <Input
                    value={reference}
                    maxLength={200}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
              </>
            )}
            {!simplifiedPayment && (
              <label className="grid gap-2 text-sm font-semibold">
                {" "}
                <T k="Visit notes" />{" "}
                <Input
                  value={notes}
                  maxLength={2000}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            )}
            {!simplifiedPayment && (
              <p className="text-lg font-bold">
                <T
                  k="Indicative delivery value: NPR {0}"
                  values={[<Value key="total" value={total} />]}
                />
              </p>
            )}
            {!simplifiedPayment && (
              <p className="text-sm text-muted-foreground">
                <Message
                  value={
                    f?.available
                      ? "Server confirms approved prices and exact tax at saving. Deposits are separate from sales."
                      : "Server snapshots current default prices. Finance migration is required for settlement."
                  }
                />
              </p>
            )}
            {walkProblem && (
              <p role="alert" className="text-sm text-red-700">
                <T k="Walk-in jars need an equal empty exchange. Register the customer for jar custody or credit." />
              </p>
            )}
            {custodyProblem && (
              <p role="alert" className="text-sm text-red-700">
                <T k="Empty collection exceeds the customer's tracked jars. Ask admin to verify legacy custody first." />
              </p>
            )}
            {stockProblem && (
              <p role="alert" className="text-sm text-red-700">
                <T k="This draft exceeds the remaining vehicle stock. Correct the quantities before reviewing the delivery." />
              </p>
            )}
            <Button
              type="button"
              className="min-h-14 w-full"
              disabled={!canReview}
              onClick={() => setReview(true)}
            >
              <T k="Review delivery" />
            </Button>
          </>
        ) : (
          <div className="space-y-4 rounded-lg bg-muted p-5">
            <h3 className="text-lg font-semibold">
              <T k="Confirm delivery" />
            </h3>
            <p>{walk ? walkName : selected?.name}</p>
            {productDeliveries(items, products).map((line) => (
              <ProductDeliverySummary
                key={line.product_id}
                line={line}
                previousBalance={
                  walk
                    ? undefined
                    : (custody.find(
                        (c) =>
                          c.customer_id === customer &&
                          c.product_id === line.product_id,
                      )?.quantity ?? 0)
                }
              />
            ))}
            {simplifiedPayment ? (
              <p>
                <T k="Payment Status" />:{" "}
                <T
                  k={
                    driverStatus === "RETURN_ONLY"
                      ? "Empty jar return"
                      : fullyFree
                        ? "Free Supply"
                        : payment === "UNPAID"
                          ? "Credit"
                          : payment === "FONEPAY"
                            ? "Fonepay"
                            : "Paid"
                  }
                />{" "}
                · <T k="Total Amount" />: <Value value={npr(payable)} />
              </p>
            ) : (
              <p>
                <T
                  k="NPR {0} · {1} · {2}"
                  values={[
                    <Value key="payable" value={payable} />,
                    <Message key="method" value={payment} />,
                    amount ? (
                      <Value key="amount" value={amount} />
                    ) : (
                      <T key="no-amount" k="No amount reported" />
                    ),
                  ]}
                />
              </p>
            )}
            {f?.available &&
              !simplifiedPayment &&
              payments.map((p, index) => (
                <p key={index}>
                  <T
                    k="{0}: NPR {1} - current invoice {2}, prior credit {3}, deposit {4}"
                    values={[
                      <Message key="v0" value={p.method} />,
                      <Value key="amount" value={p.amount} />,
                      <Value key="current" value={p.current_amount} />,
                      <Value
                        key="prior"
                        value={sum(p.allocations.map((a) => a.amount))}
                      />,
                      <Value key="deposit" value={p.deposit_amount} />,
                    ]}
                  />
                </p>
              ))}
            {!simplifiedPayment && (
              <p className="text-sm">
                <Message
                  value={
                    f?.available
                      ? "Invoices, cash receipts and credit are posted atomically. Fonepay stays pending."
                      : "This saves an immutable visit. Financial settlement remains pending."
                  }
                />
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setReview(false)}
            >
              <T k="Correct quantities" />
            </Button>
          </div>
        )}
      </OperationForm>
    </div>
  );
}
export function ReturnForm({
  workspace: w,
  trip,
  requestKey,
  admin,
}: {
  workspace: Workspace;
  trip: Trip;
  requestKey: string;
  admin: boolean;
}) {
  const expected = vehicleCounts(w, trip);
  const { locale, t } = useLocale();
  const [values, setValues] = useState<Record<string, number>>({});
  const actual: Count[] = expected.map((c) => ({
    ...c,
    quantity: values[`${c.product_id}:${c.stock_kind}`] ?? c.quantity,
  }));
  const discrepancy = actual.some(
    (c, i) => c.quantity !== expected[i]!.quantity,
  );
  return (
    <OperationForm
      operation={admin ? "reconcile" : "submit"}
      trip={trip.id}
      requestKey={requestKey}
      label={admin ? "Post physical verification" : "Submit warehouse returns"}
      confirm={
        admin
          ? "Post these verified returns? Balanced counts or an explicit variance approval will close the physical trip."
          : "Submit these end-of-trip counts for admin verification? Deliveries will be locked."
      }
    >
      <input type="hidden" name="counts" value={JSON.stringify(actual)} />
      <p className="text-sm text-muted-foreground">
        <Message
          value={
            admin
              ? "Verify actual physical returns. Unsold full jars and collected empties stay separate."
              : "Count the stock on your vehicle. Submission does not transfer stock to the warehouse."
          }
        />
      </p>
      {expected.map((c) => {
        const key = `${c.product_id}:${c.stock_kind}`;
        const declared = w.declarations.find(
          (d) => d.product_id === c.product_id && d.stock_kind === c.stock_kind,
        )?.quantity;
        return (
          <div
            key={key}
            className="space-y-3 rounded-xl border border-border p-4"
          >
            <p className="font-semibold">
              {w.products.find((p) => p.id === c.product_id)?.name}
            </p>
            <p className="text-sm">
              <T
                k="Expected: {0} {1}"
                values={[
                  <Value key="v0" value={c.quantity} />,
                  admin && (
                    <T
                      key="declared"
                      k=" · Driver declared: {0}"
                      values={[declared ?? <T k="Not declared" />]}
                    />
                  ),
                ]}
              />
            </p>
            <Counter
              label={tr(locale, admin ? "{0} verified" : "{0} counted", [
                t(stockLabels[c.stock_kind]),
              ])}
              value={values[key] ?? c.quantity}
              onChange={(n) => setValues({ ...values, [key]: n })}
            />
          </div>
        );
      })}
      {admin && (
        <>
          <Field
            name="reason"
            label="Verification / discrepancy reason"
            required
            maxLength={500}
          />
          {discrepancy && (
            <label className="flex min-h-14 items-start gap-3 rounded-lg bg-amber-50 p-4 text-sm">
              <input
                type="checkbox"
                name="accept_variance"
                className="mt-1 size-5"
              />{" "}
              <T k="Explicitly approve the recorded variance and close. Leave unchecked to flag DISCREPANCY without moving warehouse stock." />{" "}
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            <T k="Physical closure does not settle payments or close the business day." />
          </p>
        </>
      )}
    </OperationForm>
  );
}
