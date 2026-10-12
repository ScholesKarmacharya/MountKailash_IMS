import { T, Message } from "@/components/localization";
import Link from "next/link";
export function OperationsHeading({
  title,
  description,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
}) {
  return (
    <div className="mb-7">
      <h1 className="text-3xl font-bold">
        <Message value={title} />
      </h1>
      <p className="mt-2 text-muted-foreground">
        <Message value={description} />
      </p>
    </div>
  );
}
export function MigrationRequired() {
  return (
    <p role="status" className="rounded-lg bg-amber-50 p-5 text-amber-900">
      <T k="Sprint 2 migrations are required. No trip or customer data has been created. Review the migration instructions before updating Supabase Cloud." />
    </p>
  );
}
export function TripLink({
  id,
  number,
  base = "/admin/trips",
}: {
  id: string;
  number: number;
  base?: string;
}) {
  return (
    <Link
      className="font-semibold text-primary underline"
      href={`${base}/${id}`}
    >
      <T k="Trip #{0}" values={[number]} />
    </Link>
  );
}
