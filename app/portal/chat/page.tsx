import type {
  ChatChannel,
  ChatMember,
  ChatThread,
} from "@/components/teams-chat";
import { TeamsChat } from "@/components/teams-chat";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type RawChannel = Partial<ChatChannel> & {
  channel_id: string;
  channel_type: ChatChannel["channel_type"];
  channel_name: string;
};

function fallbackChannelGroup(
  channelType: ChatChannel["channel_type"],
  archived: boolean,
) {
  if (archived) {
    return {
      key: "archived",
      label: "Archived conversations",
      order: 60,
    };
  }

  switch (channelType) {
    case "applicant_community":
      return { key: "community", label: "Community", order: 10 };
    case "general":
    case "networking":
      return { key: "staff", label: "Staff channels", order: 20 };
    case "advisory_committee":
      return { key: "committee", label: "Advisory Committee", order: 30 };
    case "school_dm":
      return { key: "direct_messages", label: "School DMs", order: 40 };
    case "school":
      return {
        key: "school_staff",
        label: "School staff channels",
        order: 50,
      };
  }
}

function fallbackVisibilityLabel(channelType: ChatChannel["channel_type"]) {
  switch (channelType) {
    case "applicant_community":
      return "Applicants + Owners";
    case "general":
    case "networking":
      return "Adjudicators + Advisory + Owners";
    case "advisory_committee":
      return "Advisory + Owners";
    case "school_dm":
      return "School + Owners";
    case "school":
      return "Assigned panel + Owners";
  }
}

function normalizeChannels(rows: RawChannel[]): ChatChannel[] {
  return rows.map((row) => {
    const archived = Boolean(row.application_archived);
    const group = fallbackChannelGroup(row.channel_type, archived);

    return {
      channel_id: row.channel_id,
      channel_type: row.channel_type,
      channel_name: row.channel_name,
      channel_description: row.channel_description ?? null,
      application_id: row.application_id ?? null,
      school_name: row.school_name ?? null,
      production_title: row.production_title ?? null,
      application_archived: archived,
      last_activity_at: row.last_activity_at ?? new Date(0).toISOString(),
      unread_count: Number(row.unread_count ?? 0),
      latest_message_preview: row.latest_message_preview ?? null,
      latest_author_name: row.latest_author_name ?? null,
      channel_group: row.channel_group ?? group.key,
      channel_group_label: row.channel_group_label ?? group.label,
      channel_group_order: Number(row.channel_group_order ?? group.order),
      visibility_label:
        row.visibility_label ?? fallbackVisibilityLabel(row.channel_type),
    };
  });
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; archive?: string }>;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const params = await searchParams;

  const richChannelResult = await supabase.rpc("get_my_chat_channels_v2");
  let channelRows = richChannelResult.data as RawChannel[] | null;
  let channelError = richChannelResult.error;

  // This fallback keeps the chat page usable if the code deploy reaches Vercel
  // a few minutes before migration 018 is run.
  if (channelError) {
    const legacyResult = await supabase.rpc("get_my_chat_channels");
    channelRows = legacyResult.data as RawChannel[] | null;
    channelError = legacyResult.error;
  }

  if (channelError) {
    throw new Error(`Chat channels could not be loaded: ${channelError.message}`);
  }

  const normalizedChannels = normalizeChannels(channelRows ?? []);
  const requestedChannel = normalizedChannels.find(
    (channel) => channel.channel_id === params.channel,
  );
  const archiveMode =
    profile.role === "owner" &&
    (params.archive === "1" || Boolean(requestedChannel?.application_archived));
  let channels = normalizedChannels.filter((channel) =>
    archiveMode
      ? channel.application_archived
      : !channel.application_archived,
  );
  const visibleRequestedChannel = channels.find(
    (channel) => channel.channel_id === params.channel,
  );
  const selectedChannel = visibleRequestedChannel ?? channels[0] ?? null;

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
      throw new Error(`Chat messages could not be loaded: ${threadResult.error.message}`);
    }

    if (memberResult.error) {
      throw new Error(`Chat members could not be loaded: ${memberResult.error.message}`);
    }

    threads = (threadResult.data ?? []) as ChatThread[];
    members = (memberResult.data ?? []) as ChatMember[];

    const readResult = await supabase.rpc("mark_chat_channel_read", {
      p_channel_id: selectedChannel.channel_id,
    });

    if (!readResult.error) {
      channels = channels.map((channel) =>
        channel.channel_id === selectedChannel.channel_id
          ? { ...channel, unread_count: 0 }
          : channel,
      );
    }
  }

  return (
    <>
      <div className="page-heading chat-page-heading">
        <div>
          <span className="eyebrow">Communication</span>
          <h1>GHSMTA Chat</h1>
          <p>
            Community discussions, private school DMs, and assigned panel
            channels in one workspace.
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
