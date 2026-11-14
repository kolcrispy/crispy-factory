const child = Bun.spawn([process.execPath, "scripts/test-postgres.ts", "dashboard-smoke"], {
  env: { ...process.env, FACTORY_DASHBOARD_SMOKE: "1" }, stdout: "inherit", stderr: "inherit",
});
process.exit(await child.exited);
export {};
