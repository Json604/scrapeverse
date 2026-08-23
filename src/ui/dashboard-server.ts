import { queryDashboardState } from "../core/query/dashboard.ts";
import { buildDashboardData } from "./dashboard-data.ts";

export async function getDashboardData() {
  return buildDashboardData(await queryDashboardState());
}
