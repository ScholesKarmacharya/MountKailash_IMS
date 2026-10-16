import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { offlineIdentity } from "./offline";
import { offlineRpc, OfflineServerError } from "@/data-access/offline";
import { uuid } from "@/domain/inventory/validation";
import type { DeviceSecrets } from "@/lib/offline/device";

function recoveryKey() {
  const key = process.env.OFFLINE_DEVICE_RECOVERY_KEY;

  if (!key || key.length < 6) {
    throw new OfflineServerError(
      "CONFIGURATION",
      "Secure device recovery is not configured. Contact the admin before setting up a PIN.",
      503,
    );
  }

  return createHash("sha256").update(key, "utf8").digest();
}
function wrap(user: string, device: string, value: DeviceSecrets) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", recoveryKey(), iv);
  cipher.setAAD(Buffer.from(`${user}:${device}`));
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    cipher: bytes.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  });
}
function unwrap(user: string, device: string, box: string): DeviceSecrets {
  const value = JSON.parse(box),
    decipher = createDecipheriv(
      "aes-256-gcm",
      recoveryKey(),
      Buffer.from(value.iv, "base64"),
    );
  decipher.setAAD(Buffer.from(`${user}:${device}`));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(value.cipher, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
async function markDevice() {
  (await cookies()).set("mk-driver-device", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" && process.env.OFFLINE_E2E !== "1",
    path: "/",
    maxAge: 31536000,
  });
}
export async function trustedDeviceCommand(body: Record<string, unknown>) {
  const profile = await offlineIdentity(),
    device = uuid(String(body.device));
  if (body.action === "automatic-register") {
    if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token))
      throw new OfflineServerError("INVALID", "Invalid offline record.", 400);
    // Check the trip BEFORE registering this installation. Otherwise a failed
    // legacy-round transfer leaves an unrelated approved device behind.
    if (body.trip !== undefined)
      await offlineRpc("offline_preparation_access", {
        p_trip: uuid(String(body.trip)),
        p_device: device,
        p_token: body.token,
      });
    const result = await offlineRpc("trusted_device_register", {
      p_device: device,
      p_token: body.token,
      p_name: "Driver phone",
      // Automatic keys stay on the installation; no user password or key upload.
      p_recovery: JSON.stringify({
        version: 2,
        automatic: true,
        keyStoredOnDevice: true,
      }),
    });
    await markDevice();
    return result;
  }
  if (body.action === "register") {
    const value = body.secrets as DeviceSecrets | undefined;
    if (
      !value ||
      value.device !== device ||
      typeof value.secret !== "string" ||
      value.secret.length < 8 ||
      value.secret.length > 256 ||
      !/^[a-f0-9]{64}$/.test(value.token)
    )
      throw new OfflineServerError("INVALID", "Invalid offline record.", 400);
    const result = await offlineRpc("trusted_device_register", {
      p_device: device,
      p_token: value.token,
      p_name: String(body.name ?? "Driver phone").slice(0, 120),
      p_recovery: wrap(profile.id, device, value),
    });
    await markDevice();
    return result;
  }
  if (body.action === "recover") {
    // Reauthenticate with Supabase, even if an old session cookie is valid.
    // Never retain credentials in IndexedDB or in the recovery envelope.
    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (
      !user?.email ||
      typeof body.password !== "string" ||
      !body.password ||
      body.password.length > 256
    )
      throw new OfflineServerError(
        "AUTHENTICATION",
        "Online reauthentication failed. Check your password.",
        401,
      );
    const { data, error } = await client.auth.signInWithPassword({
      email: user.email,
      password: body.password,
    });
    if (error || data.user?.id !== profile.id)
      throw new OfflineServerError(
        "AUTHENTICATION",
        "Online reauthentication failed. Check your password.",
        401,
      );
    await offlineIdentity();
    const box = await offlineRpc<string>("trusted_device_recovery", {
      p_device: device,
    });
    await markDevice();
    return unwrap(profile.id, device, box);
  }
  if (body.action === "remove") {
    await offlineRpc("trusted_device_revoke", {
      p_device: device,
      p_reason: "Driver removed a synced and sealed device",
    });
    (await cookies()).delete("mk-driver-device");
    return { removed: true };
  }
  throw new OfflineServerError("INVALID", "Invalid offline record.", 400);
}
