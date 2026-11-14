"use client";

import type { Harness } from "@factory/core/harness";
import type { ReviewOverrides } from "@factory/core/review";
import { Field, FieldLabel } from "../ui/field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const INHERIT = "__inherit__";
export function ReviewSettings({ value, onChange, harnesses, global = false }: {
  value: ReviewOverrides; onChange: (value: ReviewOverrides) => void; harnesses: readonly Harness[]; global?: boolean;
}) {
  const providers = [{ value: INHERIT, label: global ? "Follow builder" : "Inherit reviewer harness" }, ...harnesses.filter(h => h.enabled).map(h => ({ value: h.id, label: h.name }))];
  const models = [{ value: INHERIT, label: global ? "Follow builder" : "Inherit reviewer model" }, ...Array.from(new Map(harnesses.filter(h => !value.provider || h.id === value.provider).flatMap(h => h.models.map(m => [m.slug, { value: m.slug, label: m.name }] as const))).values())];
  if (value.provider && !providers.some(item => item.value === value.provider)) providers.push({ value: value.provider, label: `${value.provider} (unavailable)` });
  if (value.model && !models.some(item => item.value === value.model)) models.push({ value: value.model, label: `${value.model} (unavailable)` });
  const field = (label: string, selected: string, items: { value: string; label: string }[], change: (next: string) => void) => <Field>
    <FieldLabel>{label}</FieldLabel>
    <Select items={items} value={selected} onValueChange={next => { if (next !== null) change(next); }}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectPopup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectPopup>
    </Select>
  </Field>;
  return <section className="flex flex-col gap-3 rounded-lg border p-4" aria-label="Independent reviewer">
    <h3 className="text-sm font-medium">Independent reviewer</h3>
    {field("Review before PR", value.enabled == null ? INHERIT : String(value.enabled), [
      { value: INHERIT, label: global ? "Default: enabled" : "Inherit review policy" },
      { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" },
    ], next => onChange({ ...value, enabled: next === INHERIT ? null : next === "true" }))}
    {field("Reviewer harness", value.provider ?? INHERIT, providers, next => onChange({ ...value, provider: next === INHERIT ? null : next }))}
    {field("Reviewer model", value.model ?? INHERIT, models, next => onChange({ ...value, model: next === INHERIT ? null : next }))}
    <p className="text-xs text-muted-foreground">Job overrides repository, then global, independently per field. Choices are frozen when an attempt starts. Invalid combinations hold the job rather than falling back.</p>
  </section>;
}
