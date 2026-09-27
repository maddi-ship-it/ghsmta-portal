import { NotificationCenter } from "@/components/notification-center";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [notificationResult, richChannelResult] = await Promise.all([
    supabase
      .from("user_notifications")
      .select(
        "id,notification_type,title,body,href,read_at,created_at,related_application_id",
      )
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.rpc("get_my_chat_channels_v4"),
  ]);
  let channelData = richChannelResult.data;
  let channelError = richChannelResult.error;

  if (channelError) {
    const fallbackResult = await supabase.rpc("get_my_chat_channels_v3");
    channelData = fallbackResult.data;
    channelError = fallbackResult.error;
  }

  if (channelError) {
    const legacyResult = await supabase.rpc("get_my_chat_channels");
    channelData = legacyResult.data;
    channelError = legacyResult.error;
  }

  if (notificationResult.error) {
    throw new Error(notificationResult.error.message);
  }

  if (channelError) {
    throw new Error(channelError.message);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Updates</span>
          <h1>Notifications</h1>
          <p>
            Unread messages, approvals, appeals, scheduling reminders,
            and review requests.
          </p>
        </div>
      </div>

      <NotificationCenter
        initialNotifications={notificationResult.data ?? []}
        initialChatChannels={channelData ?? []}
        userId={profile.id}
      />
    </>
  );
}
