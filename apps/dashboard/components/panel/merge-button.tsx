"use client";

import { GitMergeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { approveFromRunDetail } from "../../app/actions/inbox";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import type { MergeTarget } from "@factory/core/inbox-actions";
import type { JobId } from "@factory/core/sources/shapes";
import { useInboxAction } from "./inbox-actions";
import { toastManager } from "../ui/toast";

type Loaded = { kind: "loading" } | { kind: "ready"; target: MergeTarget } | { kind: "none" };

/**
 * Approves the job's PR for the runner to merge, at the head the owner saw when run detail opened:
 * the inbox's approval, so the merge goes through the runner's merge service. Confirmation
 * closes immediately; the trigger shows pending work and notifications report the result.
 */
export function MergeButton({ jobId, jobKey }: { jobId: JobId; jobKey: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useInboxAction();

  useEffect(() => {
    if (error) toastManager.add({ type: "error", title: error });
  }, [error]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/jobs/${encodeURIComponent(jobKey)}/merge-target`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ target: MergeTarget | null }>) : { target: null }))
      .then(({ target }) => setLoaded(target ? { kind: "ready", target } : { kind: "none" }))
      .catch(() => controller.signal.aborted || setLoaded({ kind: "none" }));
    return () => controller.abort();
  }, [jobKey]);

  if (loaded.kind === "none") return null;
  const target = loaded.kind === "ready" ? loaded.target : null;
  const merging = busy !== null;
  const confirm = () => {
    if (!target) return;
    setOpen(false);
    void run("approve", () => approveFromRunDetail(jobId, crypto.randomUUID(), target.headSha), "Merged.");
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => merging || setOpen(next)}>
      <AlertDialogTrigger disabled={!target || merging} render={<Button size="sm" loading={merging} />}>
        {target ? <GitMergeIcon data-icon="inline-start" /> : <Spinner data-icon="inline-start" />}
        Merge
      </AlertDialogTrigger>
      {target && (
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge this pull request?</AlertDialogTitle>
            <AlertDialogDescription render={<div />} className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground">{target.title}</span>
              <span>
                The factory merges <span className="font-mono">{target.headSha.slice(0, 7)}</span> into <span className="font-mono">{target.repo}</span> the way
                it merges on its own, then watches main. A newer push, a red or running check, a conflict, or GitHub refusing the merge still stops it.
              </span>
              {target.mergeable === "conflicting" && <span className="text-warning">GitHub reports a conflict with the base branch.</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={merging} render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button onClick={confirm} loading={merging}>
              Merge
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      )}
    </AlertDialog>
  );
}
