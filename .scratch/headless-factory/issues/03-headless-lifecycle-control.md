# 03: Kontrol lifecycle lengkap lewat CLI

**What to build:** Operator dapat menangani seluruh intervensi dan lifecycle job dari CLI, termasuk ketika runner sementara offline, tanpa melewati aturan domain atau menganggap request diterima sebagai pekerjaan selesai.

**Blocked by:** 01: Fondasi headless: runner mandiri dan konfigurasi CLI.

**Status:** ready-for-agent

- [ ] CLI mendukung answer, request changes, stop, retry job gagal, retry stop belum terkonfirmasi, approve merge, close/dismiss inbox, serta archive/unarchive sesuai kemampuan existing.
- [ ] Answer/review feedback diteruskan melalui source/thread T3 existing ke job, attempt, dan PR yang benar; pertahankan semantik synchronous existing bila tidak ada alasan perilaku untuk mengubahnya menjadi intent.
- [ ] Execution commands yang valid disimpan sebagai intent durable dengan request identity meski runner offline. Pengulangan request yang sama tidak menggandakan aksi.
- [ ] Output membedakan accepted/queued, completion, refusal, dan execution failure. Operator dapat menginspeksi hasil atau menunggu secara opsional; timeout menunggu tidak membatalkan intent yang diterima.
- [ ] Stop request dibedakan dari stop terkonfirmasi; pertahankan pending-launch binding, child-thread checks, leases, attempt isolation, dan reconciliation existing.
- [ ] Retry membuka attempt baru sesuai aturan existing dan tidak menimpa attempt aktif atau menghidupkan pekerjaan ganda setelah ambiguous start/restart.
- [ ] Merge approval hanya merekam intent; runner tetap satu-satunya pelaksana merge dan mempertahankan factual blockers, head-specific behavior, attribution, serta audit existing.
- [ ] CLI, dashboard, dan Slack memakai use cases bersama. Pertahankan owner authorization untuk transport existing dan trusted actor CLI tanpa public unauthenticated control endpoint.
- [ ] Uji consumer-visible outcomes melalui injected source/hosts dan isolated database harness, mengikuti prior art inbox, stop/retry, owner, merge-decision, dan archive. Cakup replay, offline submission lalu processing, stale attempt, refusal, serta timeout tanpa cancellation.
- [ ] Launch CLI aktual untuk command/result scenarios dan periksa output/exit status tanpa mengandalkan wording incidental atau wiring assertions. Perbarui dokumentasi command dan recovery.

## Verification progress

CLI proofs distinguish queued, timeout, completion, refusal, and execution failure. Explicit operator stop preserves attempt pinning. Stored intent/receipt results no longer truncate JSON. Guarded lifecycle regressions and live stop/retry/merge/recovery acceptance remain unexecuted pending isolated Neon authentication and designated test infrastructure. Ticket remains open.
