"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";

export function CredentialsForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
      if (!response.ok) { setError((await response.json()).error ?? "Sign-in failed"); return; }
      router.replace("/");
      router.refresh();
    } catch { setError("Sign-in unavailable. Try again."); }
    finally { setPending(false); }
  }
  return <Card className="w-full max-w-sm">
    <CardHeader><CardTitle>Sign in</CardTitle><CardDescription>Use an owner account provisioned by your operator.</CardDescription></CardHeader>
    <CardContent><form onSubmit={submit} className="space-y-4">
      <label className="block space-y-2">Email<Input name="email" type="email" autoComplete="username" required maxLength={320} /></label>
      <label className="block space-y-2">Password<Input name="password" type="password" autoComplete="current-password" required maxLength={1024} /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Signing in" : "Sign in"}</Button>
    </form></CardContent>
  </Card>;
}
