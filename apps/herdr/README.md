# Factory for Herdr

Read-only native workspace tab. Source lives in `mods/factory/`; the installed copy lives in the Herdr configuration directory. Requires Herdr running, Bun, this checkout's installed dependencies and database configuration. Does not require the Factory dashboard or runner.

```sh
bun apps/herdr/install.ts
```

Checks the mod, copies it, writes machine-local `local.json` with the checkout and Bun executable paths, and opens/selects a Factory tab in the active workspace. `--no-open` installs without opening. `HERDR_APP_HOME` overrides the installation directory. An existing unmanaged `factory` mod is refused instead of overwritten. Reinstall after source changes; edit the repo, not the installed copy.

The panel polls `cli jobs list` every 10 seconds with an overlap guard and a 20-second command timeout. It displays at most the latest 200 jobs, including archived jobs within that limit. Search matches key/title. Repository/stage buttons cycle through available values; Archived toggles archived visibility. Click a job for its snapshot details and PR link. There are no mutation commands or dashboard links.

Query failures preserve the last successful snapshot and show an error/stale indicator. Access uses trusted local CLI credentials, not a public unauthenticated endpoint. Treat the Herdr account as a trusted operator. Do not share its configuration or database credentials.

Native commands can also be bound in Herdr keys: `factory.refresh`, `factory.search` (focus search), `factory.next-job` (cycle visible jobs), `factory.close-detail`, `factory.next-repository`, `factory.next-stage`, and `factory.toggle-archived`. For example, `herdr-app do factory.next-job` opens the first visible job without pointer automation. Commands reach shown copies only.

Validation:

```sh
herdr-app check apps/herdr/mods/factory
herdr-app status
herdr-app shot
```

The check only covers initial rendering. Inspect the live app after data loads, including job details and filters.
