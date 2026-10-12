export const roles = ["ADMIN", "DRIVER"] as const;
export type Role = (typeof roles)[number];
export const approvalStatuses = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];
export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return approvalStatuses.includes(value as ApprovalStatus);
}
export const approvalLabels: Record<ApprovalStatus, string> = {
  PENDING: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};
export type Profile = {
  id: string;
  name: string;
  role: Role;
  is_active: boolean;
  approval_status?: ApprovalStatus;
  phone?: string;
  email?: string;
  version?: number;
  approved_at?: string | null;
};
export type Permission =
  | "admin:read"
  | "driver:read"
  | "trip:assign"
  | "trip:approve"
  | "trip:operate"
  | "customer:operate"
  | "stock:adjust"
  | "product:manage"
  | "day:open"
  | "finance:manage"
  | "payment:record"
  | "day:close";
export function isRole(value: unknown): value is Role {
  return value === "ADMIN" || value === "DRIVER";
}
export function homeFor(role: Role) {
  return role === "ADMIN" ? "/admin/dashboard" : "/driver/home";
}
export function can(profile: Profile | null, permission: Permission): boolean {
  if (!profile?.is_active || !isRole(profile.role)) return false;
  // Undefined means the trusted database still uses the pre-approval schema.
  // Explicit statuses always fail closed unless approved.
  if (
    profile.role === "DRIVER" &&
    profile.approval_status !== undefined &&
    profile.approval_status !== "APPROVED"
  )
    return false;
  return (
    profile.role === "ADMIN" ||
    permission === "driver:read" ||
    permission === "payment:record" ||
    permission === "customer:operate" ||
    permission === "trip:operate"
  );
}
export function accountHome(profile: Profile | null) {
  if (!profile) return "/account";
  return can(profile, "driver:read") ? homeFor(profile.role) : "/account";
}
