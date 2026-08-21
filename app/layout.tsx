import type { ReactNode } from "react";

export const metadata = {
  title: "Driftwatch",
  description: "Version control for the web — structured leaderboard history with break-vs-change classification",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        {children}
      </body>
    </html>
  );
}
