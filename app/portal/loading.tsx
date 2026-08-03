export default function PortalLoading() {
  return (
    <div aria-live="polite" className="portal-loading-state" role="status">
      <span className="portal-loading-mark" aria-hidden="true">G</span>
      <strong>Preparing your workspace…</strong>
    </div>
  );
}
