import type {
  AdjudicationVisitDetails,
  ChatChannel,
  ChatMember,
  ChatThread,
  PanelContact,
} from "@/components/teams-chat";
import { TeamsChat } from "@/components/teams-chat";
import {
  buildApplicationReferencePanels,
  type ApplicationEligibilityAppeal,
  type ApplicationReferencePanel,
} from "@/lib/application-reference-panels";
import { requireProfile } from "@/lib/auth";
import {
  ADJUDICATOR_CHANNELS_LABEL,
  chatChannelDisplayName,
  chatChannelGroupLabel,
} from "@/lib/chat-terminology";
import {
  presentPortalAuthoredChannel,
  presentPortalAuthoredThread,
} from "@/lib/chat/portal-authored";
import {
  buildCommunityShows,
  type CommunityShow,
} from "@/lib/community-shows";
import {
  buildUpcomingAdjudications,
  type UpcomingAdjudication,
} from "@/lib/chat/upcoming-adjudications";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Application,
  ApplicationAnswer,
  ApplicationQuestion,
  AppRole,
} from "@/lib/types";

type RawChannel = Partial<ChatChannel> & {
  channel_id: string;
  channel_type: ChatChannel["channel_type"];
  channel_name: string;
};

type ScheduleBookingReference = {
  slot_id: string;
  application_id: string;
};

type ScheduleSlotReference = {
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  school_instructions: string | null;
};

type ScheduleSchoolDetailsReference = {
  venue_name: string | null;
  venue_address: string | null;
  arrival_entrance: string | null;
  parking_instructions: string | null;
  accessibility_notes: string | null;
  wifi_network: string | null;
  wifi_password: string | null;
  day_of_contact_name: string | null;
  day_of_contact_phone: string | null;
};

type PanelAssignmentReference = {
  adjudicator_user_id: string;
  participant_role: AppRole | null;
};

type PanelProfileReference = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone_e164: string | null;
  role: AppRole;
};

type CommunityShowApplicationRow = {
  id: string;
  form_version_id: string | null;
  school_name: string;
  production_title: string | null;
};

type CommunityShowQuestionRow = {
  id: string;
  question_key: string;
  label: string;
  source_label: string | null;
};

type CommunityShowAnswerRow = {
  application_id: string;
  question_id: string;
  value: unknown;
};

type UpcomingScheduleSlotRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  status: string;
};

type UpcomingScheduleBookingRow = {
  slot_id: string;
  application_id: string;
  approval_status: string;
};

type UpcomingApplicationRow = {
  id: string;
  school_name: string;
  production_title: string | null;
  source_system: string | null;
};

type UpcomingScheduleStaffRow = {
  slot_id: string;
  user_id: string;
  joined_as: AppRole;
  participation_mode: "panel" | "understudy" | "shadow";
};

const EASTERN_TIME_ZONE = "America/New_York";

function formatVisitDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatVisitTime(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}

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
    case "portal_updates":
      return { key: "portal_updates", label: "Portal Updates", order: 5 };
    case "applicant_community":
      return { key: "community", label: "Community", order: 10 };
    case "scholarship_dm":
      return {
        key: "scholarship_applicants",
        label: "Scholarship Applicants",
        order: 15,
      };
    case "general":
    case "networking":
    case "scheduling":
      return {
        key: "staff",
        label: ADJUDICATOR_CHANNELS_LABEL,
        order: 20,
      };
    case "advisory_committee":
      return { key: "committee", label: "Advisory Committee", order: 30 };
    case "school_dm":
      return { key: "direct_messages", label: "School Messaging", order: 40 };
    case "direct_message":
    case "group_direct_message":
      return { key: "direct_messages", label: "Direct Messages", order: 41 };
    case "school":
      return {
        key: "school_staff",
        label: "Panel Channels",
        order: 50,
      };
  }
}

function fallbackVisibilityLabel(channelType: ChatChannel["channel_type"]) {
  switch (channelType) {
    case "portal_updates":
      return "All portal users · Owner posts only";
    case "applicant_community":
      return "Applicants + Owners";
    case "scholarship_dm":
      return "Applicant + Program Managers + Owners";
    case "general":
    case "networking":
      return "Adjudicators + Advisory + Owners";
    case "scheduling":
      return "ACMs + Adjudicators + Owners";
    case "advisory_committee":
      return "Advisory + Owners";
    case "school_dm":
      return "School + Owners";
    case "direct_message":
      return "Direct chat participants";
    case "group_direct_message":
      return "Group chat participants";
    case "school":
      return "Assigned panel + Owners";
  }
}

