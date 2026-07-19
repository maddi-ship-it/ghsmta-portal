"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { bookOwnScheduleSlot } from "@/app/portal/schedule/actions";
import { ScheduleSubmitButton } from "@/components/schedule-submit-button";

type ApplicationOption = {
  id: string;
  label: string;
};

type ApplicantScheduleSlot = {
  id: string;
  title: string;
  dateLabel: string;
  timeLabel: string;
  locationLabel: string;
  cycleLabel: string;
  waitlistCount: number;
  applications: ApplicationOption[];
  isPast: boolean;
  canSchoolBook: boolean;
};

type SlotAvailability = {
  slot_id: string;
  is_booked: boolean;
  is_mine: boolean;
  my_application_id: string | null;
};

type ApplicantScheduleBoardProps = {
  slots: ApplicantScheduleSlot[];
  initialAvailability: SlotAvailability[];
  view: "list" | "cards";
};

type LiveStatus = "connecting" | "live" | "refreshing" | "degraded";

const FALLBACK_REFRESH_MS = 15_000;
const EVENT_DEBOUNCE_MS = 300;

export function ApplicantScheduleBoard({
  slots,
  initialAvailability,
  view,
}: ApplicantScheduleBoardProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [availability, setAvailability] = useState(initialAvailability);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const availabilityRef = useRef(initialAvailability);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const availabilityMap = useMemo(
    () => new Map(availability.map((item) => [item.slot_id, item])),
    [availability],
  );

  useEffect(() => {
    let active = true;
    let refreshInFlight = false;
    let refreshQueued = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshAvailability = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      setLiveStatus((current) => (current === "degraded" ? current : "refreshing"));

      try {
        const { data, error } = await supabase.rpc("get_schedule_slot_availability");
        if (error) throw error;
        if (!active) return;

        const nextAvailability = (data ?? []) as SlotAvailability[];
        const nowMine = nextAvailability.some((item) => item.is_mine);
        const previouslyMine = availabilityRef.current.some((item) => item.is_mine);

        availabilityRef.current = nextAvailability;
        setAvailability(nextAvailability);
        setLastUpdatedAt(new Date());
        setLiveStatus("live");

        // A booking completed in another tab or by another school-team user.
        if (nowMine && !previouslyMine) router.refresh();
      } catch (error) {
        console.error("Could not refresh live schedule availability", error);
        if (active) setLiveStatus("degraded");
      } finally {
        refreshInFlight = false;
        if (refreshQueued && active) {
          refreshQueued = false;
          void refreshAvailability();
        }
      }
    };

    refreshRef.current = refreshAvailability;

    const queueRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void refreshAvailability();
      }, EVENT_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`schedule-availability-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "schedule_slots",
        },
        queueRefresh,
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setLiveStatus("live");
          void refreshAvailability();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setLiveStatus("degraded");
        }
      });

    const fallbackTimer = window.setInterval(() => {
      void refreshAvailability();
    }, FALLBACK_REFRESH_MS);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshAvailability();
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      window.clearInterval(fallbackTimer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [router, supabase]);

  return (
    <section className="applicant-schedule-live-board">
      <div className="schedule-live-strip" aria-live="polite">
        <span className={`schedule-live-dot schedule-live-dot-${liveStatus}`} />
        <strong>
          {liveStatus === "live"
            ? "Live availability"
            : liveStatus === "refreshing"
              ? "Updating availability…"
              : liveStatus === "degraded"
                ? "Live connection interrupted"
                : "Connecting to live availability…"}
        </strong>
        <span>
          {liveStatus === "degraded"
            ? "The list will continue checking automatically."
            : lastUpdatedAt
              ? `Last checked ${lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
              : "Changes appear automatically."}
        </span>
        <button
          className="text-button schedule-live-refresh-button"
          onClick={() => void refreshRef.current()}
          type="button"
        >
          Refresh now
        </button>
      </div>

      <div className={`schedule-slot-grid schedule-slot-grid-${view}`}>
        {slots.map((slot) => {
          const slotAvailability = availabilityMap.get(slot.id);
          const isBooked = Boolean(slotAvailability?.is_booked);
          const canBook = slot.canSchoolBook && !isBooked && !slot.isPast;

          return (
            <article
              className={`panel schedule-slot-card schedule-slot-card-${view}`}
              key={slot.id}
            >
              <details className="schedule-slot-details" open={view === "cards"}>
                <summary className="schedule-list-summary schedule-applicant-list-summary">
                  <span className="schedule-list-date">
                    <strong>{slot.dateLabel}</strong>
                    <small>{slot.timeLabel} ET</small>
                  </span>
                  <span className="schedule-list-school">
                    <strong>{isBooked ? "Unavailable" : "Available"}</strong>
                    <small>{slot.title}</small>
                  </span>
                  <span className="schedule-list-location">
                    <strong>{slot.locationLabel}</strong>
                    <small>{slot.cycleLabel}</small>
                  </span>
                  <span className="schedule-list-metric">
                    <strong>{slot.waitlistCount}</strong>
                    <small>waitlist</small>
                  </span>
                  <span
                    className={`badge ${isBooked ? "schedule-availability-taken" : "schedule-availability-open"}`}
                  >
                    {isBooked ? "Taken" : "Open"}
                  </span>
                  <span className="schedule-list-expand">Details</span>
                </summary>

                <div className="schedule-slot-expanded applicant-schedule-slot-expanded">
                  <div className="schedule-applicant-slot-copy">
                    <span className="eyebrow">{slot.cycleLabel}</span>
                    <h2>{slot.title}</h2>
                    <p>
                      <strong>{slot.dateLabel}</strong><br />
                      {slot.timeLabel} ET · {slot.locationLabel}
                    </p>
                  </div>

                  <div className="schedule-school-action schedule-applicant-booking-action">
                    {isBooked ? (
                      <>
                        <button className="button button-secondary" disabled type="button">
                          This slot was selected by another school
                        </button>
                        <small>The live schedule has already been updated.</small>
                      </>
                    ) : canBook ? (
                      <form action={bookOwnScheduleSlot} className="form-stack">
                        <input name="slot_id" type="hidden" value={slot.id} />
                        {slot.applications.length === 1 ? (
                          <input
                            name="application_id"
                            type="hidden"
                            value={slot.applications[0].id}
                          />
                        ) : (
                          <div className="field">
                            <label htmlFor={`application_${slot.id}`}>Application</label>
                            <select
                              className="select"
                              id={`application_${slot.id}`}
                              name="application_id"
                              required
                            >
                              <option value="">Choose your application</option>
                              {slot.applications.map((application) => (
                                <option key={application.id} value={application.id}>
                                  {application.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <ScheduleSubmitButton pendingLabel="Claiming slot…">
                          Register school for this slot
                        </ScheduleSubmitButton>
                      </form>
                    ) : (
                      <button className="button button-secondary" disabled type="button">
                        {slot.isPast ? "Slot has passed" : "Not available for your application"}
                      </button>
                    )}
                    <small>
                      Reservations are committed atomically. If two schools select the same
                      slot, only the first completed database transaction succeeds.
                    </small>
                  </div>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
