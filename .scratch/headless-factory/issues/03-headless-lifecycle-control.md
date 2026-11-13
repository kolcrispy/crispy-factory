# 03: Kontrol lifecycle lengkap lewat CLI

**What to build:** Operator dapat menangani seluruh intervensi dan lifecycle job dari CLI, termasuk ketika runner sementara offline, tanpa melewati aturan domain atau menganggap request diterima sebagai pekerjaan selesai.

**Blocked by:** 01: Fondasi headless: runner mandiri dan konfigurasi CLI.

**Status:** resolved

- [x] CLI mendukung answer, request changes, stop, retry job gagal, retry stop belum terkonfirmasi, approve merge, close/dismiss inbox, serta archive/unarchive sesuai kemampuan existing.
- [x] Answer/review feedback diteruskan melalui source/thread T3 existing ke job, attempt, dan PR yang benar; pertahankan semantik synchronous existing bila tidak ada alasan perilaku untuk mengubahnya menjadi intent.
- [x] Execution commands yang valid disimpan sebagai intent durable dengan request identity meski runner offline. Pengulangan request yang sama tidak menggandakan aksi.
- [x] Output membedakan accepted/queued, completion, refusal, dan execution failure. Operator dapat menginspeksi hasil atau menunggu secara opsional; timeout menunggu tidak membatalkan intent yang diterima.
- [x] Stop request dibedakan dari stop terkonfirmasi; pertahankan pending-launch binding, child-thread checks, leases, attempt isolation, dan reconciliation existing.
- [x] Retry membuka attempt baru sesuai aturan existing dan tidak menimpa attempt aktif atau menghidupkan pekerjaan ganda setelah ambiguous start/restart.
- [x] Merge approval hanya merekam intent; runner tetap satu-satunya pelaksana merge dan mempertahankan factual blockers, head-specific behavior, attribution, serta audit existing.
- [x] CLI, dashboard, dan Slack memakai use cases bersama. Pertahankan owner authorization untuk transport existing dan trusted actor CLI tanpa public unauthenticated control endpoint.
- [x] Uji consumer-visible outcomes melalui injected source/hosts dan isolated database harness, mengikuti prior art inbox, stop/retry, owner, merge-decision, dan archive. Cakup replay, offline submission lalu processing, stale attempt, refusal, serta timeout tanpa cancellation.
- [x] Launch CLI aktual untuk command/result scenarios dan periksa output/exit status tanpa mengandalkan wording incidental atau wiring assertions. Perbarui dokumentasi command dan recovery.

## Verification progress

CLI proofs distinguish queued, timeout, completion, refusal, and execution failure. Explicit operator stop preserves attempt pinning; stored intent and receipt results keep complete JSON. Inbox, stop, retry, resume, archive, merge-decision, lifecycle, claim, and stale-attempt regressions passed on disposable PostgreSQL 17, including the actual CLI for offline acceptance and waiting timeout that leaves work queued. Live T3 stop/retry/merge exercise remains part of ticket 06.
