export function ScheduleDistanceLink({ href }: { href: string | null }) {
  if (!href) return null;

  return (
    <a
      className="schedule-distance-link"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      Distance from current location ↗
    </a>
  );
}
