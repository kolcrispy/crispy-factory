import "./test-guard";
import assert from "node:assert/strict";
import { sameOrigin, dashboardOrigin } from "../apps/dashboard/lib/auth/request";

process.env.FACTORY_DASHBOARD_URL = "http://localhost:3000";
assert.equal(sameOrigin(new Request("http://localhost:3000/api/auth/login", { headers: { origin: "https://evil.invalid" } })), false);
assert.equal(sameOrigin(new Request("http://localhost:3000/api/auth/login", { headers: { origin: "http://localhost:3000" } })), true);
process.env.FACTORY_DASHBOARD_URL = "http://dashboard.example.com";
assert.throws(dashboardOrigin, /HTTPS/);
process.env.FACTORY_DASHBOARD_URL = "https://dashboard.example.com";
assert.equal(dashboardOrigin().protocol, "https:");
console.log("Dashboard transport and origin regressions passed");
