import dashboardFixture from "../../contracts/fixtures/dashboard.synthetic.json";
import type { components } from "../contracts/life-console";

export type Dashboard = components["schemas"]["Dashboard"];

export const syntheticDashboard = dashboardFixture as unknown as Dashboard;
