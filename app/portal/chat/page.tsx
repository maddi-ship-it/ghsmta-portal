import type {
  ChatChannel,
  ChatMember,
  ChatThread,
} from "@/components/teams-chat";
import { TeamsChat } from "@/components/teams-chat";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
  let members: ChatMember[] = [];

  if (selectedChannel) {
    const [threadResult, memberResult] = await Promise.all([
      supabase.rpc("get_chat_channel_threads", {
        p_channel_id: selectedChannel.channel_id,
      }),
      supabase.rpc("get_chat_channel_members", {
        p_channel_id: selectedChannel.channel_id,
      }),
    ]);

    if (threadResult.error) {
      throw new Error(threadResult.error.message);
    }

    if (memberResult.error) {
      throw new Error(memberResult.error.message);
    }

    threads = (threadResult.data ?? []) as ChatThread[];
    members = (memberResult.data ?? []) as ChatMember[];

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
            Community Chat uses threaded discussions for applicants and owners. School DMs and staff channels use a live message feed.
          </p>
        </div>
      </div>

      <TeamsChat
        key={selectedChannel?.channel_id ?? "no-channel"}
        initialChannels={channels}
        initialMembers={members}
        initialThreads={threads}
        profile={profile}
        selectedChannelId={selectedChannel?.channel_id ?? null}
      />
    </>
  );
}
