import { PulseDashboard } from "./pulse-dashboard.tsx";
import { emptyDashboardData } from "../src/ui/dashboard-data.ts";
import { getDashboardData } from "../src/ui/dashboard-server.ts";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    return <PulseDashboard initialData={await getDashboardData()} />;
  } catch {
    return <PulseDashboard initialData={emptyDashboardData()} initialError="Live data is temporarily unavailable." />;
  }
}
