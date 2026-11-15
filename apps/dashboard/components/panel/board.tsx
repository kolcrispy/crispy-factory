import type { AgentRow, MachineRow, RunRow } from "@factory/storage/schema";
import { cn } from "../../lib/utils";
import { STAGES } from "@factory/core/events";
import { type BoardCard } from "./cards";
import { StageCard } from "./run-card";
import { STAGE_META } from "./stages";


export function Board({
  cards,
  agentsBySession,
  selected,
  machines,
  repoLabels,
}: {
  cards: readonly BoardCard[];
  agentsBySession: Map<string, AgentRow[]>;
  selected: string | undefined;
  machines: ReadonlyMap<string, MachineRow>;
  /** Each repo's short name, while more than one repo has jobs; undefined shows no repo. */
  repoLabels?: ReadonlyMap<string, string>;
}) {
  const agentsOf = (runs: readonly RunRow[]) =>
    runs.flatMap((r) => agentsBySession.get(r.session_id) ?? []);
  const columns = ["needs_human", ...STAGES] as const;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 divide-x overflow-x-auto overflow-y-hidden">
      {columns.map((stage) => {
        const meta = stage === "needs_human" ? { label: "Needs human", dot: "bg-warning" } : STAGE_META[stage];
        const items = cards.filter((c) => stage === "needs_human" ? c.needsHuman : !c.needsHuman && c.stage === stage);
        return (
          <section
            key={stage}
            data-stage={stage}
            aria-label={meta.label}
            className="flex h-full w-80 shrink-0 flex-col last:border-e"
          >
            <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/72 px-3 font-medium">
              <span className={cn("size-2 rounded-full", meta.dot)} />
              {meta.label}
              <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-y-contain p-2">
              {items.length === 0 && <p className="px-1 text-xs text-faint">None</p>}
              {items.map((card) => (
                <StageCard
                  key={card.id}
                  card={card}
                  machineName={card.machineId && (machines.get(card.machineId)?.name ?? card.machineId)}
                  agents={agentsOf(card.runs)}
                  selected={card.runs.some((r) => r.session_id === selected)}
                  repoLabel={card.repo ? repoLabels?.get(card.repo) : undefined}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
