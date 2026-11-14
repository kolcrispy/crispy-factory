# Factory for Herdr

Read-only native workspace panel alongside Rig Board, not a terminal tab. Source lives in `mods/factory/`; the installed copy lives in the Herdr configuration directory. Requires Herdr running with the custom `rig-workspace` layout and `rig-workspace-tabs` mod, Bun, this checkout's installed dependencies and database configuration. Does not require the Factory dashboard or runner.

```sh
bun apps/herdr/install.ts
```

Checks and copies the mod, writes machine-local `local.json` with checkout/Bun paths, registers Factory in the custom Rig workspace panel stack and selector, then opens the panel. Existing Files, Changes, Rig Board and terminal panes remain unchanged. The installer refuses unexpected selector wiring and unmanaged `factory` mods. `--no-open` integrates without opening; `HERDR_APP_HOME` overrides the configuration directory. Reinstall after source changes; edit the repo, not the installed copy. Generated Herdr type/config files are ignored.

The panel polls `cli jobs list` every 10 seconds with an overlap guard and a 20-second command timeout. It displays at most the latest 200 jobs, including archived jobs within that limit. Search matches key/title. Repository/stage buttons cycle through available values; Archived toggles archived visibility. Clicking a job replaces the list with its full-width detail page and PR link. **Back to jobs** returns to the list with search/filter state preserved. There are no mutation commands or dashboard links.

Query failures preserve the last successful snapshot and show an error/stale indicator. Access uses trusted local CLI credentials, not a public unauthenticated endpoint. Treat the Herdr account as a trusted operator. Do not share its configuration or database credentials.

Native commands can also be bound in Herdr keys: `factory.refresh`, `factory.search` (focus search), `factory.next-job` (cycle visible jobs), `factory.close-detail`, `factory.next-repository`, `factory.next-stage`, and `factory.toggle-archived`. For example, `herdr-app do factory.next-job` opens the first visible job without pointer automation. Commands reach shown copies only.

Validation:

```sh
herdr-app check apps/herdr/mods/factory
herdr-app status
herdr-app shot
```

The check only covers initial rendering. Inspect the live app after data loads, including job details and filters.
