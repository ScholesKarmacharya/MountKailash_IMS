"use client";
import { createContext, useContext } from "react";
import type { OperationState } from "@/app/operations-actions";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";

export type OfflinePrepState = "IDLE" | "PREPARING" | "READY" | "FAILED";
export const offlinePreparingMessage =
  "Offline data is still being prepared. Please wait a moment.";

export type DriverRuntime = {
  offlinePrepState: OfflinePrepState;
  revision: string;
  cachedCustomer: (customer: string) => DeliveryCustomerContext | undefined;
  customer: (
    trip: string,
    customer: string,
    signal: AbortSignal,
  ) => Promise<DeliveryCustomerContext>;
  submit: (form: FormData) => Promise<OperationState>;
  refresh: () => Promise<void>;
  next: () => void;
};
export const DriverRuntimeContext = createContext<DriverRuntime | null>(null);
export const useDriverRuntime = () => useContext(DriverRuntimeContext);
export const driverPaths = [
  "/driver/instant-delivery",
  "/driver/home",
  "/driver/delivery",
  "/driver/customers",
  "/driver/pending-jars",
  "/driver/sales",
  "/driver/return",
];
