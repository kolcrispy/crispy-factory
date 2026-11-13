"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addRepository, retryRegistration } from "../../app/actions/repositories";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Input } from "../ui/input";
import type { RepoSettingsRow } from "@factory/storage/schema";

export function useOnboardingRefresh(registry: readonly RepoSettingsRow[]) {
  const router = useRouter();
  const pending = registry.some(row => row.registration_status === "pending");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [pending, router]);
}

export function OnboardingBadge({ state }: { state: RepoSettingsRow["registration_status"] }) {
  return <Badge variant={state === "ready" ? "success" : state === "failed" ? "error" : "info"} size="sm">{state}</Badge>;
}

export const onboardingLine = (row: RepoSettingsRow) => row.registration_error ?? (row.registration_status === "ready" ? "Local checkout ready" : "Waiting for runner validation");

export function AddRepository() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const [requestId, setRequestId] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <Dialog open={open} onOpenChange={next => {
    if (pending) return;
    setOpen(next);
    if (next) { setRequestId(crypto.randomUUID()); setRepo(""); setFailure(null); }
  }}>
    <DialogTrigger render={<Button size="sm" />}><PlusIcon data-icon="inline-start" />Add repository</DialogTrigger>
    <DialogPopup className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Add repository</DialogTitle><DialogDescription>Enter owner/repo or a GitHub URL. The runner checks access using its gh login and prepares a local checkout. No GitHub App or public gateway is required.</DialogDescription></DialogHeader>
      <DialogPanel className="flex flex-col gap-3">
        <Input value={repo} onChange={event => setRepo(event.target.value)} placeholder="owner/repo or https://github.com/owner/repo" aria-label="GitHub repository" autoFocus disabled={pending} />
        {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
      </DialogPanel>
      <DialogFooter><Button disabled={pending || !repo.trim()} onClick={() => startTransition(async () => {
        try {
          const outcome = await addRepository({ repo, requestId });
          if (!outcome.ok) { setFailure(outcome.message); return; }
          setOpen(false);
          router.push(`/repositories?${new URLSearchParams({ repo: outcome.repo })}`, { scroll: false });
          router.refresh();
          window.dispatchEvent(new Event("factory:refresh"));
        } catch { setFailure("Could not submit registration. Retry with the same request."); }
      })}>{pending ? "Submitting..." : "Register repository"}</Button></DialogFooter>
    </DialogPopup>
  </Dialog>;
}

export function OnboardingSection({ row }: { row: RepoSettingsRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  return <section className="space-y-3">
    <h3 className="text-sm font-medium">Local registration</h3>
    <OnboardingBadge state={row.registration_status} />
    <p className="text-sm text-muted-foreground">{onboardingLine(row)}</p>
    {row.checkout_path && <p className="break-all font-mono text-xs">{row.checkout_path}</p>}
    {row.registration_status === "failed" && <Button disabled={pending} size="sm" onClick={() => startTransition(async () => {
      const outcome = await retryRegistration({ repo: row.repo });
      if (!outcome.ok) setFailure(outcome.message);
      else { router.refresh(); window.dispatchEvent(new Event("factory:refresh")); }
    })}>Retry registration</Button>}
    {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
  </section>;
}
