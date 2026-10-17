import { DriverApplication } from "@/components/driver-application";
import type { Viewport } from "next";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};
// Public cached shell contains no business data; only the authorized encrypted vault can restore it.
export default function Page() {
  return <DriverApplication />;
}
