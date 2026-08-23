import { ArrowRight, ArrowUpRight } from "lucide-react";
import { ExplorerHeader } from "../explorer-header.tsx";
import { ContextTip, EVENT_TERM_HELP } from "../context-tip.tsx";
import { emptyDashboardData } from "../../src/ui/dashboard-data.ts";
import { getDashboardData } from "../../src/ui/dashboard-server.ts";

export const dynamic = "force-dynamic";

export default async function ChangelogPage() {
  const data = await getDashboardData(300).catch(() => emptyDashboardData());

  return (
    <main className="explorer-shell">
      <ExplorerHeader label="Changelog" />
      <section className="explorer-intro">
        <h1>Every meaningful change.</h1>
        <p>Entity-level movement from the latest <ContextTip label="trusted checks" definition="Fetches that returned usable rows and passed validation." />. Page noise stays out.</p>
      </section>
      <section className="explorer-panel explorer-changelog" aria-label="Full changelog">
        <div className="explorer-table-head" aria-hidden="true"><span>Observed</span><span>Entity</span><span>Change</span><span>Source</span><span /></div>
        {data.events.map((event) => (
          <a className="explorer-event" href={event.url} target="_blank" rel="noopener noreferrer" key={event.id} aria-label={`Open ${event.entity} at its source`}>
            <div><span className={`event-token event-token--${event.kind}`}><ContextTip label={event.kind === "changed" ? "Attribute" : event.kind} definition={EVENT_TERM_HELP[event.kind]} /></span><time>{event.observed}</time></div>
            <div><strong>{event.entity}</strong><small>{event.detail} / {event.context}</small></div>
            <div className="explorer-event__change">{event.previous ? <span>{event.previous}</span> : <span>new</span>}<ArrowRight size={14} aria-hidden="true" /><strong>{event.current}</strong></div>
            <div><strong>{event.source}</strong><small>{event.cadence === "6h" ? "6 hour watch" : "monthly index"}</small></div>
            <ArrowUpRight size={17} strokeWidth={2} aria-hidden="true" />
          </a>
        ))}
        {data.events.length === 0 ? <div className="explorer-empty">No trusted changes are available yet.</div> : null}
      </section>
    </main>
  );
}
