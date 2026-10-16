export type DriverOfflineAccess = {
  available: boolean;
  trip_id: string | null;
  trip_number: number | null;
  vehicle: string | null;
  status:
    | "Needs update"
    | "No device registered"
    | "Offline access active"
    | "Previous device revoked"
    | "No active trip";
  device_registered: boolean;
  registered_at: string | null;
  last_synced_at: string | null;
  reported_pending: number | null;
  review_count: number | null;
  retry_count: number | null;
  reset_pending: boolean;
  can_reset: boolean;
};
