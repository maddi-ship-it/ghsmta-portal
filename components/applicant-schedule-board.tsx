"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  acceptScheduleSlotWaitlistOffer,
  bookOwnScheduleSlot,
  declineScheduleSlotWaitlistOffer,
  joinScheduleSlotWaitlist,
  leaveScheduleSlotWaitlist,
} from "@/app/portal/schedule/actions";
import { ScheduleSubmitButton } from "@/components/schedule-submit-button";
import { createClient } from "@/lib/supabase/client";

type ApplicationOption = { id: string; label: string };
export type ApplicantWaitlistEntry = {
  id: string;
  slot_id: string;
  application_id: string;
  status: "waiting" | "offered" | "accepted" | "declined" | "removed" | "expired";
  queue_rank: number;
  offer_expires_at: string | null;
  applicant_notes: string | null;
  alternate_date_1?: string | null;
  alternate_date_2?: string | null;
  alternate_date_3?: string | null;
  applicant_reason?: string | null;
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
  myWaitlist: ApplicantWaitlistEntry | null;
};

type SlotAvailability = { slot_id: string; is_booked: boolean; is_mine: boolean; my_application_id: string | null };
type LiveStatus = "connecting" | "live" | "refreshing" | "degraded";
const FALLBACK_REFRESH_MS = 15_000;

