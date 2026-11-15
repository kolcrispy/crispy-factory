"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSettings } from "../../app/actions/settings";
import { Button } from "../ui/button";
import { Card, CardContent, CardFooter } from "../ui/card";
import { Field, FieldLabel } from "../ui/field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import type { MachineRow, SettingsRow } from "@factory/storage/schema";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, harnessLabel, trackingOf, type Harness } from "@factory/core/harness";
import { reportedHarnesses } from "@factory/core/machine";
import { useFeed, type Feed } from "./sealed";
import { PanelFooter, PanelHeader } from "./panel-header";
import { SettingsSection } from "./settings-section";
import { useAfterHydration, useNow } from "./time";
import { ReviewSettings } from "./review-settings";
import type { ReviewOverrides } from "@factory/core/review";

const CLOCK_TICK_MS = 30_000;

function When({ date }: { date: Date }) {
  const text = useAfterHydration(() => date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }), "");
  return <time dateTime={date.toISOString()}>{text}</time>;
}

const describe = (harnesses: readonly Harness[], provider: string, model: string) => {
  const harness = harnesses.find((h) => h.id === provider);
  return {
    harness: harness?.name ?? harnessLabel(provider),
    model: harness?.models.find((m) => m.slug === model)?.name ?? model,
    tracking: trackingOf(harness?.driver ?? provider),
  };
};



function Current({ saved, harnesses }: { saved: SettingsRow | null; harnesses: readonly Harness[] }) {
  const provider = saved?.provider ?? DEFAULT_PROVIDER;
  const model = saved?.model || harnesses.find(h => h.id === provider)?.defaultModel || "Runtime default";
  const current = describe(harnesses, provider, model);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div>
        New threads start on <span className="font-medium">{current.harness}</span> with{" "}
        <span className="font-medium">{current.model}</span>, locally on the runner
        <span className="font-mono text-xs text-muted-foreground">
          {" "}
          ({provider} · {model})
        </span>
      </div>
      <div className="text-muted-foreground">
        {saved ? (
          <>
            From saved settings, by {saved.updated_by} on <When date={saved.updated_at} />.
          </>
        ) : (
          <>
            From the runner config default. A runner whose config.json sets <span className="font-mono text-xs">factory.provider</span>{" "}
            and <span className="font-mono text-xs">factory.model</span> uses those until you save settings here.
          </>
        )}
      </div>
    </div>
  );
}

export function SettingsForm({ machines, saved }: { machines: Feed<MachineRow>; saved: SettingsRow | null }) {
  const router = useRouter();
  const { rows, status } = useFeed(machines, "/api/live/machines");
  const now = useNow(CLOCK_TICK_MS);
  const reported = reportedHarnesses(rows, now ?? 0);
  const harnesses = reported?.filter((h) => h.enabled) ?? [];

  const provider = DEFAULT_PROVIDER;
  const [model, setModel] = useState(saved?.model ?? DEFAULT_MODEL);
  const [review, setReview] = useState<ReviewOverrides>(saved?.review ?? {});
  const [failure, setFailure] = useState<string | null>(null);
  const [savedNow, setSavedNow] = useState(false);
  const [pending, startTransition] = useTransition();

  const harness = harnesses.find((h) => h.id === provider);
  const modelKnown = model === "" || (harness?.models.some((m) => m.slug === model) ?? false);
  const unchanged = saved !== null && saved.provider === provider && saved.model === model && JSON.stringify(saved.review ?? {}) === JSON.stringify(review);

  const submit = () => {
    setFailure(null);
    startTransition(async () => {
      const outcome = await saveSettings({ provider, model, review });
      if (!outcome.ok) {
        setFailure(outcome.message);
        return;
      }
      setSavedNow(true);
      router.refresh(); window.dispatchEvent(new Event("factory:refresh"));
    });
  };

  return (
    <>
      <PanelHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col divide-y p-4 md:p-8">
          <SettingsSection
            id="new-jobs"
            title="New jobs"
            description={
              <>
                The harness and model the runner starts new factory sessions on. Sessions already running keep theirs. A
                repository can override these, and sets how far the factory merges, on{" "}
                <Link href="/repositories" className="underline underline-offset-2">
                  Repositories
                </Link>
                .
              </>
            }
          >
            <Card>
              <CardContent className="flex flex-col gap-6">
                <Current saved={saved} harnesses={reported ?? []} />
                {reported === null ? (
                  <p className="text-sm text-muted-foreground">
                    No machine has reported its harnesses yet. The runner reports them with its inventory, at startup and every
                    few minutes; once one has, you can pick a harness here.
                  </p>
                ) : (
                  <div className="flex flex-col gap-5">
                    <ReviewSettings value={review} onChange={setReview} harnesses={harnesses} global />
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="settings-model">Model</FieldLabel>
                        <Select
                          items={[{ value: "", label: "Runtime default" }, ...(harness?.models.map((m) => ({ value: m.slug, label: m.name })) ?? [])]}
                          value={modelKnown ? model : null}
                          onValueChange={(slug) => {
                            if (slug === null) return;
                            setModel(slug);
                            setSavedNow(false);
                          }}
                          disabled={!harness || harness.models.length === 0}
                        >
                          <SelectTrigger id="settings-model" className="w-full">
                            <SelectValue placeholder="Pick a model" />
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="">Runtime default</SelectItem>
                            {harness?.models.map((m) => (
                              <SelectItem key={m.slug} value={m.slug}>
                                {m.name}
                                {m.name !== m.slug && <span className="font-mono text-xs text-muted-foreground">{m.slug}</span>}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </Field>
                    </div>
                  </div>
                )}
                {failure && (
                  <p role="alert" className="text-sm text-destructive">
                    {failure}
                  </p>
                )}
              </CardContent>
              {reported !== null && (
                <CardFooter className="gap-3 border-t">
                  <Button onClick={submit} disabled={pending || !harness || !modelKnown || unchanged}>
                    {pending && <Spinner data-icon="inline-start" />}
                    Save
                  </Button>
                  {savedNow && unchanged && <span className="text-sm text-muted-foreground">Saved. The next launch uses it.</span>}
                </CardFooter>
              )}
            </Card>
          </SettingsSection>
        </div>
      </div>
      <PanelFooter status={status} />
    </>
  );
}
