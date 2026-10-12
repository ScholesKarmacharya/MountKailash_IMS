import { uuid } from "@/domain/inventory/validation";
import { isApprovalStatus, type ApprovalStatus } from "./roles";
import type { Command } from "@/domain/operations/commands";
export type DriverAccount = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  version: number;
  is_active: boolean;
  approval_status: ApprovalStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  status_changed_at: string | null;
  assigned_vehicles: string[];
  recent_activity: string | null;
};
export function parseAccountCommand(form: FormData): Command {
  const text = (name: string, min: number, max: number) => {
    const value = form.get(name);
    if (
      typeof value !== "string" ||
      value.trim().length < min ||
      value.trim().length > max
    )
      throw new Error(
        "Enter valid account details and a reason for admin changes.",
      );
    return value.trim();
  };
  const version = text("version", 1, 9);
  if (!/^\d+$/.test(version)) throw new Error("Invalid account version.");
  const common = {
    p_version: Number(version),
    p_key: uuid(text("key", 36, 36)),
  };
  const operation = text("operation", 1, 30);
  if (operation === "account:profile")
    return {
      admin: false,
      rpc: "save_own_profile",
      args: {
        ...common,
        p_name: text("name", 1, 120),
        p_phone: text("phone", 0, 40),
      },
    };
  const admin = {
    ...common,
    p_id: uuid(text("id", 36, 36)),
    p_reason: text("reason", 3, 500),
  };
  if (operation === "account:driver")
    return {
      admin: true,
      rpc: "save_driver_account",
      args: {
        ...admin,
        p_name: text("name", 1, 120),
        p_phone: text("phone", 0, 40),
        p_approve: form.get("approve") === "true",
      },
    };
  if (operation === "account:status") {
    const status = text("status", 1, 20);
    if (!isApprovalStatus(status) || status === "PENDING")
      throw new Error("Invalid driver approval action.");
    return {
      admin: true,
      rpc: "change_driver_status",
      args: { ...admin, p_status: status },
    };
  }
  throw new Error("Invalid account operation.");
}
