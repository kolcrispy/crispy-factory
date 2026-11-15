import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Popover, Textarea, TextareaState } from "gpui-base";
import { exec, props, readTextFile, writeTextFile, appHome, theme, nextCommand } from "herdr";
import { subscribe } from "./realtime.js";
import { Actions } from "./actions.js";

const text = (value) => value == null ? "" : String(value);
const activeStage = stage => ["building", "reviewing"].includes(stage);
const stageColor = (stage, t) => stage === "failed" ? t.blocked : stage === "done" ? t.done : stage === "queued" ? t.dim : activeStage(stage) ? t.working : t.accent;
const needsAttention = job => job.needs_human === true;
const groupOf = job => needsAttention(job) ? "Needs you" : ["done", "failed"].includes(job.stage) ? "Done" : "Working";
const groupOrder = ["Needs you", "Working", "Done"];

export default class Factory extends View {
  init(_props, cx) {
    this.jobs = [];
    this.spend = {};
    this.activity = [];
    this.repositories = [];
    this.repo = "All repositories";
    this.stage = "All stages";
    this.archived = false;
    this.selected = null;
    this.loading = false;
    this.pairing = false;
    this.error = "";
    this.updated = null;
    this.dropdown = null;
    this.collapsed = new Set(["Done"]);
    this.listHeight = 0;
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
    cx.spawn(async cx => { try { await this.actions.restore(); await this.actions.reconcile(); } catch (error) { this.error = error.message; cx.notify(); } });
    this.live = false;
    this.pairCode = InputState.new({ placeholder: "One-time pairing code" });
    this.pairCode.on("change", (_event, cx) => cx.notify());
    this.runnerUrl = InputState.new({ placeholder: "http://127.0.0.1:3009" });
    this.runnerUrl.on("change", (_event, cx) => cx.notify());
    this.refresh(cx);
    cx.spawn(async cx => {
      for (;;) {
        try {
          const raw = await readTextFile(`${appHome()}/mods/factory/realtime.json`);
          if (!raw) throw new Error("Pair runner for realtime updates");
          await subscribe(JSON.parse(raw), snapshot => {
            if (snapshot.version !== 1 || !Array.isArray(snapshot.jobs)) throw new Error("Unsupported runner snapshot");
            this.jobs = snapshot.jobs; this.repositories = snapshot.repositories;
            this.spend = snapshot.spend ?? {};
            this.activity = snapshot.activity ?? [];
            const selectedRevision = JSON.stringify(snapshot.jobs.find(job => job.id === this.selected));
            if (selectedRevision !== this.selectedRevision) {
              this.selectedRevision = selectedRevision;
              if (this.selected) this.loadControls(cx);
            }
            const jobsRevision = JSON.stringify(snapshot.jobs);
            if (jobsRevision !== this.jobsRevision) {
              this.jobsRevision = jobsRevision;
              if (this.actions.pending.length) cx.spawn(async cx => {
                try { await this.actions.reconcile(); } catch (error) { this.error = error.message; cx.notify(); }
              });
            }
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
        if (command === "close-detail") { this.selected = null; this.form = null; }
        if (command === "new-job") this.openForm("create", cx);
        if (command === "repositories") this.dropdown = this.dropdown === "repo" ? null : "repo";
        if (command === "stages") this.dropdown = this.dropdown === "stage" ? null : "stage";
        if (command === "toggle-status") {
          const group = groupOrder.find(group => this.visibleJobs().some(job => groupOf(job) === group));
          if (group) this.collapsed.has(group) ? this.collapsed.delete(group) : this.collapsed.add(group);
        }
        if (command === "toggle-archived") this.archived = !this.archived;
        if (command === "next-repository") this.cycle("repo", this.repositoryOptions(), cx);
        if (command === "next-stage") this.cycle("stage", ["All stages", ...new Set(this.jobs.map(j => j.stage))], cx);
        if (command === "next-job") {
          const rows = this.visibleJobs();
          this.selected = rows[(rows.findIndex(j => j.id === this.selected) + 1) % rows.length]?.id ?? null;
        }
        if (command === "next-job" && this.selected) this.loadControls(cx);
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
        if (!this.live) {
          const data = await this.cli("jobs", "list", {});
          if (!Array.isArray(data.jobs)) throw new Error(data.message ?? "Factory CLI returned invalid jobs.");
          this.jobs = data.jobs;
          this.updated = new Date().toLocaleTimeString();
        }
        await this.actions.reconcile();
        if (this.selected) this.loadControls(cx);
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
    if (!this.config) {
      const raw = await readTextFile(`${appHome()}/mods/factory/local.json`);
      const config = { ...(raw ? JSON.parse(raw) : {}), ...(props() ?? {}) };
      if (!config.factoryHome || !config.bun) throw new Error("Install this mod from the Factory checkout to configure Bun and factoryHome.");
      this.config = config;
    }
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
    if (action === "create") {
      this.createRepo = "";
      cx.spawn(async cx => {
        try {
          const result = await this.cli("jobs", "defaults", {});
          if (!Array.isArray(result.repositories)) throw new Error(result.message ?? "Could not load repository defaults.");
          this.defaults = result.repositories;
          this.createRepo = this.defaults.find(repo => repo.is_default)?.repo ?? this.defaults[0]?.repo ?? "";
        } catch (error) { this.error = error.message; }
        cx.notify();
      });
    }
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
      try { await this.actions.submit(form.action, input, form.action); if (this.selected) this.loadControls(cx); }
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
    return this.jobs.filter(j => (this.archived || !j.archived_at) && (this.repo === "All repositories" || j.repo === this.repo) && (this.stage === "All stages" || j.stage === this.stage));
  }

  render() {
    const t = theme();
    const icon = name => svg(`mods/factory/${name}.svg`).size(14);
    const spinner = color => icon("spinner").text_color(color).spin(900);
    const badge = (label, color) => div().px(7).py(3).rounded(5).bg(color + "20").text_color(color).text_size(11).font_semibold().child(label);
    const marker = stage => activeStage(stage) ? spinner(stageColor(stage, t)) : div().size(7).rounded(4).bg(stageColor(stage, t));
    const primaryActions = new Set(["new-job", "send-action", "pair-runner", "action-answer", "action-approve", "action-retry", "action-review"]);
    const button = (id, label, action, symbol, busy = false) => {
      const primary = primaryActions.has(id);
      const foreground = primary ? t.background : t.foreground;
      return h_flex().id(id).flex_shrink_0().px(8).py(6).gap(6).items_center().rounded(6)
        .bg(primary ? t.foreground : t.raised).text_color(foreground).border_1().border_color(primary ? t.foreground : busy ? t.accent : t.border)
        .cursor_pointer().text_size(12).when(primary, el => el.font_semibold()).accessibility_label(label).tooltip(label)
        .hover(el => el.bg(primary ? t.dim : t.hover)).when(busy, el => el.child(spinner(primary ? foreground : t.accent)))
        .when(Boolean(symbol) && !busy, el => el.child(icon(symbol)))
        .when(Boolean(label) && !["refresh", "close-detail"].includes(id), el => el.child(label)).on_click((_e, cx) => action(cx));
    };
    const dropdown = (field, options) => Popover.new(`${field}-dropdown`).open(this.dropdown === field)
      .on_open_change((open, cx) => { this.dropdown = open ? field : null; cx.notify(); })
      .trigger(h_flex().id(`${field}-filter`).px(9).py(7).gap(6).items_center().rounded(6).border_1().border_color(t.border).cursor_pointer().text_size(12)
        .child(div().child(this[field])).child(icon("chevron-down")))
      .content(v_flex().w(300).max_h(280).overflow_y_scroll().p(4).gap(2).rounded(6).bg(t.background).border_1().border_color(t.border)
        .children(options.map((value, index) => div().id(`${field}-option-${index}`).px(9).py(7).text_size(12).cursor_pointer().bg(value === this[field] ? t.selected : t.background)
          .hover(el => el.bg(t.hover)).child(value).on_click((_e, cx) => { this[field] = value; this.dropdown = null; cx.notify(); }))));
    const muted = value => div().w_full().min_w(0).whitespace_normal().text_size(12).text_color(t.dim).child(text(value));
    const rows = this.visibleJobs();
    const selected = this.jobs.find(j => j.id === this.selected);
    const repos = this.repositoryOptions();
    const stages = ["All stages", ...new Set(this.jobs.map(j => j.stage))];
    const grouped = Object.fromEntries(groupOrder.map(group => [group, rows.filter(job => groupOf(job) === group)]));
    const groupColor = group => group === "Needs you" ? t.blocked : group === "Working" ? t.working : t.done;
    const header = group => {
      const collapsed = this.collapsed.has(group);
      const color = groupColor(group);
      return h_flex().id(`status-${group}`).flex_shrink_0().gap(6).py(5).items_center().cursor_pointer()
        .on_click((_e, cx) => { collapsed ? this.collapsed.delete(group) : this.collapsed.add(group); cx.notify(); })
        .child(icon(collapsed ? "chevron-right" : "chevron-down"))
        .child(group === "Working" && grouped[group].some(job => activeStage(job.stage)) ? spinner(color) : div().size(7).rounded(4).bg(color))
        .child(div().flex_1().text_size(12).font_semibold().text_color(color).child(group))
        .child(badge(String(grouped[group].length), color));
    };
    const cards = group => grouped[group].map(j => v_flex().id(`job-${j.id}`).flex_shrink_0().px(10).py(10).gap(6).rounded(8).bg(t.raised).border_1().border_color(stageColor(j.stage, t) + "60").cursor_pointer().hover(el => el.bg(t.hover))
      .on_click((_e, cx) => { this.selected = j.id; this.controls = null; this.form = null; this.dropdown = null; this.loadControls(cx); cx.notify(); })
      .child(h_flex().flex_wrap().gap(8).items_center().child(badge(j.key, stageColor(j.stage, t))).child(div().flex_1().min_w(120).text_size(13).font_semibold().child(j.title)).child(badge(j.stage, stageColor(j.stage, t))))
      .child(div().w_full().min_w(0).whitespace_normal().text_size(11).text_color(t.dim).child(`${j.repo} · ${j.model ?? "Model pending"}`)));
    const list = v_flex().id("factory-list").flex_1().min_w(0).min_h(0).p(12).gap(8)
      .on_size_change((size, cx) => { if (size.height !== this.listHeight) { this.listHeight = size.height; cx.notify(); } })
      .child(v_flex().id("factory-active-groups").flex_1().min_h(0).overflow_y_scroll().gap(8)
        .children(groupOrder.filter(group => group !== "Done" && grouped[group].length).map(group => v_flex().gap(4).flex_shrink_0()
          .child(header(group)).when(!this.collapsed.has(group), el => el.children(cards(group)))))
        .when(rows.length === 0, el => el.child(muted(this.loading ? "Loading jobs…" : this.error && !this.updated ? "Jobs unavailable" : "No matching jobs"))))
      .when(grouped.Done.length > 0, el => el.child(v_flex().id("factory-done-group").flex_shrink_0().min_h(0).max_h(Math.max(0, this.listHeight * 0.4)).gap(4)
        .when(!this.collapsed.has("Done"), el => el.child(v_flex().id("factory-done-jobs").min_h(0).overflow_y_scroll().gap(4).children(cards("Done"))))
        .child(header("Done"))));
    const detail = v_flex().id("factory-detail").flex_1().min_w(0).min_h(0).justify_start().overflow_y_scroll().p(18).gap(12);
    if (selected) {
      detail.child(h_flex().flex_wrap().gap(8).items_center().child(button("close-detail", "Back to jobs", cx => { this.selected = null; cx.notify(); }, "arrow-left")).child(badge(selected.key, stageColor(selected.stage, t))).child(needsAttention(selected) ? badge("Needs you", t.blocked) : marker(selected.stage)).child(badge(selected.stage, stageColor(selected.stage, t))));
      detail.child(div().text_size(18).font_semibold().child(selected.title));
      detail.child(muted(`${selected.repo} · ${selected.provider ?? "Harness pending"} · ${selected.model ?? "Model pending"}`));
      const branch = `factory/${selected.key}${selected.attempt > 1 ? `-a${selected.attempt}` : ""}`;
      const cost = this.spend[branch];
      detail.child(muted(`Review: ${selected.attempt_review?.state ?? "Not enabled"} · Spend: ${cost?.known ? `$${cost.usd.toFixed(4)}` : "Unknown"}`));
      detail.child(div().text_size(13).child(selected.stage_summary || "No progress summary yet."));
      if (selected.attention) detail.child(div().text_size(13).text_color(t.blocked).child(`Needs human: ${selected.attention.reason}\n${selected.attention.action}`));
      if (selected.question) detail.child(div().text_size(13).child(selected.question));
      const labels = { answer: "Answer", changes: "Changes", approve: "Merge", stop: "Stop", close: "Close", retry: "Retry", "retry-stop": "Retry stop", review: "Review", "review-changes": "Builder changes", archive: "Archive", unarchive: "Unarchive" };
      const actions = h_flex().flex_wrap().gap(6).items_center();
      if (selected.pr_url) actions.child(button("open-pr", "Open PR", cx => this.openPr(selected.pr_url, cx), "external-link"));
      if (this.controls?.jobId === selected.id) actions.children((this.controls.actions ?? []).map(action => button(`action-${action}`, labels[action], cx => {
        this.openForm(action, cx);
        if (["archive", "unarchive"].includes(action)) this.send(cx);
      })));
      detail.child(actions);
      const activity = this.activity.filter(item => item.jobId === selected.id)
        .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
      const activityColor = item => item.refusal || /failed|refused|needs_human/.test(item.kind) ? t.blocked
        : /done|handoff|evidence|merge_succeeded/.test(item.kind) ? t.done
        : /building|reviewing|progress|agent_start/.test(item.kind) ? t.working : t.accent;
      const stream = v_flex().id(`activity-stream-${selected.id}`).min_h(0).max_h(360).overflow_y_scroll().px(14).py(12);
      if (!activity.length) stream.child(muted(this.live ? "No activity yet." : "Connect runner to stream activity."));
      stream.children(activity.map((item, index) => {
        const color = activityColor(item);
        const at = new Date(item.at);
        return h_flex().id(`activity-${item.id}`).flex_shrink_0().items_stretch().gap(12)
          .child(v_flex().w(58).flex_shrink_0().pt(2).gap(3)
            .child(div().text_size(11).font_semibold().text_color(color).child(at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })))
            .child(div().text_size(10).text_color(t.dim).child(at.toLocaleDateString([], { month: "short", day: "numeric" }))))
          .child(v_flex().relative().w(12).flex_shrink_0().items_center()
            .when(index < activity.length - 1, el => el.child(div().absolute().top(9).bottom(0).left(5).w(2).bg(t.border)))
            .child(div().relative().mt(3).size(12).rounded(6).border_2().border_color(color).bg(index === 0 ? color : t.raised)))
          .child(v_flex().flex_1().min_w(0).pb(index === activity.length - 1 ? 0 : 18).gap(6)
            .child(h_flex().flex_wrap().gap(6).items_center()
              .child(badge(item.kind.replaceAll("_", " "), color))
              .when(index === 0, el => el.child(div().text_size(10).font_semibold().text_color(t.dim).child("LATEST"))))
            .child(div().text_size(12).whitespace_normal().text_color(t.foreground).child(item.summary))
            .when(Boolean(item.refusal), el => el.child(div().rounded(5).px(8).py(6).bg(t.blocked + "15").text_size(11).text_color(t.blocked).whitespace_normal().child(`Refused: ${item.refusal}`))));
      }));
      detail.child(v_flex().id("activity-card").flex_shrink_0().min_w(0).rounded(10).bg(t.raised).border_1().border_color(t.border).overflow_hidden()
        .child(h_flex().px(14).py(11).gap(8).items_center().border_b_1().border_color(t.border)
          .child(icon("refresh").text_color(t.accent))
          .child(div().flex_1().text_size(13).font_semibold().child("Activity"))
          .child(badge(String(activity.length), t.dim))
          .child(div().size(6).rounded(3).bg(this.live ? t.done : t.dim))
          .child(div().text_size(10).text_color(t.dim).child(this.live ? "LIVE" : "OFFLINE")))
        .child(stream));
      detail.child(div().text_size(13).whitespace_normal().child(selected.description || "No description."));
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
      form.child(h_flex().flex_wrap().gap(6)
        .child(button("send-action", action === "create" ? "File job" : ["answer", "changes", "review-changes"].includes(action) ? "Send" : "Confirm", cx => this.send(cx)))
        .child(button("cancel-action", "Cancel", cx => { this.form = null; cx.notify(); })));
    }
    return v_flex().id("factory-root").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().p(14).gap(10).items_center()
        .child(div().text_size(18).font_semibold().child("Factory"))
        .child(div().id("runner-status").size(8).flex_shrink_0().rounded(4).bg(this.live ? t.done : t.blocked).accessibility_label(this.live ? "Runner live" : "Runner offline or unpaired").tooltip(this.live ? "Runner live" : "Runner offline or unpaired"))
        .child(div().flex_1())
        .child(button("refresh", this.loading ? "Refreshing" : "Refresh", cx => this.refresh(cx), "refresh", this.loading)))
      .when(!selected && !this.form, el => el.child(h_flex().flex_wrap().px(14).pb(10).gap(6).items_center()
        .child(badge(`${grouped["Needs you"].length} Needs you`, t.blocked))
        .child(badge(`${grouped.Working.length} Working`, t.working))
        .child(badge(`${grouped.Done.length} Done`, t.done))
        .child(div().flex_1())
        .child(button("new-job", "New job", cx => this.openForm("create", cx)))))
      .when(!this.live, el => el.child(h_flex().px(14).pb(8).gap(6)
        .child(Input.new(this.runnerUrl).h(30).flex_1().border_1().border_color(t.border).px(8))
        .child(Input.new(this.pairCode).h(30).flex_1().border_1().border_color(t.border).px(8))
        .child(button("pair-runner", this.pairing ? "Pairing" : "Pair runner", cx => this.pair(cx), null, this.pairing))))
      .when(!selected && !this.form, el => el.child(h_flex().flex_wrap().px(14).pb(10).gap(6).items_center()
        .child(dropdown("repo", repos))
        .child(dropdown("stage", stages))
        .child(button("archived-filter", this.archived ? "Archived: shown" : "Archived: hidden", cx => { this.archived = !this.archived; cx.notify(); }))))
      .when(Boolean(this.error), el => el.child(div().px(14).pb(10).text_size(12).text_color(t.blocked).child(this.error)))
      .when(Boolean(this.actions.notice), el => el.child(div().px(14).pb(8).text_size(12).child(this.actions.notice)))
      .children(this.actions.pending.map(item => v_flex().px(14).pb(6).gap(4).child(div().text_size(12).text_color(t.blocked).child(`${item.label}: ${item.status} · ${item.intentId ?? item.requestId}. Refresh to inspect. Unknown outcomes are never replayed.`)).when(item.status === "unknown", el => el.child(button(`release-${item.requestId}`, "Resolve inspected request", cx => { this.titleInput.set_value(""); this.form = { action: "release", requestId: item.requestId }; cx.notify(); })))) )
      .child(this.form ? form : selected ? detail : list);
  }
}
