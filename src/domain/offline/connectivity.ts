export type Connectivity =
  | "CHECKING"
  | "ONLINE"
  | "OFFLINE"
  | "SERVER_UNAVAILABLE"
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "DATABASE";
// Only failure to reach our independent authenticated probe is a device network
// interruption. An HTTP response proves the app server is reachable.
export function connectivityFailure(error: {
  code?: string;
  status?: number;
}): Connectivity {
  if (error.code === "NETWORK" && !error.status) return "OFFLINE";
  if (error.status === 401) return "AUTHENTICATION";
  if (error.status === 403) return "AUTHORIZATION";
  if (["SCHEMA", "MIGRATION_REQUIRED"].includes(error.code ?? ""))
    return "DATABASE";
  return "SERVER_UNAVAILABLE";
}
