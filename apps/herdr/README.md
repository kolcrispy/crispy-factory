# Factory for Herdr

Native job-control workspace panel alongside Rig Board, not a terminal tab. Source lives in `mods/factory/`; the installed copy lives in the Herdr configuration directory. Requires Herdr running with the custom `rig-workspace` layout and `rig-workspace-tabs` mod, Bun, this checkout's installed dependencies and database configuration. The dashboard is optional; the runner supplies realtime updates and executes queued actions.

```sh
bun apps/herdr/install.ts
```

Checks and copies the mod, writes machine-local `local.json` with checkout/Bun paths, registers Factory in the custom Rig workspace panel stack and selector, then opens the panel. Existing Files, Changes, Rig Board and terminal panes remain unchanged. The installer refuses unexpected selector wiring and unmanaged `factory` mods. `--no-open` integrates without opening; `HERDR_APP_HOME` overrides the configuration directory. Reinstall after source changes; edit the repo, not the installed copy. Generated Herdr type/config files are ignored.

Rig Board itself is optional: Factory installation needs only the custom layout's panel stack and selector, and does not restore a removed Rig Board panel.

The panel subscribes directly to the runner's read-only SSE interface after pairing. Run `bun run cli realtime pair --input '{"label":"Herdr"}'`, enter its URL and one-time code, then choose **Pair runner**. The read-only token persists in machine-local `mods/factory/realtime.json`; reinstalling preserves it. A status dot beside Factory exposes live/offline state through a tooltip. There is no periodic CLI polling; startup and manual Refresh can read jobs while disconnected. The latest 200 jobs are available, including archived jobs within that limit. Repository/stage dropdowns and the archive toggle wrap horizontally as space permits. Search is not provided. Compact job cards are grouped by status; click a status header to collapse its group.

Repository options come from the SSE registry and loaded job history. New job appears only on the list toolbar. Detail actions wrap horizontally; metadata shows repo, harness and model separated by dots, without Created/Updated timestamps. Review, spend and intervention details remain visible. Mutations use the trusted local CLI; see `docs/operations.md` for authority and pending-request handling.

Status headers, job badges and card borders use the active Herdr theme's semantic colors. Summary badges count visible active jobs, owner attention (including held reviews), and merged jobs. Native SVG spinners indicate running status groups, active job details, refresh and pairing; held reviews show `Needs you` instead of implying continued execution. Animations run only while drawn, without JavaScript render timers. Refresh and pairing reject overlapping requests.

Query failures preserve the last successful snapshot and show an error/stale indicator. Realtime uses a revocable read-only token, distinct from reporting credentials; fallback uses trusted local CLI credentials. Treat the Herdr account as a trusted operator. Do not share its configuration, client token, or database credentials. See `docs/operations.md` for revocation and the shared snapshot/SSE contract.

Native commands can also be bound in Herdr keys: `factory.refresh`, `factory.new-job`, `factory.next-job` (cycle filtered jobs), `factory.close-detail`, `factory.repositories` / `factory.stages` (toggle dropdown), `factory.next-repository`, `factory.next-stage`, `factory.toggle-status` (collapse/expand the first filtered status group), and `factory.toggle-archived`. For example, `herdr-app do factory.next-job` opens the first filtered job without pointer automation. Commands reach shown copies only.

Validation:

```sh
herdr-app check apps/herdr/mods/factory
herdr-app status
herdr-app shot
```

Exercise disconnected/unpaired rendering as well as successful data loads: Herdr's error-state color token is `blocked`, not `error`.

The check only covers initial rendering. Inspect the live app after data loads, including job details and filters.