export function ApplicantScheduleBoard({ slots, initialAvailability, view }: { slots: ApplicantScheduleSlot[]; initialAvailability: SlotAvailability[]; view: "list" | "cards" }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [availability, setAvailability] = useState(initialAvailability);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const availabilityMap = useMemo(() => new Map(availability.map((item) => [item.slot_id, item])), [availability]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      setLiveStatus((current) => current === "degraded" ? current : "refreshing");
      const { data, error } = await supabase.rpc("get_schedule_slot_availability");
      if (!active) return;
      if (error) { setLiveStatus("degraded"); return; }
      setAvailability((data ?? []) as SlotAvailability[]);
      setLastUpdatedAt(new Date());
      setLiveStatus("live");
      router.refresh();
    };
    refreshRef.current = refresh;
    const queue = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void refresh(), 250); };
    const channel = supabase.channel(`schedule-live-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_slots" }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_school_bookings" }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_slot_waitlist" }, queue)
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") { setLiveStatus("live"); void refresh(); }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setLiveStatus("degraded");
      });
    const fallback = window.setInterval(() => void refresh(), FALLBACK_REFRESH_MS);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => { active = false; if (timer) clearTimeout(timer); clearInterval(fallback); window.removeEventListener("focus", focus); void supabase.removeChannel(channel); };
  }, [router, supabase]);

  return (
    <section className="applicant-schedule-live-board">
      <div className="schedule-live-strip" aria-live="polite"><span className={`schedule-live-dot schedule-live-dot-${liveStatus}`} /><strong>{liveStatus === "live" ? "Live availability" : liveStatus === "refreshing" ? "Updating…" : liveStatus === "degraded" ? "Connection interrupted" : "Connecting…"}</strong><span>{lastUpdatedAt ? `Checked ${lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "All schools see changes in real time."}</span><button className="text-button" type="button" onClick={() => void refreshRef.current()}>Refresh now</button></div>

      <div className={`schedule-slot-grid schedule-slot-grid-${view}`}>
        {slots.map((slot) => {
          const live = availabilityMap.get(slot.id);
          const isBooked = Boolean(live?.is_booked);
          const canBook = slot.canSchoolBook && !isBooked && !slot.isPast;
          const waitlist = slot.myWaitlist;
          const offered = waitlist?.status === "offered" && Boolean(waitlist.offer_expires_at);
          return (
            <article className={`panel schedule-slot-card schedule-slot-card-${view}`} key={slot.id}>
              <details className="schedule-slot-details" open={view === "cards"}>
                <summary className="schedule-list-summary schedule-applicant-list-summary">
                  <span className="schedule-list-date"><strong>{slot.dateLabel}</strong><small>{slot.timeLabel} ET</small></span>
                  <span className="schedule-list-school"><strong>{isBooked ? "Booked" : "Open slot"}</strong><small>{slot.title}</small></span>
                  <span className="schedule-list-location"><strong>{slot.locationLabel}</strong><small>{slot.cycleLabel}</small></span>
                  <span className="schedule-list-metric"><strong>{slot.waitlistCount}</strong><small>waiting</small></span>
                  <span className={`badge ${isBooked ? "schedule-availability-taken" : "schedule-availability-open"}`}>{isBooked ? "Taken" : "Open"}</span>
                  <span className="schedule-list-expand">Details</span>
                </summary>

                <div className="schedule-slot-expanded applicant-schedule-slot-expanded">
                  <div className="schedule-applicant-slot-copy"><p className="eyebrow">{slot.cycleLabel}</p><h2>{slot.title}</h2><p><strong>{slot.dateLabel}</strong><br />{slot.timeLabel} ET · {slot.locationLabel}</p></div>
                  <div className="schedule-school-action schedule-applicant-booking-action">
                    {offered ? (
                      <div className="waitlist-offer-card"><span className="badge badge-warning">Exclusive offer</span><h3>This slot is held for your school.</h3><p>Accept before {new Date(waitlist.offer_expires_at!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p><div className="button-row"><form action={acceptScheduleSlotWaitlistOffer.bind(null, waitlist.id)}><button className="button button-gold" type="submit">Accept slot</button></form><form action={declineScheduleSlotWaitlistOffer.bind(null, waitlist.id)}><button className="button button-secondary" type="submit">Decline</button></form></div></div>
                    ) : waitlist?.status === "waiting" ? (
                      <div className="waitlist-status-card"><span className="badge">Waitlist position {waitlist.queue_rank}</span><h3>Your school is waiting for this exact timeslot.</h3><form action={leaveScheduleSlotWaitlist.bind(null, waitlist.id)}><button className="text-button danger-text" type="submit">Leave timeslot waitlist</button></form></div>
                    ) : isBooked ? (
                      <form action={joinScheduleSlotWaitlist.bind(null, slot.id)} className="form-stack waitlist-join-form">
                        <h3>Join this timeslot waitlist</h3><p>If this reservation opens, schools are offered the slot in queue order for 15 minutes.</p>
                        {slot.applications.length === 1 ? <input name="application_id" type="hidden" value={slot.applications[0].id} /> : <div className="field"><label htmlFor={`waitlist_application_${slot.id}`}>Application</label><select className="select" id={`waitlist_application_${slot.id}`} name="application_id" required><option value="">Choose application</option>{slot.applications.map((application) => <option key={application.id} value={application.id}>{application.label}</option>)}</select></div>}
                        <div className="waitlist-alternate-date-grid">
                          <div className="field"><label htmlFor={`waitlist_alt1_${slot.id}`}>Alternate date 1 <span>Optional</span></label><input className="input" id={`waitlist_alt1_${slot.id}`} name="alternate_date_1" type="date" /></div>
                          <div className="field"><label htmlFor={`waitlist_alt2_${slot.id}`}>Alternate date 2 <span>Optional</span></label><input className="input" id={`waitlist_alt2_${slot.id}`} name="alternate_date_2" type="date" /></div>
                          <div className="field"><label htmlFor={`waitlist_alt3_${slot.id}`}>Alternate date 3 <span>Optional</span></label><input className="input" id={`waitlist_alt3_${slot.id}`} name="alternate_date_3" type="date" /></div>
                        </div>
                        <div className="field"><label htmlFor={`waitlist_reason_${slot.id}`}>Reason or scheduling context <span>Optional</span></label><textarea className="textarea compact-textarea" id={`waitlist_reason_${slot.id}`} name="reason" placeholder="Travel, performance schedule, or other timing context" /></div>
                        <div className="field"><label htmlFor={`waitlist_notes_${slot.id}`}>Additional notes <span>Optional</span></label><input className="input" id={`waitlist_notes_${slot.id}`} name="notes" placeholder="Anything else the scheduling team should know" /></div>
                        <button className="button button-secondary" type="submit">Join waitlist for this slot</button>
                      </form>
                    ) : canBook ? (
                      <form action={bookOwnScheduleSlot} className="form-stack"><input name="slot_id" type="hidden" value={slot.id} />{slot.applications.length === 1 ? <input name="application_id" type="hidden" value={slot.applications[0].id} /> : <div className="field"><label htmlFor={`application_${slot.id}`}>Application</label><select className="select" id={`application_${slot.id}`} name="application_id" required><option value="">Choose application</option>{slot.applications.map((application) => <option key={application.id} value={application.id}>{application.label}</option>)}</select></div>}<ScheduleSubmitButton pendingLabel="Claiming slot…">Register school for this slot</ScheduleSubmitButton></form>
                    ) : <button className="button button-secondary" disabled type="button">{slot.isPast ? "Slot has passed" : "Unavailable"}</button>}
                    <small>Reservations and waitlist offers are enforced by the database, even when many schools click at the same moment.</small>
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
