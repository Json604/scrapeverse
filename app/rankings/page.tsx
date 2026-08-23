import { ArrowUpRight } from "lucide-react";
import { ExplorerHeader } from "../explorer-header.tsx";
import { ContextTip } from "../context-tip.tsx";
import { emptyDashboardData } from "../../src/ui/dashboard-data.ts";
import { getDashboardData } from "../../src/ui/dashboard-server.ts";

export const dynamic = "force-dynamic";

export default async function RankingsPage() {
  const data = await getDashboardData().catch(() => emptyDashboardData());

  return (
    <main className="explorer-shell">
      <ExplorerHeader label="Rankings" />
      <section className="explorer-intro">
        <h1>The latest trusted lists.</h1>
        <p>Every ranked entity from the most recent <ContextTip label="healthy snapshot" definition="Latest source capture that passed validation." /> of each watched source.</p>
      </section>
      <div className="ranking-grid">
        {data.rankings.map((ranking) => (
          <section className="ranking-panel" key={ranking.sourceId}>
            <header><h2>{ranking.source}</h2><span>{ranking.items.length} rows</span></header>
            <div className="ranking-list">
              {ranking.items.map((item) => (
                <a href={item.url} target="_blank" rel="noopener noreferrer" key={`${ranking.sourceId}-${item.rank}-${item.title}`} aria-label={`Open ${item.title} at its source`}>
                  <span>#{item.rank}</span>
                  <div><strong>{item.title}</strong><small>{item.detail}</small></div>
                  <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
                </a>
              ))}
            </div>
          </section>
        ))}
        {data.rankings.length === 0 ? <div className="explorer-panel explorer-empty">No trusted rankings are available yet.</div> : null}
      </div>
    </main>
  );
}
