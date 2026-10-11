import type { Metadata } from "next";
import "./globals.css";
// Identity and runtime configuration must be checked on every request, even
// when the build environment does not contain Supabase credentials.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "Mount Kailash · Operations",
    template: "%s · Mount Kailash",
  },
  description: "Water distribution operations. Sprint 0 foundation.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
