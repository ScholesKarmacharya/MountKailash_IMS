export const roles = ["ADMIN", "DRIVER"] as const;
export type Role = (typeof roles)[number];
export type Profile = {
  id: string;
  name: string;
  role: Role;
  is_active: boolean;
};
export type Permission =
  | "admin:read"
  | "driver:read"
  | "trip:assign"
  | "trip:approve"
  | "trip:operate"
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
  return (
    profile.role === "ADMIN" ||
    permission === "driver:read" ||
    permission === "payment:record" ||
    permission === "trip:operate"
  );
}
