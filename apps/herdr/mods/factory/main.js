import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Popover } from "gpui-base";
import { exec, props, readTextFile, appHome, theme, nextCommand } from "herdr";

const text = (value) => value == null ? "" : String(value);
const when = (value) => value ? new Date(value).toLocaleString() : "Not available";
const stageColor = (stage, t) => stage === "failed" ? t.error : stage === "merged" ? t.accent : t.foreground;

export default class Factory extends View {
  init(_props, cx) {
    this.jobs = [];
    this.query = "";
    this.repo = "All repositories";
    this.stage = "All stages";
    this.archived = false;
    this.selected = null;
    this.loading = false;
    this.error = "";
    this.updated = null;
    this.dropdown = null;
    this.collapsed = new Set();
    this.search = InputState.new({ placeholder: "Search title or JOB key" });
    this.search.on("change", (_event, cx) => { this.query = this.search.value().toLowerCase(); cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refresh(cx);
        if (command === "search") this.search.focus();
        if (command === "close-detail") this.selected = null;
        if (command === "repositories") this.dropdown = this.dropdown === "repo" ? null : "repo";
        if (command === "stages") this.dropdown = this.dropdown === "stage" ? null : "stage";
        if (command === "toggle-status") {
          const stage = this.visibleJobs()[0]?.stage;
          if (stage) this.collapsed.has(stage) ? this.collapsed.delete(stage) : this.collapsed.add(stage);
        }
        if (command === "toggle-archived") this.archived = !this.archived;
        if (command === "next-repository") this.cycle("repo", ["All repositories", ...new Set(this.jobs.map(j => j.repo))], cx);
        if (command === "next-stage") this.cycle("stage", ["All stages", ...new Set(this.jobs.map(j => j.stage))], cx);
        if (command === "next-job") {
          const rows = this.visibleJobs();
          this.selected = rows[(rows.findIndex(j => j.id === this.selected) + 1) % rows.length]?.id ?? null;
        }
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
        const result = await exec(config.bun, ["run", "cli", "jobs", "list"], { cwd: config.factoryHome, timeout: 20000 });
        if (result.code !== 0) throw new Error("Factory CLI failed. Check database access and the checkout configuration.");
        const data = JSON.parse(result.stdout);
        if (!Array.isArray(data.jobs)) throw new Error("Factory CLI returned an invalid job list.");
        this.jobs = data.jobs;
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
    const button = (id, label, action, symbol) => h_flex().id(id).px(8).py(6).gap(6).items_center().rounded(6).border_1().border_color(t.border).cursor_pointer().text_size(12).accessibility_label(label).when(Boolean(symbol), el => el.child(icon(symbol))).when(Boolean(label) && !["refresh", "close-detail"].includes(id), el => el.child(label)).on_click((_e, cx) => action(cx));
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
    const repos = ["All repositories", ...new Set(this.jobs.map(j => j.repo))];
    const stages = ["All stages", ...new Set(this.jobs.map(j => j.stage))];
    const groups = [...new Set(rows.map(j => j.stage))];
    const list = v_flex().id("factory-list").flex_1().min_w(0).min_h(0).justify_start().overflow_y_scroll().gap(8).p(12)
      .children(groups.map(stage => {
        const jobs = rows.filter(j => j.stage === stage);
        const collapsed = this.collapsed.has(stage);
        return v_flex().gap(4)
          .child(h_flex().id(`status-${stage}`).gap(6).py(5).items_center().cursor_pointer()
            .on_click((_e, cx) => { collapsed ? this.collapsed.delete(stage) : this.collapsed.add(stage); cx.notify(); })
            .child(icon(collapsed ? "chevron-right" : "chevron-down"))
            .child(div().text_size(12).font_semibold().text_color(stageColor(stage, t)).child(`${stage} (${jobs.length})`)))
          .when(!collapsed, el => el.children(jobs.map(j => v_flex().id(`job-${j.id}`).px(10).py(8).gap(3).rounded(6).border_1().border_color(t.border).cursor_pointer()
            .on_click((_e, cx) => { this.selected = j.id; this.dropdown = null; cx.notify(); })
            .child(h_flex().gap(8).items_start().child(div().text_size(11).text_color(t.dim).child(j.key)).child(div().flex_1().text_size(13).child(j.title)))
            .child(div().text_size(11).text_color(t.dim).child(`${j.repo} · ${j.model ?? "Model pending"} · ${when(j.updated_at)}`)))));
      }))
      .when(rows.length === 0, el => el.child(muted(this.loading ? "Loading jobs…" : this.error && !this.updated ? "Jobs unavailable" : "No matching jobs")));
    const detail = v_flex().id("factory-detail").flex_1().min_w(0).min_h(0).justify_start().overflow_y_scroll().p(18).gap(12);
    if (selected) {
      detail.child(h_flex().gap(8).items_center().child(button("close-detail", "Back to jobs", cx => { this.selected = null; cx.notify(); }, "arrow-left")).child(div().flex_1().font_semibold().child(selected.key)));
      detail.child(div().text_size(18).font_semibold().child(selected.title));
      detail.child(muted(`${selected.repo} · ${selected.stage}`));
      if (selected.pr_url) detail.child(button("open-pr", "Open PR", cx => this.openPr(selected.pr_url, cx), "external-link"));
      detail.child(muted(`Harness: ${selected.provider ?? "Pending"}\nModel: ${selected.model ?? "Pending"}\nUpdated: ${when(selected.updated_at)}\nCreated: ${when(selected.claimed_at)}`));
      detail.child(div().text_size(13).child(selected.stage_summary || "No progress summary yet."));
      detail.child(div().text_size(13).child(selected.description || "No description."));
    }
    return v_flex().id("factory-root").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().p(14).gap(12).items_center().child(div().flex_1().text_size(18).font_semibold().child("Factory"))
        .child(button("refresh", this.loading ? "Refreshing" : "Refresh", cx => this.refresh(cx), "refresh")))
      .when(!selected, el => el.child(v_flex().px(14).pb(10).gap(8)
        .child(Input.new(this.search).w_full().h(34).px(10).border_1().border_color(t.border).rounded(6).text_size(13))
        .child(v_flex().gap(6)
          .child(dropdown("repo", repos))
          .child(dropdown("stage", stages))
          .child(button("archived-filter", this.archived ? "Archived: shown" : "Archived: hidden", cx => { this.archived = !this.archived; cx.notify(); })))))
      .when(!selected || Boolean(this.error), el => el.child(div().px(14).pb(10).text_size(12).text_color(this.error ? t.error : t.dim).child(this.error ? `${this.updated ? `Stale data · Updated ${this.updated} · ` : ""}${this.error}` : `${rows.length} shown · Latest 200 jobs · ${this.updated ? `Updated ${this.updated}` : "Connecting"} · Read-only`)))
      .child(selected ? detail : list);
  }
}
