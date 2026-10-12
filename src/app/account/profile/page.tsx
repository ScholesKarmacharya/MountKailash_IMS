import Link from "next/link";
import { requireIdentity } from "@/services/auth";
import { readCurrentProfile } from "@/data-access/profiles";
import { accountHome, approvalLabels } from "@/domain/auth/roles";
import { T, Message, DateValue } from "@/components/localization";
import { Card } from "@/components/ui/card";
import { OwnProfileForm } from "@/components/account-forms";
export default async function Page() {
  const user = await requireIdentity(),
    profile = await readCurrentProfile();
  return (
    <>
      <Link className="text-primary underline" href={accountHome(profile)}>
        <T k="Back to workspace" />
      </Link>
      <Card className="space-y-5">
        <h1 className="text-2xl font-bold">
          <T k="My Profile" />
        </h1>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">
              <T k="Email address" />
            </dt>
            <dd className="break-all">{user.email}</dd>
          </div>
          {profile?.role === "DRIVER" && (
            <div>
              <dt className="text-muted-foreground">
                <T k="Account Status" />
              </dt>
              <dd>
                <Message
                  value={
                    approvalLabels[
                      profile.approval_status ??
                        (profile.is_active ? "APPROVED" : "SUSPENDED")
                    ]
                  }
                />
              </dd>
            </div>
          )}
          {profile?.approved_at && (
            <div>
              <dt className="text-muted-foreground">
                <T k="Approval date" />
              </dt>
              <dd>
                <DateValue value={profile.approved_at} time />
              </dd>
            </div>
          )}
        </dl>
        {profile && profile.approval_status === undefined ? (
          <p role="status">
            <T k="The driver approval migration is required." />
          </p>
        ) : (
          <OwnProfileForm profile={profile} />
        )}
      </Card>
    </>
  );
}
