# 06: Penerimaan headless end-to-end dan recovery

**What to build:** Operator memperoleh bukti bahwa factory dapat di-bootstrap dan dioperasikan penuh tanpa dashboard, termasuk gangguan runner dan intervensi manusia, bukan sekadar susunan modul yang terlihat terpisah.

**Blocked by:** 05: Cutover dashboard opsional dan migrasi eksplisit.

**Status:** ready-for-agent

- [ ] Lakukan penerimaan dengan dashboard benar-benar dihentikan/tidak dipasang. Gunakan repository, database, account/configuration, dan layanan uji terisolasi; jangan memakai production jobs.
- [ ] Buktikan fresh bootstrap dari CLI: konfigurasi, registrasi/onboarding repository, secret provisioning aman, readiness, policy dan notifikasi tanpa langkah panel.
- [ ] Buktikan alur Linear intake sampai T3 execution, evidence terikat commit, PR creation, dan source write-back; pertahankan jalur local dan Modal existing.
- [ ] Buktikan answer/review feedback, stop terkonfirmasi, retry dengan attempt terisolasi, merge approval melalui runner, serta close/dismiss/archive lifecycle sesuai kontrak existing.
- [ ] Hentikan runner pada skenario uji terkendali, terima command durable dan traffic gateway, lalu mulai ulang; buktikan recovery, hasil inspectable, dan tidak ada duplicate execution/action.
- [ ] Buktikan request replay idempotent dan CLI wait timeout tidak membatalkan pekerjaan accepted. Pertahankan actor/audit attribution dan owner/signature checks.
- [ ] Buktikan Slack filing/interactions/notifikasi berfungsi ketika dashboard mati, tanpa tautan panel sebagai prerequisite intervensi.
- [ ] Verifikasi install/build runner, CLI, dan gateway tanpa Next.js serta dashboard build tanpa migrasi. Migrasi explicit dan guard target database tetap berfungsi.
- [ ] Jalankan regresi focused yang mencakup perubahan, mengikuti harness guards. Bukti fake-based tidak boleh dilaporkan sebagai bukti live end-to-end; catat command, hasil, lingkungan uji, dan batas verifikasi sebenarnya tanpa secret.
- [ ] Perbaiki gap consumer-visible yang ditemukan sampai acceptance terpenuhi; jangan menutup tiket dengan stub, fake fallback, atau scope diam-diam dipersempit. Jika layanan/credential uji tidak tersedia, laporkan blocker tepat dan jangan mengklaim penerimaan lengkap.
- [ ] Lengkapi dokumentasi operasi headless, status command, recovery, deployment/migration, serta cleanup artefak dan resource uji. Windows dan replacement T3 tetap pekerjaan terpisah.

## Verification progress

No live end-to-end acceptance claimed. Neon CLI is available, but project `tiny-firefly-89834288` has no local credentials; project access returned `Cannot run interactive auth in CI`. Operator selected authentication unavailable. Do not bypass the isolated branch harness or use production credentials/jobs. Designated local/Modal/T3/Linear/GitHub/Slack test infrastructure and authorized dashboard proof are still required. Tickets 01-06 remain open.

PostgreSQL-default update: isolated PostgreSQL 17 migrations and CLI, gateway, lint-boundary, migrate-guard, claim, inbox, new-job, owner, repositories, settings, stop, and ingest regressions passed without Neon credentials. Onboarding regression currently fails in its POSIX shell fixture on Windows (`spawnSync` status null); outbox regression cannot resolve SDK dependency `cross-spawn` despite frozen install reporting no changes. These are not live T3/Modal acceptance. Dashboard non-Neon authentication is deferred by explicit operator decision.

Retry, Slack actions, Slack notifications, Slack source, and webhook regressions also passed on disposable PostgreSQL 17. Bootstrap installers now accept `FACTORY_GATEWAY_URL` without Neon provisioning. Optional Neon deployment uses its dedicated gateway hosting adapter.

Full-suite run on Windows found and fixed: unquoted repository path in the build script, POSIX-only paths in attachment/auto-merge/outbox/onboarding fixtures, `path.join` leaking backslashes into sandbox wiring, `loadEnvFile` receiving a URL in the dashboard config, a test-mode temp guard comparing with `/`, and a proxy regression depending on a developer Realtime secret. `cleanup-regressions` reports an explicit skip on Windows because its fake t3 CLI is a shebang script. The full default harness then passed: 52 scripts green, 1 explicit skip, on disposable PostgreSQL 17 with no Neon credentials. This is database and HTTP proof; live T3/Modal/Linear/GitHub/Slack acceptance remains outstanding.
