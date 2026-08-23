import { queryDashboardState } from "../core/query/dashboard.ts";
import { buildDashboardData } from "./dashboard-data.ts";

export async function getDashboardData(eventLimit = 50) {
  return buildDashboardData(await queryDashboardState(), new Date(), eventLimit);
}
