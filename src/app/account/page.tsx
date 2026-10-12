import Link from "next/link";
import { redirect } from "next/navigation";
import { readCurrentProfile } from "@/data-access/profiles";
import { can, accountHome, approvalLabels } from "@/domain/auth/roles";
import { T, Message } from "@/components/localization";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OwnProfileForm } from "@/components/account-forms";
import { requireIdentity } from "@/services/auth";
export default async function Page() {
  await requireIdentity();
  const profile = await readCurrentProfile();
  if (can(profile, "driver:read")) redirect(accountHome(profile));
  const status =
    profile?.approval_status ??
    (profile && !profile.is_active ? "SUSPENDED" : "PENDING");
  return (
    <Card className="space-y-5">
      <h1 className="text-2xl font-bold">
        <Message
          value={
            profile?.role === "ADMIN"
              ? "Account access is unavailable."
              : status === "PENDING"
                ? "Waiting for Admin Approval"
                : approvalLabels[status]
          }
        />
      </h1>
      {profile && (
        <p className="font-semibold">
          {profile.name || <T k="Delivery Driver" />}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        <T k="Operational access is unavailable until an administrator approves your account. Contact your warehouse administrator." />
      </p>
      {!profile ? (
        <>
          <p className="text-sm">
            <T k="Complete your full name and phone details to submit your account for review." />
          </p>
          <OwnProfileForm profile={null} />
        </>
      ) : (
        <>
          <p>
            <T k="Account Status" />:{" "}
            <Message
              value={
                profile.role === "ADMIN"
                  ? "Account access is unavailable."
                  : approvalLabels[status]
              }
            />
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/account/profile">
                <T k="My Profile" />
              </Link>
            </Button>
            <Button asChild>
              <a href="/account">
                <T k="Check approval status" />
              </a>
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
