/** Placeholder. The UI is Phase B — the engine and its read API are Phase A. */
export default function Home() {
  const endpoints = [
    ["/api/sources", "registered sources and their expectations"],
    ["/api/health", "per-source extraction health"],
    ["/api/events?source=&type=&since=&limit=", "change events + counts"],
    ["/api/timeline?source=&channel=", "snapshot history"],
    ["/api/entity?id=", "per-entity field blame"],
  ];
  return (
    <main style={{ padding: "3rem 2rem", maxWidth: 760, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.4rem", margin: 0 }}>Driftwatch</h1>
      <p style={{ opacity: 0.7 }}>
        Version control for the web. Structured leaderboard history with break-vs-change
        classification. The UI is Phase B; this deployment serves the read API.
      </p>
      <ul style={{ paddingLeft: "1.1rem" }}>
        {endpoints.map(([path, desc]) => (
          <li key={path}>
            <code>{path}</code> — <span style={{ opacity: 0.7 }}>{desc}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
