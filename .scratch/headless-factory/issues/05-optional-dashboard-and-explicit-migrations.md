# 05: Cutover dashboard opsional dan migrasi eksplisit

**What to build:** Dashboard menjadi aplikasi opsional yang dapat dipasang/build/deploy sendiri, sementara backend dan CLI tetap bekerja tanpa Next.js. Migrasi database menjadi operasi eksplisit milik storage, bukan efek samping deployment UI.

**Blocked by:** 02: Bootstrap repository dan pengajuan job tanpa panel; 03: Kontrol lifecycle lengkap lewat CLI; 04: Gateway hosted independen untuk ingress dan Slack.

**Status:** ready-for-agent

- [ ] Dashboard memiliki entry point dan dependency installation/build tersendiri; build UI gagal atau deployment UI dihentikan tidak menghalangi runner, CLI, atau gateway.
- [ ] Semua query dan kontrol existing tetap tersedia melalui modul bersama, tanpa duplikasi aturan. Verified-owner authorization, empty allowlist deny, auth browser, dan realtime behavior existing dipertahankan.
- [ ] Dashboard boleh memakai storage melalui shared modules; tidak memaksa semua query melalui gateway atau membuat panggilan langsung dashboard-to-runner.
- [ ] Storage memiliki schema dan migrasi authoritative. Migrasi dijalankan eksplisit sebelum backend deploy yang membutuhkannya, dengan direct connection dan production-target guard yang tetap efektif.
- [ ] Build/deploy dashboard tidak menjalankan migrasi atau memerlukan credential runner/agent lokal; konfigurasi dan secret dipisahkan per tanggung jawab.
- [ ] Migrasikan seluruh import, operational scripts, deployment configuration, installers, hooks/reporting references, playbook delivery, dan test entry points yang terdampak susunan workspace. Hapus implementasi/config/alias obsolete setelah caller beralih.
- [ ] Pertahankan satu database dan kontrak existing; jangan menyelipkan schema redesign, source baru, message broker, atau penggantian T3.
- [ ] Buktikan independensi melalui pemasangan/build artefak backend tanpa dependency Next.js, bukan pemeriksaan source text atau folder snapshot.
- [ ] Verifikasi dashboard aktual untuk surface yang dipindahkan, termasuk owner access dan satu operasi/query representatif; jalankan regresi migration guard dan kontrak terkait secara terisolasi.
- [ ] Dokumentasikan install/run/deploy terpisah, migration ownership, credential responsibilities, dan prosedur cutover/recovery. Tidak boleh tersisa langkah dashboard wajib untuk bootstrap atau operasi backend.
