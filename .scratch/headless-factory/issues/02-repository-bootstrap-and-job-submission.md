# 02: Bootstrap repository dan pengajuan job tanpa panel

**What to build:** Operator mengonfigurasi repository baru hingga Ready, mengajukan job melalui Linear, dan memantau agent T3 menghasilkan evidence dan PR tanpa menggunakan dashboard.

**Blocked by:** 01: Fondasi headless: runner mandiri dan konfigurasi CLI.

**Status:** ready-for-agent

- [ ] CLI menyediakan registrasi repository, pengaturan default repository yang diperlukan, initiation onboarding, dan inspeksi progress/failure sampai Ready menggunakan workflow existing.
- [ ] Operator dapat mengetahui nama/purpose secret yang diperlukan dan menyediakan nilainya secara aman. Nilai tetap berada di secret store existing, bukan factory records, command arguments, audit, atau logs.
- [ ] Fresh bootstrap didokumentasikan tanpa langkah dashboard, termasuk konfigurasi layanan dan credential yang memang diperlukan. Jangan membuat fallback palsu ketika prerequisite belum tersedia.
- [ ] CLI membuat job lewat source filing Linear existing, mempertahankan source identity, label/routing, request idempotency, validasi, dan write-back. Tracker Markdown pengembangan bukan source job baru.
- [ ] Runner existing mengambil job dan menjalankannya melalui T3 pada local atau Modal sesuai konfigurasi. Operator bisa mengamati tahap, attempt, evidence terikat commit, dan PR dari CLI.
- [ ] Pertahankan onboarding failure/retry semantics serta readiness/capacity guards. Kesalahan upstream tampil sebagai outcome yang dapat ditindaklanjuti, bukan sukses semu.
- [ ] Gunakan use cases bersama dan existing source/host injection; migrasikan caller terkait tanpa duplikasi permanen.
- [ ] Tambahkan/adaptasi regresi perilaku mengikuti prior art repository, onboarding, new-job, launch, dan evidence; jalankan melalui harness database terisolasi ketika menulis state.
- [ ] Smoke CLI aktual membuktikan onboarding/submission dan output failure secara deterministik; verifikasi eksternal hanya pada repository dan layanan uji terisolasi. Laporkan batas proof live secara eksplisit.
- [ ] Perbarui panduan bootstrap dan submission headless. Pengujian tiket ini tetap wajib meski penerimaan lintas jalur dilakukan lagi di tiket 06.
