import { getDashboardData } from "../../../src/ui/dashboard-server.ts";
import { fail, ok } from "../_lib.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await getDashboardData(), 15);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "dashboard data unavailable");
  }
}
