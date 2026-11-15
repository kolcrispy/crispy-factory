import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Popover, Textarea, TextareaState } from "gpui-base";
import { exec, props, readTextFile, writeTextFile, appHome, theme, nextCommand } from "herdr";
import { subscribe } from "./realtime.js";
import { Actions } from "./actions.js";

const text = (value) => value == null ? "" : String(value);
const when = (value) => value ? new Date(value).toLocaleString() : "Not available";
const activeStage = stage => ["building", "reviewing"].includes(stage);
const stageColor = (stage, t) => stage === "failed" ? t.blocked : stage === "done" ? t.done : stage === "queued" ? t.dim : activeStage(stage) ? t.working : t.accent;
const needsAttention = job => job.needs_human === true;

export default class Factory extends View {
  init(_props, cx) {
    this.jobs = [];
    this.spend = {};
    this.repositories = [];
    this.query = "";
    this.repo = "All repositories";
    this.stage = "All stages";
    this.archived = false;
    this.selected = null;
    this.loading = false;
    this.pairing = false;
    this.error = "";
    this.updated = null;
    this.dropdown = null;
    this.collapsed = new Set();
    this.form = null;
    this.controls = null;
    this.defaults = [];
    this.createRepo = "";
    this.titleInput = InputState.new({ placeholder: "Job title (3-200 characters)" });
    this.bodyInput = TextareaState.new({ placeholder: "Brief or feedback. Do not include secrets.", rows: 6 });
    this.titleInput.on("change", (_e, cx) => cx.notify());
    this.bodyInput.on("change", (_e, cx) => cx.notify());
    this.actions = new Actions({
      cli: (resource, action, input) => this.cli(resource, action, input),
      load: async () => { this.journal = await readTextFile(`${appHome()}/factory-pending-actions.json`); return this.journal; },
      save: async value => { if (value === this.journal) return; await writeTextFile(`${appHome()}/factory-pending-actions.json`, value, this.journal); this.journal = value; },
      changed: () => cx.notify(),
    });
    cx.spawn(async cx => { try { await this.actions.restore(); } catch (error) { this.error = error.message; cx.notify(); } });
    this.search = InputState.new({ placeholder: "Search title or JOB key" });
    this.live = false;
    this.pairCode = InputState.new({ placeholder: "One-time pairing code" });
    this.pairCode.on("change", (_event, cx) => cx.notify());
    this.runnerUrl = InputState.new({ placeholder: "http://127.0.0.1:3009" });
    this.runnerUrl.on("change", (_event, cx) => cx.notify());
    this.search.on("change", (_event, cx) => { this.query = this.search.value().toLowerCase(); cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    cx.spawn(async cx => {
      for (;;) {
        try {
          const raw = await readTextFile(`${appHome()}/mods/factory/realtime.json`);
          if (!raw) throw new Error("Pair runner for realtime updates");
          await subscribe(JSON.parse(raw), snapshot => {
            if (snapshot.version !== 1 || !Array.isArray(snapshot.jobs)) throw new Error("Unsupported runner snapshot");
            this.jobs = snapshot.jobs; this.repositories = snapshot.repositories;
            this.spend = snapshot.spend ?? {};
            this.live = true; this.error = ""; this.updated = new Date().toLocaleTimeString(); cx.notify();
          });
        } catch (error) { this.live = false; this.error = error instanceof Error ? error.message : "Runner offline"; cx.notify(); }
        await cx.sleep(5000);
      }
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refresh(cx);
        if (command === "search") this.search.focus();
        if (command === "close-detail") { this.selected = null; this.form = null; }
        if (command === "new-job") this.openForm("create", cx);
        if (command === "repositories") this.dropdown = this.dropdown === "repo" ? null : "repo";
        if (command === "stages") this.dropdown = this.dropdown === "stage" ? null : "stage";
        if (command === "toggle-status") {
          const stage = this.visibleJobs()[0]?.stage;
          if (stage) this.collapsed.has(stage) ? this.collapsed.delete(stage) : this.collapsed.add(stage);
        }
        if (command === "toggle-archived") this.archived = !this.archived;
        if (command === "next-repository") this.cycle("repo", this.repositoryOptions(), cx);
        if (command === "next-stage") this.cycle("stage", ["All stages", ...new Set(this.jobs.map(j => j.stage))], cx);
        if (command === "next-job") {
          const rows = this.visibleJobs();
          this.selected = rows[(rows.findIndex(j => j.id === this.selected) + 1) % rows.length]?.id ?? null;
        }
        if (this.selected) this.loadControls(cx);
        cx.notify();
      }
    });
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const raw = await readTextFile(`${appHome()}/mods/factory/local.json`);
        const config = { ...(raw ? JSON.parse(raw) : {}), ...(props() ?? {}) };
        if (!config.factoryHome || !config.bun) throw new Error("Install this mod from the Factory checkout to configure Bun and factoryHome.");
        this.config = config;
        const [result, repositoryResult] = await Promise.all([
          exec(config.bun, ["apps/cli/src/index.ts", "jobs", "list"], { cwd: config.factoryHome, timeout: 20000 }),
          exec(config.bun, ["apps/cli/src/index.ts", "repositories", "list"], { cwd: config.factoryHome, timeout: 20000 }),
        ]);
        if (result.code !== 0 || repositoryResult.code !== 0) throw new Error("Factory CLI failed. Check database access and the checkout configuration.");
        const data = JSON.parse(result.stdout);
        const registry = JSON.parse(repositoryResult.stdout);
        this.defaults = (await this.cli("jobs", "defaults", {})).repositories ?? [];
        if (this.form?.action === "create" && !this.createRepo) this.createRepo = this.defaults.find(repo => repo.is_default)?.repo ?? this.defaults[0]?.repo ?? "";
        await this.actions.reconcile();
        if (this.selected) this.loadControls(cx);
        if (this.live) return;
        if (!Array.isArray(data.jobs) || !Array.isArray(registry.repositories)) throw new Error("Factory CLI returned invalid jobs or repositories.");
        this.jobs = data.jobs;
        this.repositories = registry.repositories;
        this.updated = new Date().toLocaleTimeString();
        this.error = "";
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Could not load jobs.";
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  async cli(resource, action, input) {
    if (!this.config) throw new Error("Local CLI configuration unavailable.");
    const result = await exec(this.config.bun, ["apps/cli/src/index.ts", resource, action, "--input", JSON.stringify(input)], { cwd: this.config.factoryHome, timeout: 20000 });
    try { return JSON.parse(result.stdout); } catch { throw new Error("CLI outcome unavailable. Inspect pending requests before retrying."); }
  }

  loadControls(cx) {
    const id = this.selected;
    cx.spawn(async cx => {
      try { const controls = await this.cli("jobs", "controls", { jobId: id }); if (id === this.selected) this.controls = controls; }
      catch (error) { this.error = error.message; }
      cx.notify();
    });
  }

  openForm(action, cx) {
    this.form = { action, controls: this.controls, jobId: this.selected };
    this.bodyInput.set_value(""); this.titleInput.set_value("");
    if (action === "create") this.createRepo = this.defaults.find(repo => repo.is_default)?.repo ?? this.defaults[0]?.repo ?? "";
    cx.notify();
  }

  send(cx) {
    const form = this.form;
    if (!form || this.actions.busy) return;
    if (form.action === "release") {
      if (this.titleInput.value() !== form.requestId) { this.error = "Type the exact request UUID after inspecting CLI status and job history."; cx.notify(); return; }
      this.form = null;
      cx.spawn(async cx => { try { await this.actions.release(form.requestId); } catch (error) { this.error = error.message; } cx.notify(); });
      return;
    }
    const input = form.action === "create" ? { repo: this.createRepo, title: this.titleInput.value(), description: this.bodyInput.value() } : {
      jobId: form.jobId, expectedAttempt: form.controls.attempt, attempt: form.controls.attempt,
      expectedQuestionEventId: form.controls.questionEventId, headSha: form.controls.target?.headSha, body: this.bodyInput.value(),
    };
    this.form = null;
    cx.spawn(async cx => {
      try { await this.actions.submit(form.action, input, form.action); this.refresh(cx); }
      catch (error) { this.error = error.message; }
      cx.notify();
    });
  }

  pair(cx) {
    if (this.pairing) return;
    this.pairing = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const url = this.runnerUrl.value() || "http://127.0.0.1:3009";
        if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(url)) throw new Error("Use a loopback HTTP runner URL");
        const response = await fetch(`${url.replace(/\/$/, "")}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: this.pairCode.value() }) });
        if (!response.ok) throw new Error("Pairing failed; generate a fresh CLI pairing code");
        const result = await response.json();
        const path = `${appHome()}/mods/factory/realtime.json`;
        const previous = await readTextFile(path);
        await writeTextFile(path, JSON.stringify({ url, token: result.token }), previous);
        this.pairCode.set_value("");
        this.error = "Connecting to runner";
      } catch (error) { this.error = error instanceof Error ? error.message : "Pairing failed"; }
      finally { this.pairing = false; }
      cx.notify();
    });
  }

  repositoryOptions() {
    return ["All repositories", ...new Set([...this.repositories.map(repository => repository.repo), ...this.jobs.map(job => job.repo)])];
  }

  cycle(field, options, cx) {
    this[field] = options[(options.indexOf(this[field]) + 1) % options.length];
    cx.notify();
  }

  openPr(url, cx) {
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*$/.test(url ?? "")) return;
    cx.spawn(async cx => {
      try {
        const command = this.config.platform === "win32" ? "rundll32.exe" : this.config.platform === "darwin" ? "open" : "xdg-open";
        const args = this.config.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
        const result = await exec(command, args);
        if (result.code !== 0) throw new Error("Could not open pull request in the browser.");
      } catch (error) { this.error = text(error.message); cx.notify(); }
    });
  }

  visibleJobs() {
    return this.jobs.filter(j => (this.archived || !j.archived_at) && (this.repo === "All repositories" || j.repo === this.repo) && (this.stage === "All stages" || j.stage === this.stage) && `${j.key} ${j.title}`.toLowerCase().includes(this.query));
  }

  render() {
    const t = theme();
    const icon = name => svg(`mods/factory/${name}.svg`).size(14);
    const spinner = color => icon("spinner").text_color(color).spin(900);
    const badge = (label, color) => div().px(7).py(3).rounded(5).bg(color + "20").text_color(color).text_size(11).font_semibold().child(label);
    const marker = stage => activeStage(stage) ? spinner(stageColor(stage, t)) : div().size(7).rounded(4).bg(stageColor(stage, t));
    const button = (id, label, action, symbol, busy = false) => h_flex().id(id).px(8).py(6).gap(6).items_center().rounded(6).bg(t.raised).border_1().border_color(busy ? t.accent : t.border).cursor_pointer().text_size(12).accessibility_label(label).hover(el => el.bg(t.hover)).when(busy, el => el.child(spinner(t.accent))).when(Boolean(symbol) && !busy, el => el.child(icon(symbol))).when(Boolean(label) && (!["refresh", "close-detail"].includes(id) || busy), el => el.child(label)).on_click((_e, cx) => action(cx));
    const dropdown = (field, options) => Popover.new(`${field}-dropdown`).open(this.dropdown === field)
      .on_open_change((open, cx) => { this.dropdown = open ? field : null; cx.notify(); })
      .trigger(h_flex().id(`${field}-filter`).px(9).py(7).gap(6).items_center().rounded(6).border_1().border_color(t.border).cursor_pointer().text_size(12)
        .child(div().flex_1().child(this[field])).child(icon("chevron-down")))
      .content(v_flex().w(300).max_h(280).overflow_y_scroll().p(4).gap(2).rounded(6).bg(t.background).border_1().border_color(t.border)
        .children(options.map((value, index) => div().id(`${field}-option-${index}`).px(9).py(7).text_size(12).cursor_pointer().bg(value === this[field] ? t.selected : t.background)
          .hover(el => el.bg(t.hover)).child(value).on_click((_e, cx) => { this[field] = value; this.dropdown = null; cx.notify(); }))));
    const muted = value => div().text_size(12).text_color(t.dim).child(text(value));
    const rows = this.visibleJobs();
    const selected = this.jobs.find(j => j.id === this.selected);
    const repos = this.repositoryOptions();
    const stages = ["All stages", ...new Set(this.jobs.map(j => j.stage))];
    const groupOf = job => needsAttention(job) ? "Needs human" : job.stage;
    const groups = [...new Set(rows.map(groupOf))].sort((a, b) => a === "Needs human" ? -1 : b === "Needs human" ? 1 : 0);
    const list = v_flex().id("factory-list").flex_1().min_w(0).min_h(0).justify_start().overflow_y_scroll().gap(8).p(12)
      .children(groups.map(stage => {
        const jobs = rows.filter(j => groupOf(j) === stage);
        const collapsed = this.collapsed.has(stage);
        return v_flex().gap(4)
          .child(h_flex().id(`status-${stage}`).gap(6).py(5).items_center().cursor_pointer()
            .on_click((_e, cx) => { collapsed ? this.collapsed.delete(stage) : this.collapsed.add(stage); cx.notify(); })
            .child(icon(collapsed ? "chevron-right" : "chevron-down"))
            .child(jobs.some(j => activeStage(j.stage) && !needsAttention(j)) ? marker(stage) : div().size(7).rounded(4).bg(jobs.some(needsAttention) ? t.blocked : stageColor(stage, t)))
            .child(div().flex_1().text_size(12).font_semibold().text_color(stageColor(stage, t)).child(stage))
            .child(badge(String(jobs.length), stageColor(stage, t))))
          .when(!collapsed, el => el.children(jobs.map(j => v_flex().id(`job-${j.id}`).px(10).py(10).gap(6).rounded(8).bg(t.raised).border_1().border_color(stageColor(j.stage, t) + "60").cursor_pointer().hover(el => el.bg(t.hover))
            .on_click((_e, cx) => { this.selected = j.id; this.controls = null; this.form = null; this.dropdown = null; this.loadControls(cx); cx.notify(); })
            .child(h_flex().gap(8).items_center().child(badge(j.key, stageColor(j.stage, t))).child(div().flex_1().text_size(13).font_semibold().child(j.title)).when(needsAttention(j), el => el.child(badge(j.stage, stageColor(j.stage, t)))))
            .child(div().text_size(11).text_color(t.dim).child(`${j.repo} · ${j.model ?? "Model pending"} · ${when(j.updated_at)}`)))));
      }))
      .when(rows.length === 0, el => el.child(muted(this.loading ? "Loading jobs…" : this.error && !this.updated ? "Jobs unavailable" : "No matching jobs")));
    const detail = v_flex().id("factory-detail").flex_1().min_w(0).min_h(0).justify_start().overflow_y_scroll().p(18).gap(12);
    if (selected) {
      detail.child(h_flex().gap(8).items_center().child(button("close-detail", "Back to jobs", cx => { this.selected = null; cx.notify(); }, "arrow-left")).child(badge(selected.key, stageColor(selected.stage, t))).child(needsAttention(selected) ? badge("Needs you", t.blocked) : marker(selected.stage)).child(badge(selected.stage, stageColor(selected.stage, t))));
      detail.child(div().text_size(18).font_semibold().child(selected.title));
      detail.child(muted(selected.repo));
      if (selected.pr_url) detail.child(button("open-pr", "Open PR", cx => this.openPr(selected.pr_url, cx), "external-link"));
      detail.child(muted(`Harness: ${selected.provider ?? "Pending"}\nModel: ${selected.model ?? "Pending"}\nUpdated: ${when(selected.updated_at)}\nCreated: ${when(selected.claimed_at)}`));
      const branch = `factory/${selected.key}${selected.attempt > 1 ? `-a${selected.attempt}` : ""}`;
      const cost = this.spend[branch];
      detail.child(muted(`Independent review: ${selected.attempt_review?.state ?? "Not enabled"}\nSpend: ${cost?.known ? `$${cost.usd.toFixed(4)}` : "Unknown"}`));
      detail.child(div().text_size(13).child(selected.stage_summary || "No progress summary yet."));
      if (selected.attention) detail.child(div().text_size(13).text_color(t.blocked).child(`Needs human: ${selected.attention.reason}\n${selected.attention.action}`));
      if (selected.question) detail.child(div().text_size(13).child(selected.question));
      const labels = { answer: "Answer", changes: "Changes", approve: "Merge", stop: "Stop", close: "Close", retry: "Retry", "retry-stop": "Retry stop", review: "Review", "review-changes": "Builder changes", archive: "Archive", unarchive: "Unarchive" };
      if (this.controls?.jobId === selected.id) detail.child(v_flex().gap(6).children((this.controls.actions ?? []).map(action => button(`action-${action}`, labels[action], cx => {
        this.openForm(action, cx);
        if (["archive", "unarchive"].includes(action)) this.send(cx);
      }))));
      detail.child(div().text_size(13).child(selected.description || "No description."));
    }
    const form = v_flex().id("factory-action-form").flex_1().min_h(0).overflow_y_scroll().p(18).gap(12);
    if (this.form) {
      const action = this.form.action;
      const consequences = { approve: "Merge this exact PR head. Irreversible. Runner review and CI gates still apply.", stop: "Interrupt this attempt. Completion requires runner confirmation.", retry: "Start a new isolated attempt, inheriting current policy and spending model usage.", close: "Close the PR and fail this job.", review: "Request independent review again. Does not bypass PASS or reset repair allowance.", "review-changes": "Return explicit changes to the builder on this held attempt. Independent review remains required." };
      form.child(div().text_size(18).font_semibold().child(action === "create" ? "New job" : action));
      form.child(muted(!this.live ? "Runner offline/unpaired: accepted requests may remain queued. Not success." : "Runs as your trusted local OS operator."));
      if (action === "create") {
        form.children(this.defaults.map(repo => button(`create-repo-${repo.repo}`, `${repo.repo === this.createRepo ? "✓ " : ""}${repo.repo}`, cx => { this.createRepo = repo.repo; cx.notify(); })));
        const policy = this.defaults.find(repo => repo.repo === this.createRepo);
        if (policy) form.child(muted(`Builder: ${policy.harness.provider} / ${policy.harness.model}\nReview: ${policy.review.enabled ? `${policy.review.provider} / ${policy.review.model}` : "Disabled"}\n${policy.problems.join("\n")}\nPolicy is resolved again when claimed.`));
        form.child(muted(`Active work in repository: ${this.jobs.filter(job => job.repo === this.createRepo && !["done", "failed"].includes(job.stage)).map(job => `${job.key}: ${job.title}`).join("; ") || "None"}. Check overlap before filing.`));
        form.child(Input.new(this.titleInput).h(34).w_full().border_1().border_color(t.border).px(8));
      } else if (action === "release") {
        form.child(muted(`Inspect request status and job history first. Releasing this local hold neither cancels nor retries work. An original process may still complete.\nType request UUID: ${this.form.requestId}`));
        form.child(Input.new(this.titleInput).h(34).w_full().border_1().border_color(t.border).px(8));
      } else form.child(muted(`Attempt ${this.form.controls.attempt}${action === "approve" ? `\nSHA ${this.form.controls.target.headSha}` : ""}\n${consequences[action] ?? "Send explicit feedback to this job."}`));
      if (["create", "answer", "changes", "review-changes", "stop", "close", "retry"].includes(action)) form.child(Textarea.new(this.bodyInput).h(170).w_full().border_1().border_color(t.border).px(8));
      form.child(button("send-action", action === "create" ? "File job" : ["answer", "changes", "review-changes"].includes(action) ? "Send" : "Confirm", cx => this.send(cx)));
      form.child(button("cancel-action", "Cancel", cx => { this.form = null; cx.notify(); }));
    }
    return v_flex().id("factory-root").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().p(14).gap(12).items_center().child(div().size(9).rounded(5).bg(t.accent)).child(div().flex_1().text_size(18).font_semibold().child("Factory"))
        .child(button("new-job", "New job", cx => this.openForm("create", cx)))
        .child(button("refresh", this.loading ? "Refreshing" : "Refresh", cx => this.refresh(cx), "refresh", this.loading)))
      .child(h_flex().px(14).pb(10).gap(8).items_center()
        .child(div().size(7).rounded(4).bg(this.live ? t.done : t.blocked))
        .child(badge(this.live ? "Runner live" : "Offline / unpaired", this.live ? t.done : t.blocked))
        .child(muted("Local operator")))
      .when(!selected && !this.form, el => el.child(h_flex().px(14).pb(12).gap(6)
        .child(badge(`${rows.filter(j => activeStage(j.stage) && !needsAttention(j)).length} active`, t.working))
        .child(badge(`${rows.filter(needsAttention).length} attention`, t.blocked))
        .child(badge(`${rows.filter(j => j.stage === "done").length} done`, t.done))))
      .when(!this.live, el => el.child(h_flex().px(14).pb(8).gap(6)
        .child(Input.new(this.runnerUrl).h(30).flex_1().border_1().border_color(t.border).px(8))
        .child(Input.new(this.pairCode).h(30).flex_1().border_1().border_color(t.border).px(8))
        .child(button("pair-runner", this.pairing ? "Pairing" : "Pair runner", cx => this.pair(cx), null, this.pairing))))
      .when(!selected && !this.form, el => el.child(v_flex().px(14).pb(10).gap(8)
        .child(Input.new(this.search).w_full().h(34).px(10).border_1().border_color(t.border).rounded(6).text_size(13))
        .child(v_flex().gap(6)
          .child(dropdown("repo", repos))
          .child(dropdown("stage", stages))
          .child(button("archived-filter", this.archived ? "Archived: shown" : "Archived: hidden", cx => { this.archived = !this.archived; cx.notify(); })))))
      .when(Boolean(this.error), el => el.child(div().px(14).pb(10).text_size(12).text_color(t.blocked).child(this.error)))
      .when(Boolean(this.actions.notice), el => el.child(div().px(14).pb(8).text_size(12).child(this.actions.notice)))
      .children(this.actions.pending.map(item => v_flex().px(14).pb(6).gap(4).child(div().text_size(12).text_color(t.blocked).child(`${item.label}: ${item.status} · ${item.intentId ?? item.requestId}. Refresh to inspect. Unknown outcomes are never replayed.`)).when(item.status === "unknown", el => el.child(button(`release-${item.requestId}`, "Resolve inspected request", cx => { this.titleInput.set_value(""); this.form = { action: "release", requestId: item.requestId }; cx.notify(); })))) )
      .child(this.form ? form : selected ? detail : list);
  }
}
