import { T } from "@/components/localization";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { LocaleProvider } from "@/components/localization";
import { getLocale } from "@/lib/i18n/server";
// Identity and runtime configuration must be checked on every request, even
// when the build environment does not contain Supabase credentials.
export const dynamic = "force-dynamic";
const businessFont = localFont({
  src: "../../assets/fonts/NotoSansDevanagari.ttf",
  variable: "--font-business",
  display: "swap",
});
export const metadata: Metadata = {
  title: {
    default: "Mount Kailash · Operations",
    template: "%s · Mount Kailash",
  },
  description: "Water distribution operations. Sprint 0 foundation.",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className={businessFont.variable}>
        <LocaleProvider initialLocale={locale}>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3"
          >
            <T k="Skip to content" />
          </a>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
