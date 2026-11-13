export function dashboardOrigin() {
  const value = process.env.FACTORY_DASHBOARD_URL;
  if (!value) throw new Error("FACTORY_DASHBOARD_URL is required.");
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Dashboard requires HTTPS or loopback HTTP.");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("FACTORY_DASHBOARD_URL must be an origin.");
  return url;
}

export function sameOrigin(request: Request) {
  const origin = dashboardOrigin();
  return request.headers.get("origin") === origin.origin;
}
