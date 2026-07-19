import { NotificationCenter } from "@/components/notification-center";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_notifications")
    .select("id,notification_type,title,body,href,read_at,created_at,related_application_id")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Updates</span>
          <h1>Notifications</h1>
          <p>Approvals, appeals, scheduling reminders, and review requests.</p>
        </div>
      </div>
      <NotificationCenter initialNotifications={data ?? []} userId={profile.id} />
    </>
  );
}
