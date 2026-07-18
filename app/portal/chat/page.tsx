import { TeamsChat } from "@/components/teams-chat";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ChatChannel, ChatThread } from "@/components/teams-chat";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const params = await searchParams;

  const { data: channelData, error: channelError } = await supabase.rpc(
    "get_my_chat_channels",
  );

  if (channelError) {
    throw new Error(channelError.message);
  }

  const channels = (channelData ?? []) as ChatChannel[];
  const requestedChannel = channels.find(
    (channel) => channel.channel_id === params.channel,
  );
  const selectedChannel = requestedChannel ?? channels[0] ?? null;

  let threads: ChatThread[] = [];

  if (selectedChannel) {
    const { data, error } = await supabase.rpc(
      "get_chat_channel_threads",
      { p_channel_id: selectedChannel.channel_id },
    );

    if (error) {
      throw new Error(error.message);
    }

    threads = (data ?? []) as ChatThread[];

    await supabase.rpc("mark_chat_channel_read", {
      p_channel_id: selectedChannel.channel_id,
    });
  }

  return (
    <>
      <div className="page-heading chat-page-heading">
        <div>
          <span className="eyebrow">Communication</span>
          <h1>GHSMTA Chat</h1>
          <p>
            Teams-style channels for schools, adjudicators, applicants,
            owners, and the advisory committee.
          </p>
        </div>
      </div>

      <TeamsChat
        key={selectedChannel?.channel_id ?? "no-channel"}
        initialChannels={channels}
        initialThreads={threads}
        profile={profile}
        selectedChannelId={selectedChannel?.channel_id ?? null}
      />
    </>
  );
}
