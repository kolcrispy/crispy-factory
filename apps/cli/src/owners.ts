import { stdin, stderr } from "node:process";
import { manageOwner } from "@factory/core/auth/accounts";

async function password(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error("Owner passwords require an interactive terminal; never pass passwords in argv.");
  stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let value = "";
  const cleanup = () => { stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); stderr.write("\n"); };
  const onData = (data: Buffer) => {
    for (const ch of data.toString("utf8")) {
      if (ch === "\u0003") { cleanup(); reject(new Error("Cancelled.")); return; }
      if (ch === "\r" || ch === "\n") { cleanup(); resolve(value); return; }
      if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
      else if (ch >= " ") value += ch;
    }
  };
  stdin.on("data", onData);
  return promise;
}

export async function ownerCommand(action: string, email: unknown) {
  if (!["create", "reset", "disable"].includes(action) || typeof email !== "string") throw new Error("Use owners create|reset|disable with an email input.");
  let secret: string | undefined;
  if (action !== "disable") {
    secret = await password("Password (hidden): ");
    if (secret !== await password("Confirm password (hidden): ")) throw new Error("Passwords do not match.");
  }
  return manageOwner(action as "create" | "reset" | "disable", email, secret);
}
