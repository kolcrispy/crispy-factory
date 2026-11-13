# 01: Fondasi headless: runner mandiri dan konfigurasi CLI

**What to build:** Operator dapat memasang, membangun, dan menjalankan runner serta CLI tanpa Next.js. CLI menyediakan inspeksi operasional dan konfigurasi factory melalui use cases bersama, sementara dashboard existing tetap berfungsi.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Gunakan Bun workspace dengan entry point runner dan CLI independen. Ekstrak core, storage, integrations, platform, dan reporting sejauh dibutuhkan jalur ini; hindari wrapper pass-through dan perpindahan horizontal tanpa perilaku yang dapat diuji.
- [x] Instalasi/build artefak backend tidak memerlukan instalasi/build Next.js. Runner mempertahankan startup reconciliation, intent consumption, leases, overlap guards, watchdog, dan reporting existing.
- [x] CLI operator tepercaya memakai konfigurasi lokal dan credential Postgres langsung; tidak memerlukan HTTP control backend atau proses runner yang aktif untuk query/configuration yang tidak membutuhkan eksekusi.
- [x] CLI membaca job, attempt, machine readiness, evidence, serta inbox pertanyaan/failure dengan semantik yang konsisten dengan dashboard.
- [x] CLI membaca/mengubah provider/model, default local/Modal, policy merge termasuk review requirements existing, dan notifikasi. Pertahankan precedence konfigurasi serta validasi existing.
- [x] Pisahkan autentikasi transport dari otorisasi use case; pertahankan verified-owner dashboard, actor CLI, audit, dan secret redaction. Credential database bukan akses untuk client tidak tepercaya.
- [x] Pindahkan semua caller yang terkena ekstraksi tanpa implementasi core duplikat atau alias kompatibilitas permanen. Shared modules tidak mengimpor aplikasi atau framework dashboard.
- [x] Pertahankan SourceAdapter, JobHost, dan dependency injection existing. Regression harness Neon terisolasi tetap berjalan; jangan bypass test guards.
- [x] Buktikan CLI aktual untuk query dan perubahan konfigurasi dengan dependency/environment uji terisolasi. Uji hasil observable, refusal, actor attribution, dan tidak bocornya secret, bukan susunan folder/source text.
- [x] Perbarui dokumentasi instalasi, konfigurasi, dan command yang berubah. Ikuti spec induk dan ADR-0001; Windows serta penggantian T3 bukan bagian tiket ini.

## Verification progress

Backend-only filtered install/build and compiled CLI help passed without Next.js. On a disposable PostgreSQL 17 cluster (no Neon credentials) the full default harness passed: 52 scripts, 1 explicit POSIX-only skip. That includes the actual CLI persisting notification configuration, acting as the trusted actor, reporting queued/timeout/done/refused/failed, replaying request ids, and redacting secrets. TypeScript, ESLint, backend build, and the dashboard production build also passed.