function normalizeChannels(rows: RawChannel[]): ChatChannel[] {
  return rows.map((row) => {
    const archived = Boolean(row.application_archived);
    const group = fallbackChannelGroup(row.channel_type, archived);

    return presentPortalAuthoredChannel({
      channel_id: row.channel_id,
      channel_type: row.channel_type,
      channel_name: chatChannelDisplayName(
        row.channel_type,
        row.channel_name,
      ),
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
      channel_group_label: archived
        ? row.channel_group_label ?? group.label
        : chatChannelGroupLabel(
            row.channel_type,
            row.channel_group_label ?? group.label,
          ),
      channel_group_order: Number(row.channel_group_order ?? group.order),
      visibility_label:
        row.visibility_label ?? fallbackVisibilityLabel(row.channel_type),
    });
  });
}

async function loadCommunityShows(
  admin: ReturnType<typeof createAdminClient>,
): Promise<CommunityShow[]> {
  const cycleResult = await admin
    .from("award_cycles")
    .select("id")
    .eq("program_type", "directors")
    .neq("status", "archived")
    .order("is_active", { ascending: false })
    .order("season_year", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cycleResult.error) {
    throw new Error(`Show dates could not be loaded: ${cycleResult.error.message}`);
  }

  if (!cycleResult.data) return [];

  const applicationsResult = await admin
    .from("applications")
    .select("id,form_version_id,school_name,production_title")
    .eq("cycle_id", cycleResult.data.id)
    .eq("is_archived", false)
    .is("cloned_from_application_id", null)
    .neq("status", "withdrawn")
    .order("school_name");

  if (applicationsResult.error) {
    throw new Error(
      `School productions could not be loaded: ${applicationsResult.error.message}`,
    );
  }

  const applications =
    (applicationsResult.data ?? []) as CommunityShowApplicationRow[];
  if (applications.length === 0) return [];

  const formVersionIds = [
    ...new Set(
      applications
        .map((application) => application.form_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (formVersionIds.length === 0) {
    return buildCommunityShows({ applications, questions: [], answers: [] });
  }

  const questionsResult = await admin
    .from("application_questions")
    .select("id,question_key,label,source_label")
    .in("form_version_id", formVersionIds);

  if (questionsResult.error) {
    throw new Error(
      `Show date questions could not be loaded: ${questionsResult.error.message}`,
    );
  }

  const questions =
    (questionsResult.data ?? []) as CommunityShowQuestionRow[];
  const relevantQuestionIds = questions
    .filter((question) => {
      const text = `${question.question_key} ${question.label} ${question.source_label ?? ""}`
        .toLowerCase();
      return (
        text.includes("opening night") ||
        text.includes("opening_night") ||
        text.includes("closing night") ||
        text.includes("closing_night")
      );
    })
    .map((question) => question.id);

  if (relevantQuestionIds.length === 0) {
    return buildCommunityShows({ applications, questions, answers: [] });
  }

  const answersResult = await admin
    .from("application_answers")
    .select("application_id,question_id,value")
    .in(
      "application_id",
      applications.map((application) => application.id),
    )
    .in("question_id", relevantQuestionIds);

  if (answersResult.error) {
    throw new Error(
      `Show dates could not be loaded: ${answersResult.error.message}`,
    );
  }

  return buildCommunityShows({
    applications,
    questions,
    answers: (answersResult.data ?? []) as CommunityShowAnswerRow[],
  });
}

async function loadUpcomingAdjudications(
  admin: ReturnType<typeof createAdminClient>,
  currentUserId: string,
): Promise<UpcomingAdjudication[]> {
  const bookingsResult = await admin
    .from("schedule_school_bookings")
    .select("slot_id,application_id,approval_status")
    .eq("approval_status", "confirmed");

  if (bookingsResult.error) {
    throw new Error(
      `Upcoming adjudications could not be loaded: ${bookingsResult.error.message}`,
    );
  }

  const bookings =
    (bookingsResult.data ?? []) as UpcomingScheduleBookingRow[];
  if (bookings.length === 0) return [];

  const slotIds = [...new Set(bookings.map((booking) => booking.slot_id))];
  const applicationIds = [
    ...new Set(bookings.map((booking) => booking.application_id)),
  ];
  const [slotsResult, applicationsResult, staffResult] = await Promise.all([
    admin
      .from("schedule_slots")
      .select("id,starts_at,ends_at,location,status")
      .in("id", slotIds)
      .gte("ends_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("starts_at", { ascending: true }),
    admin
      .from("applications")
      .select("id,school_name,production_title,source_system")
      .in("id", applicationIds),
    admin
      .from("schedule_slot_staff")
      .select("slot_id,user_id,joined_as,participation_mode")
      .in("slot_id", slotIds),
  ]);

  const loadError =
    slotsResult.error ?? applicationsResult.error ?? staffResult.error;
  if (loadError) {
    throw new Error(`Upcoming adjudications could not be loaded: ${loadError.message}`);
  }

  return buildUpcomingAdjudications({
    applications:
      (applicationsResult.data ?? []) as UpcomingApplicationRow[],
    bookings,
    currentUserId,
    slots: (slotsResult.data ?? []) as UpcomingScheduleSlotRow[],
    staff: (staffResult.data ?? []) as UpcomingScheduleStaffRow[],
  });
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; archive?: string }>;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const admin = createAdminClient();
  const params = await searchParams;
  const communityShowsPromise = loadCommunityShows(admin);
  let ownerChannelCandidates: ChatMember[] = [];

  if (profile.role === "owner") {
    const { data: candidateProfiles, error: candidateError } = await admin
      .from("profiles")
      .select("id,email,full_name,role")
      .eq("active", true)
      .neq("id", profile.id)
      .neq("role", "applicant")
      .order("full_name");

    if (candidateError) {
      throw new Error(`Channel members could not be loaded: ${candidateError.message}`);
    }

    ownerChannelCandidates = (candidateProfiles ?? []).map((candidate) => ({
      user_id: candidate.id,
      display_name:
        candidate.full_name?.trim() || candidate.email || "Portal user",
      user_role: candidate.role,
    }));
  }

  const personalizedChannelResult = await supabase.rpc("get_my_chat_channels_v4");
  let channelRows = personalizedChannelResult.data as RawChannel[] | null;
  let channelError = personalizedChannelResult.error;

  if (channelError) {
    const richChannelResult = await supabase.rpc("get_my_chat_channels_v3");
    channelRows = richChannelResult.data as RawChannel[] | null;
    channelError = richChannelResult.error;
  }

  // This fallback keeps the chat page usable if the code deploy reaches Vercel
  // a few minutes before the newest chat migrations are run.
  if (channelError) {
    const legacyResult = await supabase.rpc("get_my_chat_channels");
    channelRows = legacyResult.data as RawChannel[] | null;
    channelError = legacyResult.error;
  }

  if (channelError) {
    throw new Error(`Chat channels could not be loaded: ${channelError.message}`);
  }

  const normalizedChannels = normalizeChannels(channelRows ?? []).filter(
    (channel) =>
      profile.role !== "applicant" ||
      ![
        "direct_message",
        "group_direct_message",
      ].includes(channel.channel_type),
  );
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
  const upcomingAdjudicationsPromise =
    selectedChannel &&
    ["general", "scheduling"].includes(selectedChannel.channel_type)
      ? loadUpcomingAdjudications(admin, profile.id)
      : Promise.resolve([]);

  let threads: ChatThread[] = [];
  let members: ChatMember[] = [];
  let adjudicationVisitDetails: AdjudicationVisitDetails | null = null;
  let eligibilityReferencePanel: ApplicationReferencePanel | null = null;
  let panelContacts: PanelContact[] = [];

  if (selectedChannel) {
    const shouldLoadVisitDetails =
      selectedChannel.channel_type === "school" &&
      Boolean(selectedChannel.application_id);
    const [threadResult, memberResult, scheduleBookingsResult] = await Promise.all([
      supabase.rpc("get_chat_channel_threads", {
        p_channel_id: selectedChannel.channel_id,
      }),
      supabase.rpc("get_chat_channel_members", {
        p_channel_id: selectedChannel.channel_id,
      }),
      shouldLoadVisitDetails
        ? supabase.rpc("get_schedule_bookings_for_staff")
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (threadResult.error) {
      throw new Error(`Chat messages could not be loaded: ${threadResult.error.message}`);
    }

    if (memberResult.error) {
      throw new Error(`Chat members could not be loaded: ${memberResult.error.message}`);
    }

    if (scheduleBookingsResult.error) {
      throw new Error(
        `Adjudication visit details could not be loaded: ${scheduleBookingsResult.error.message}`,
      );
    }

    threads = ((threadResult.data ?? []) as ChatThread[]).map(
      presentPortalAuthoredThread,
    );
    members = (memberResult.data ?? []) as ChatMember[];

    if (shouldLoadVisitDetails && selectedChannel.application_id) {
      const assignmentResult = await admin
        .from("adjudicator_assignments")
        .select("adjudicator_user_id,participant_role")
        .eq("application_id", selectedChannel.application_id)
        .is("removed_at", null);

      if (assignmentResult.error) {
        throw new Error(
          `Panel contacts could not be loaded: ${assignmentResult.error.message}`,
        );
      }

      const channelMemberIds = new Set(members.map((member) => member.user_id));
      const panelAssignments = (
        (assignmentResult.data ?? []) as PanelAssignmentReference[]
      ).filter((assignment) =>
        channelMemberIds.has(assignment.adjudicator_user_id),
      );
      const panelUserIds = [
        ...new Set(
          panelAssignments.map(
            (assignment) => assignment.adjudicator_user_id,
          ),
        ),
      ];

      if (panelUserIds.length > 0) {
        const profileResult = await admin
          .from("profiles")
          .select("id,email,full_name,phone_e164,role")
          .in("id", panelUserIds);

        if (profileResult.error) {
          throw new Error(
            `Panel contact details could not be loaded: ${profileResult.error.message}`,
          );
        }

        const assignmentByUserId = new Map(
          panelAssignments.map((assignment) => [
            assignment.adjudicator_user_id,
            assignment,
          ]),
        );
        const roleOrder = new Map<AppRole, number>([
          ["advisory_member", 0],
          ["adjudicator", 1],
          ["owner", 2],
          ["applicant", 3],
        ]);

        panelContacts = (
          (profileResult.data ?? []) as PanelProfileReference[]
        )
          .map((panelProfile) => ({
            userId: panelProfile.id,
            name:
              panelProfile.full_name?.trim() ||
              panelProfile.email ||
              "Panel member",
            role:
              assignmentByUserId.get(panelProfile.id)?.participant_role ??
              panelProfile.role,
            email: panelProfile.email,
            phone: panelProfile.phone_e164,
          }))
          .sort(
            (left, right) =>
              (roleOrder.get(left.role) ?? 99) -
                (roleOrder.get(right.role) ?? 99) ||
              left.name.localeCompare(right.name),
          );
      }
    }

    const scheduleBooking = (
      (scheduleBookingsResult.data ?? []) as ScheduleBookingReference[]
    ).find(
      (booking) => booking.application_id === selectedChannel.application_id,
    );

    if (scheduleBooking) {
      const [slotResult, detailsResult] = await Promise.all([
        supabase
          .from("schedule_slots")
          .select("title,starts_at,ends_at,location,school_instructions")
          .eq("id", scheduleBooking.slot_id)
          .maybeSingle(),
        supabase
          .from("schedule_slot_school_details")
          .select(
            "venue_name,venue_address,arrival_entrance,parking_instructions,accessibility_notes,wifi_network,wifi_password,day_of_contact_name,day_of_contact_phone",
          )
          .eq("slot_id", scheduleBooking.slot_id)
          .maybeSingle(),
      ]);

      if (slotResult.error) {
        throw new Error(
          `Adjudication schedule could not be loaded: ${slotResult.error.message}`,
        );
      }

      if (detailsResult.error) {
        throw new Error(
          `School visit details could not be loaded: ${detailsResult.error.message}`,
        );
      }

      const slot = slotResult.data as ScheduleSlotReference | null;
      const details = detailsResult.data as ScheduleSchoolDetailsReference | null;

      if (slot) {
        adjudicationVisitDetails = {
          scheduleTitle: slot.title,
          dateLabel: formatVisitDate(slot.starts_at),
          timeLabel: formatVisitTime(slot.starts_at, slot.ends_at),
          venueName: details?.venue_name ?? slot.location,
          venueAddress: details?.venue_address ?? null,
          arrivalEntrance: details?.arrival_entrance ?? null,
          parkingInstructions: details?.parking_instructions ?? null,
          accessibilityNotes: details?.accessibility_notes ?? null,
          wifiNetwork: details?.wifi_network ?? null,
          wifiPassword: details?.wifi_password ?? null,
          dayOfContactName: details?.day_of_contact_name ?? null,
          dayOfContactPhone: details?.day_of_contact_phone ?? null,
          schoolInstructions: slot.school_instructions,
        };
      }
    }

    if (shouldLoadVisitDetails && selectedChannel.application_id) {
      const applicationResult = await admin
        .from("applications")
        .select("form_data,archived_payload,source_system,form_version_id")
        .eq("id", selectedChannel.application_id)
        .maybeSingle();

      if (applicationResult.error) {
        throw new Error(
          `Application eligibility could not be loaded: ${applicationResult.error.message}`,
        );
      }

      const application = applicationResult.data as Pick<
        Application,
        "form_data" | "archived_payload" | "source_system" | "form_version_id"
      > | null;

      if (application) {
        const [questionsResult, answersResult, formVersionResult, appealsResult] =
          await Promise.all([
            application.form_version_id
              ? admin
                  .from("application_questions")
                  .select(
                    "id,form_version_id,section_id,question_key,label,description,question_type,required,options,settings,visibility_rule,sort_order,active,source_column_index,source_label,imported,created_at,updated_at",
                  )
                  .eq("form_version_id", application.form_version_id)
                  .order("sort_order")
                  .order("created_at")
              : Promise.resolve({ data: [], error: null }),
            admin
              .from("application_answers")
              .select("id,application_id,question_id,value,updated_at")
              .eq("application_id", selectedChannel.application_id),
            application.form_version_id
              ? admin
                  .from("application_form_versions")
                  .select("scoring_rubric_id")
                  .eq("id", application.form_version_id)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            admin
              .from("appeals")
              .select(
                "category_id,current_eligibility,requested_eligibility,status,submitted_at",
              )
              .eq("application_id", selectedChannel.application_id)
              .eq("appeal_type", "eligibility")
              .order("submitted_at", { ascending: false }),
          ]);

        const eligibilityLoadError =
          questionsResult.error ??
          answersResult.error ??
          formVersionResult.error ??
          appealsResult.error;

        if (eligibilityLoadError) {
          throw new Error(
            `Application eligibility could not be loaded: ${eligibilityLoadError.message}`,
          );
        }

        const rubricId = formVersionResult.data?.scoring_rubric_id ?? null;
        const categoriesResult = rubricId
          ? await admin
              .from("scoring_categories")
              .select("id,category_key,title")
              .eq("rubric_id", rubricId)
              .eq("active", true)
              .order("sort_order")
          : { data: [], error: null };

        if (categoriesResult.error) {
          throw new Error(
            `Eligibility categories could not be loaded: ${categoriesResult.error.message}`,
          );
        }

        eligibilityReferencePanel =
          buildApplicationReferencePanels({
            application,
            questions: (questionsResult.data ?? []) as ApplicationQuestion[],
            answers: (answersResult.data ?? []) as ApplicationAnswer[],
            eligibilityCategories: categoriesResult.data ?? [],
            eligibilityAppeals: (appealsResult.data ?? []) as ApplicationEligibilityAppeal[],
          }).find((panel) => panel.key === "eligibility") ?? null;
      }
    }

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
    <div className="chat-fullscreen-page">
      <TeamsChat
        adjudicationVisitDetails={adjudicationVisitDetails}
        communityShows={await communityShowsPromise}
        eligibilityReferencePanel={eligibilityReferencePanel}
        key={selectedChannel?.channel_id ?? "no-channel"}
        initialChannels={channels}
        initialMembers={members}
        initialThreads={threads}
        ownerChannelCandidates={ownerChannelCandidates}
        panelContacts={panelContacts}
        profile={profile}
        selectedChannelId={selectedChannel?.channel_id ?? null}
        upcomingAdjudications={await upcomingAdjudicationsPromise}
      />
    </div>
  );
}
