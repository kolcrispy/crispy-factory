# 04: Gateway hosted independen untuk ingress dan Slack

**What to build:** Source webhook, laporan hooks/MCP, dan seluruh kontrol Slack tetap berfungsi melalui gateway hosted ketika dashboard tidak dipasang atau tidak berjalan.

**Blocked by:** 01: Fondasi headless: runner mandiri dan konfigurasi CLI.

**Status:** resolved

- [x] Gateway dipasang/build/deploy independen dari Next.js, mempertahankan kemampuan hosted/serverless ingest existing tanpa mewajibkan mesin gateway always-on baru.
- [x] Penerimaan source webhooks dan agent reports menjaga report-secret, signature/timestamp validation, deduplication, transactional projections, attempt identity, monotonic usage, dan refusal auditing existing.
- [x] Ingress dapat menerima traffic ketika runner PC offline selama dependency hosted tersedia; setelah runner kembali, intent/reconciliation memproses state tanpa duplicate execution.
- [x] Hooks/MCP memakai endpoint yang benar dan durable outbox tetap bounded serta tidak mengganggu eksekusi agent saat delivery gagal. Migrasikan deployment/configuration callers secara menyeluruh.
- [x] Slack slash commands, shortcut/modal submissions, buttons untuk answer/review/approval/retry dan intervensi existing berfungsi tanpa endpoint dashboard. Signature/timestamp dan configured-owner checks tetap berlaku.
- [x] Notifikasi runner dan resolusi/update pesan mempertahankan idempotency, redaction, quiet-hours dan error handling existing; link dashboard tidak boleh menjadi prerequisite tindakan.
- [x] Gateway memanggil operasi bersama, tidak menduplikasi aturan dari CLI/dashboard. Credential/configuration terbatas pada tanggung jawab gateway; jangan membuka endpoint kontrol publik tanpa autentikasi.
- [x] Setelah cutover hapus endpoint/wiring obsolete, tanpa ingress atau business logic duplikat permanen. Dokumentasikan perubahan URL dan konfigurasi eksternal yang diperlukan.
- [x] Adaptasi regresi ingest, webhook, outbox, Slack source/actions/request validation; gunakan fake/injected external clients dan harness database terisolasi yang sudah ada.
- [x] Smoke surface HTTP aktual untuk ingress dan Slack dengan dashboard mati; buktikan valid request bekerja, invalid auth ditolak, dan replay tidak menggandakan efek. Proof live hanya memakai test deployment dan data terisolasi.

## Verification progress

Independent gateway builds and actual HTTP smoke passed without the dashboard or runner: unauthorized ingest rejected, missing ingest secret fails closed, signed owner Slack help accepted, stranger denied, stale signature rejected. Authenticated ingest persists to PostgreSQL and a replay stores one event. Ingest, webhook, outbox, Slack actions, Slack notifications, and Slack source regressions passed on disposable PostgreSQL 17 with no Neon credentials. A public hosted deployment and live Slack workspace remain part of ticket 06.

PostgreSQL-default update: actual HTTP authenticated ingest and replay now pass against a disposable PostgreSQL 17 cluster with no runner/dashboard process. One event persists after two identical requests; signature/owner/missing-secret checks also pass. Hosted external Slack intervention acceptance remains outstanding.
