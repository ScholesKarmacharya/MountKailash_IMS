import { T } from "@/components/localization";
import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main-content" className="p-8">
      <h1 className="text-2xl font-bold">
        <T k="Page not found" />
      </h1>
      <Link href="/" className="mt-4 inline-block underline">
        <T k="Return to workspace" />
      </Link>
    </main>
  );
}
