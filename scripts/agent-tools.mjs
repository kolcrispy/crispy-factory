// Import from eval with an absolute checkout path. Never log credential-bearing results.
export async function checkedTool(call) {
  const result = await call;
  if (result?.hasError || result?.isError || result?.details?.isError || result?.details?.errorKind) {
    throw new Error("Tool failed; inspect its result before continuing.");
  }
  return result;
}

export async function verifyRunnerCredential(path) {
  const { url, token } = JSON.parse(await Bun.file(path).text());
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(url) || typeof token !== "string") throw new Error("Invalid saved runner credential");
  const response = await fetch(`${url.replace(/\/$/, "")}/api/jobs`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Saved runner credential rejected (${response.status})`);
  const snapshot = await response.json();
  if (snapshot.version !== 1 || !Array.isArray(snapshot.jobs)) throw new Error("Invalid runner snapshot");
  return { authenticated: true, jobs: snapshot.jobs.length };
}
