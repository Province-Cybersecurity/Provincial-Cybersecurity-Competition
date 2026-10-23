"use strict";

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const pageNames = { overview: "工作台", "new-run": "发起巡检", history: "巡检记录", findings: "风险与证据", reports: "报告中心", settings: "接入与计划" };
  const severityNames = { high: "高风险", medium: "中风险", low: "低风险", info: "提示" };
  const reviewNames = { pending: "待确认", confirmed: "已确认", false_positive: "误报" };
  const severityOrder = { high: 0, medium: 1, low: 2, info: 3 };
  const tokenKey = "xunan-api-token";
  let token = "";
  let state = { runs: [], targets: [], schedules: [], events: [] };
  let selectedRun = null;
  let loadSequence = 0;
  let busy = false;
  let toastTimer;
  let connected = false;
  let cache = new Map();
  let historyPage = 1;
  let refreshing = false;
  let refreshTask = null;
  let lastRefresh = null;
  let previewSequence = 0;
  let demoKeywords = null;
  const categoryNames = { sensitive: "敏感信息", transport: "传输安全", review: "页面行为", hardening: "配置加固", custom: "自定义关键词" };
  const filterIds = ["severity-filter", "review-filter", "rule-filter", "category-filter", "url-filter", "finding-search"];

  function node(tag, className, content) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (content !== undefined && content !== null) result.textContent = String(content);
    return result;
  }

  function replace(selector, children) {
    const parent = typeof selector === "string" ? $(selector) : selector;
    parent.replaceChildren(...(Array.isArray(children) ? children : [children]));
    return parent;
  }

  function action(label, callback, className = "button secondary small") {
    const button = node("button", className, label);
    button.type = "button";
    button.addEventListener("click", callback);
    return button;
  }

  function notify(message, isError = false) {
    const toast = $("#toast");
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 11000 : 6000);
  }

  function string(value, fallback = "—") {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function number(value) { return Math.max(0, Number(value) || 0); }

  function date(value) {
    if (!value) return "时间未记录";
    const parsed = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function targetLabel(run) {
    if (run.mode === "demo") return "内置演示样例" + (run.variant === "before" ? " · 修复前" : run.variant === "after" ? " · 修复后" : "");
    return string(run.target, "未记录目标");
  }

  function runLabel(run) { return `${date(run.created_at)} · ${targetLabel(run)} · ${number(run.summary?.total)} 条发现 · ${run.baseline_id ? "有基线" : "无基线"} · ${String(run.id).slice(0, 8)}`; }

  function targets() {
    return (state.targets || []).map(value => typeof value === "string" ? value : value.origin || value.url || value.target || "").filter(Boolean);
  }

  function statusBadge(status) {
    const map = {
      completed: ["检查完成", "success"], complete: ["检查完成", "success"], success: ["检查完成", "success"],
      partial: ["部分完成", "warning"], running: ["检查中", "neutral"], pending: ["等待执行", "neutral"],
      failed: ["检查失败", "danger"], error: ["检查失败", "danger"], blocked: ["范围未获准", "warning"]
    };
    const [label, className] = map[status] || [string(status, "状态未记录"), "neutral"];
    return node("span", `status-pill ${className}`, label);
  }

  function severityBadge(severity) {
    const safe = Object.hasOwn(severityNames, severity) ? severity : "info";
    return node("span", `severity-badge ${safe}`, severityNames[safe]);
  }

  function reviewBadge(status) {
    const safe = Object.hasOwn(reviewNames, status) ? status : "pending";
    return node("span", `review-badge ${safe}`, reviewNames[safe]);
  }

  function empty(title, description, buttonLabel, callback) {
    const box = node("div", "empty-state");
    box.append(node("span", "empty-icon", "◇"), node("strong", "", title), node("p", "", description));
    if (buttonLabel && callback) box.append(action(buttonLabel, callback));
    return box;
  }

  function setConnection(ok, message) {
    connected = ok;
    const connection = $("#connection-status");
    connection.className = `connection ${ok ? "connected" : "error"}`;
    connection.replaceChildren(node("i"), document.createTextNode(message));
    $("#settings-connection").textContent = message;
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (token) headers.set("X-API-Key", token);
    if (options.body) headers.set("Content-Type", "application/json");
    let response;
    try {
      response = await fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store" });
    } catch (_) {
      setConnection(false, "服务未连接");
      throw new Error("无法连接巡安服务。请确认服务已启动，并通过服务地址打开此页面。");
    }
    if (!response.ok) {
      let details;
      try { details = await response.json(); } catch (_) { details = null; }
      const raw = details?.error?.message || details?.error || details?.detail || details?.message;
      const message = raw ? string(raw) : `服务返回错误（${response.status}）。`;
      if (response.status === 401 || response.status === 403) {
        if (response.status === 401) setConnection(false, "需要访问令牌");
        throw new Error(`${message} ${response.status === 401 ? "请到“接入与计划”填写正确的 API 访问令牌。" : "请核对访问权限和服务端授权目标配置。"}`);
      }
      throw new Error(message);
    }
    if (options.raw) return response;
    return response.json();
  }

  function go(page, updateHash = true, autoLoad = true) {
    if (!Object.hasOwn(pageNames, page)) page = "overview";
    $$(".page").forEach(section => {
      const active = section.id === `page-${page}`;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });
    $$(".nav-item").forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("#breadcrumb-current").textContent = pageNames[page];
    $("#main").focus({ preventScroll: true });
    if (updateHash) history.replaceState(null, "", `#${page}`);
    if (autoLoad && page === "findings" && !selectedRun && state.runs.length) loadRun(state.runs[0].id).catch(error => notify(error.message, true));
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function normalizedTarget(value) {
    try {
      const url = new URL(value.trim());
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
      url.search = ""; url.hash = "";
      url.hostname = url.hostname.replace(/\.$/, "");
      return url.href;
    } catch (_) { return ""; }
  }

  function updateBaselineOptions() {
    const baseline = $("#baseline-select");
    const previous = baseline.value;
    const mode = $("input[name=mode]:checked").value;
    const target = normalizedTarget($("#target-input").value);
    const matches = state.runs.filter(run => run.mode === mode &&
      (mode === "demo" || (target && normalizedTarget(run.target) === target)));
    baseline.replaceChildren(new Option(matches.length ? "首次检查，暂不对比" : "当前目标暂无可用基线", ""));
    for (const run of matches) baseline.add(new Option(runLabel(run), run.id));
    if (matches.some(run => run.id === previous)) baseline.value = previous;
    baseline.disabled = !matches.length;
  }

  function updateRunOptions() {
    updateBaselineOptions();
    const selector = $("#finding-run");
    const current = selectedRun?.id || selector.value;
    selector.replaceChildren(...state.runs.map(run => new Option(runLabel(run), run.id)));
    if (state.runs.some(run => run.id === current)) selector.value = current;
    if (!state.runs.length) selector.add(new Option("暂无巡检记录", ""));
    selector.disabled = !state.runs.length;
  }

  function skeleton() {
    const box = node("div", "skeleton", "");
    box.setAttribute("role", "status"); box.setAttribute("aria-label", "正在载入巡检证据");
    for (let i = 0; i < 4; i++) box.append(node("div", "skeleton-line"));
    return box;
  }

  function clearFilters() {
    for (const id of filterIds) $("#" + id).value = id.endsWith("filter") && !["url-filter"].includes(id) ? "all" : "";
    $("#finding-sort").value = "severity";
    renderSelectedRun();
  }

  function updateFindingFilters(run) {
    for (const [id, key, label] of [["rule-filter", "rule_id", "全部规则"], ["category-filter", "category", "全部分类"]]) {
      const control = $("#" + id), previous = control.value;
      const values = [...new Set((run.findings || []).map(f => f[key]).filter(Boolean))].sort();
      control.replaceChildren(new Option(label, "all"), ...values.map(value => new Option(key === "category" ? categoryNames[value] || value : value, value)));
      if (values.includes(previous)) control.value = previous;
    }
  }

  function renderMetrics() {
    const latest = state.runs[0];
    $("#metric-runs").replaceChildren(document.createTextNode(String(state.runs.length)), node("span", "", "次"));
    $("#metric-findings").textContent = latest ? number(latest.summary?.total) : "—";
    $("#metric-high").textContent = latest ? number(latest.summary?.high) : "—";
    $("#metric-schedules").replaceChildren(document.createTextNode(String(state.schedules.filter(item => item.enabled).length)), node("span", "", "个"));
    $("#metric-findings-caption").textContent = latest ? `最近检查于 ${date(latest.created_at)}` : "发起巡检后显示";
    $("#nav-finding-count").textContent = latest ? number(latest.summary?.total) : 0;
  }

  function renderLatest(run) {
    if (!run) {
      replace("#latest-run-content", empty("还没有巡检记录", "从内置样例开始，几步走完整个检查与复查过程。", "开始第一次巡检", () => go("new-run")));
      replace("#overview-findings", empty("发现会出现在这里", "完成一次巡检后，优先展示需要关注的证据。"));
      return;
    }
    const box = node("div");
    const meta = node("div", "run-meta");
    meta.append(statusBadge(run.status), node("span", "", date(run.created_at)), node("span", "", run.mode === "demo" ? "演示样例" : "授权目标"));
    box.append(node("h3", "run-target", targetLabel(run)), meta);
    const bars = node("div", "severity-bars");
    const max = Math.max(1, ...Object.keys(severityNames).map(key => number(run.summary?.[key])));
    for (const [key, label] of Object.entries(severityNames)) {
      const count = number(run.summary?.[key]);
      const row = node("div", "severity-row");
      const track = node("progress", `severity-meter ${key}`);
      track.max = max;
      track.value = count;
      track.setAttribute("aria-label", `${label} ${count} 条`);
      row.append(node("span", "", label), track, node("strong", "", count));
      bars.append(row);
    }
    box.append(bars);
    const bottom = node("div", "latest-bottom");
    bottom.append(node("span", "", run.coverage ? `检查 ${number(run.coverage.visited)} 个页面 · ${run.coverage.complete ? "本轮覆盖完整" : "存在未覆盖内容"}` : "点击查看页面覆盖与检查过程"), action("查看巡检详情 →", () => openRun(run.id), "text-button"));
    box.append(bottom);
    replace("#latest-run-content", box);
    if (Array.isArray(run.findings)) {
      const top = [...run.findings].sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)).slice(0, 5);
      replace("#overview-findings", findingsTable(top, run.id, true));
    }
  }

  function findingsTable(findings, runId, compact = false) {
    if (!findings.length) return empty("当前没有匹配的发现", "这表示本轮规则没有命中；请结合检查范围和抓取情况评估结果。");
    const wrap = node("div", "table-wrap");
    const table = node("table", "findings-grid");
    const head = node("thead");
    const headRow = node("tr");
    ["风险级别", "发现与来源", "检测规则", "确认状态", ""].forEach(label => headRow.append(node("th", "", label)));
    head.append(headRow);
    const body = node("tbody");
    for (const finding of findings) {
      const row = node("tr");
      const severity = node("td");
      severity.append(severityBadge(finding.severity));
      const title = node("td");
      title.append(action(string(finding.title, "未命名发现"), () => showFinding(runId, finding.id), "finding-title"), node("span", "cell-subline", string(finding.url)));
      const rule = node("td");
      rule.append(node("span", "", string(finding.rule_id)), node("span", "cell-subline", categoryNames[finding.category] || string(finding.category, "内容与配置检查")));
      const review = node("td");
      review.append(reviewBadge(finding.review_status));
      const link = node("td");
      link.append(action("查看证据 ↗", () => showFinding(runId, finding.id), "table-action"));
      row.append(severity, title, rule, review, link);
      [...row.children].forEach((cell, i) => { cell.dataset.label = ["风险级别", "发现与来源", "检测规则", "确认状态", ""][i]; });
      body.append(row);
    }
    table.append(head, body);
    table.setAttribute("aria-label", compact ? "最新巡检优先发现" : "本次巡检风险清单");
    wrap.append(table);
    return wrap;
  }

  function renderHistory() {
    const query = $("#history-search").value.trim().toLowerCase();
    const mode = $("#history-mode").value;
    const filtered = state.runs.filter(run => (mode === "all" || run.mode === mode) &&
      `${targetLabel(run)} ${date(run.created_at)} ${run.created_at} ${run.id}`.toLowerCase().includes(query));
    $("#history-count").textContent = `${filtered.length} / ${state.runs.length} 条记录`;
    const pages = Math.max(1, Math.ceil(filtered.length / 10));
    historyPage = Math.min(historyPage, pages);
    const previous = action("← 上一页", () => { historyPage--; renderHistory(); }); previous.disabled = historyPage === 1;
    const next = action("下一页 →", () => { historyPage++; renderHistory(); }); next.disabled = historyPage === pages;
    replace("#history-pagination", filtered.length > 10 ? [previous, node("span", "", `第 ${historyPage} / ${pages} 页 · 每页 10 条`), next] : []);
    if (state.runs.length && !filtered.length) return replace("#history-list", empty("没有找到匹配记录", "试试目标的一部分、日期或任务编号。搜索范围为最近 100 条记录。", "清除搜索", () => { $("#history-search").value = ""; $("#history-mode").value = "all"; renderHistory(); }));
    if (!state.runs.length) return replace("#history-list", empty("暂时没有检查记录", "完成第一次巡检后，可以在这里回看结果。", "发起巡检", () => go("new-run")));
    const wrap = node("div", "table-wrap");
    const table = node("table", "history-grid");
    table.setAttribute("aria-label", "巡检历史记录");
    const head = node("thead");
    const headRow = node("tr");
    ["巡检目标", "开始时间", "执行状态", "发现数量", "对比基线", ""].forEach(text => headRow.append(node("th", "", text)));
    head.append(headRow);
    const body = node("tbody");
    for (const run of filtered.slice((historyPage - 1) * 10, historyPage * 10)) {
      const row = node("tr");
      const target = node("td");
      target.append(action(targetLabel(run), () => openRun(run.id), "finding-title"), node("small", "cell-subline", run.id));
      const status = node("td"); status.append(statusBadge(run.status));
      const detail = node("td"); detail.append(action("查看结果 →", () => openRun(run.id), "table-action"));
      row.append(target, node("td", "", date(run.created_at)), status, node("td", "", `${number(run.summary?.total)} 条 · 高风险 ${number(run.summary?.high)}`), node("td", "", run.baseline_id ? "已选择" : "首次 / 未选择"), detail);
      [...row.children].forEach((cell, i) => { cell.dataset.label = ["巡检目标", "开始时间", "执行状态", "发现数量", "对比基线", ""][i]; });
      body.append(row);
    }
    table.append(head, body); wrap.append(table); replace("#history-list", wrap);
  }

  function renderComparison(run) {
    const parent = $("#comparison-panel");
    parent.replaceChildren();
    if (!run.baseline_id || !run.comparison) return;
    const box = node("div", "comparison-card");
    box.append(node("h2", "", "与基线相比，这次发生了什么？"));
    const grid = node("div", "comparison-grid");
    const names = { new: "新发现", persistent: "持续存在", not_observed: "本次未再发现（待确认）", uncertain: "覆盖不足，待复查" };
    for (const [key, label] of Object.entries(names)) {
      const item = node("div", `comparison-item ${key}`);
      item.append(node("strong", "", number(run.comparison.counts?.[key])), node("span", "", label));
      grid.append(item);
    }
    box.append(grid, node("p", "", "本次未再发现不直接等于已修复。请结合页面内容、抓取范围和人工确认记录判断。"));
    if (run.comparison.entries?.length) {
      const details = node("details", "detail-section");
      details.append(node("summary", "", `查看 ${run.comparison.entries.length} 条对比明细`));
      const list = node("ul", "timeline");
      for (const entry of run.comparison.entries) {
        const item = node("li");
        item.append(node("strong", "", names[entry.status] || string(entry.status)), node("span", "", string(entry.title)), node("small", "", string(entry.url)), node("small", "", string(entry.evidence, "")));
        list.append(item);
      }
      details.append(list); box.append(details);
    }
    parent.append(box);
  }

  function renderCoverage(run) {
    const panel = $("#coverage-panel");
    panel.hidden = !run;
    if (!run) return;
    const box = node("div");
    const coverage = run.coverage || {};
    const summary = node("div", "coverage-summary");
    summary.append(node("span", "", `已检查 ${number(coverage.visited)} 个页面`), node("span", "", `本轮上限 ${number(coverage.limit)} 页`), node("span", "", coverage.complete ? "本轮覆盖完整" : "覆盖不完整，结果需结合范围解读"));
    box.append(summary);
    if (coverage.scope_note) box.append(node("p", "body-copy", coverage.scope_note));
    if (coverage.errors?.length) {
      const errors = node("ul", "error-list");
      coverage.errors.forEach(error => errors.append(node("li", "", typeof error === "string" ? error : [error.url, error.message || error.error || error.reason].filter(Boolean).join(" · ") || string(error))));
      box.append(node("h3", "", "未能完整检查的内容"), errors);
    }
    if (run.timeline?.length) {
      const timeline = node("ol", "timeline");
      run.timeline.forEach(step => {
        const item = node("li");
        item.append(node("strong", "", string(step.step)), node("span", "", ({ completed: "已完成", complete: "已完成", ok: "已完成", done: "已完成", success: "已完成", partial: "部分完成", skipped: "已跳过", failed: "未完成", running: "执行中" })[step.status] || string(step.status, "")), node("small", "", string(step.detail, "")));
        timeline.append(item);
      });
      box.append(timeline);
    }
    if (run.documents?.length) {
      const details = node("details", "detail-section");
      details.append(node("summary", "", `查看 ${run.documents.length} 个页面的来源与内容指纹`));
      const list = node("ul", "timeline");
      run.documents.forEach(document => {
        const item = node("li");
        item.append(node("strong", "", string(document.url)), node("small", "", `状态 ${string(document.status)} · ${string(document.content_type)} · ${number(document.size)} 字节`), node("small", "", `内容指纹 ${string(document.source_hash)}`));
        list.append(item);
      });
      details.append(list); box.append(details);
    }
    if (run.content_changes?.length) {
      const changes = node("details", "detail-section");
      changes.append(node("summary", "", `${run.content_changes.length} 个资源的内容发生变化`));
      const list = node("ul", "timeline");
      for (const change of run.content_changes) {
        const item = node("li");
        item.append(node("strong", "", string(change.url)), node("small", "", string(change.interpretation)), node("small", "", `上次指纹 ${string(change.before_hash)}`), node("small", "", `本次指纹 ${string(change.after_hash)}`));
        list.append(item);
      }
      changes.append(list); box.append(changes);
    }
    replace("#coverage-content", box);
  }

  function renderSelectedRun() {
    const run = selectedRun;
    if (!run) {
      $("#finding-run-meta").replaceChildren();
      $("#comparison-panel").replaceChildren();
      $("#findings-count").textContent = "0 条发现";
      replace("#findings-table", empty("先选择一次巡检", "完成巡检后，这里会显示风险、证据与确认状态。", "发起巡检", () => go("new-run")));
      renderCoverage(null); return;
    }
    $("#finding-run").value = run.id;
    const meta = node("div", "run-summary-strip");
    const label = node("div");
    label.append(node("h3", "", targetLabel(run)), node("p", "", `${date(run.created_at)} · ${run.mode === "demo" ? "内置合成样例" : "已授权网站"} · ${run.id}`));
    meta.append(label, statusBadge(run.status));
    if (run.mode === "demo" && run.variant === "before") {
      meta.append(action("下一步：检查修复版 →", () => {
        $("input[name=mode][value=demo]").checked = true;
        $("#demo-variant").value = "after"; updateMode();
        $("#baseline-select").value = run.id;
        $("#authorized").checked = false;
        if (demoKeywords?.id === run.id) $("#custom-keywords").value = demoKeywords.values.join("\n");
        go("new-run");
        notify("已选择修复版和本次基线。请保持关键词一致，确认后开始复查。");
      }));
    }
    replace("#finding-run-meta", meta);
    updateFindingFilters(run);
    const severity = $("#severity-filter").value;
    const review = $("#review-filter").value;
    const rule = $("#rule-filter").value, category = $("#category-filter").value;
    const urlQuery = $("#url-filter").value.trim().toLowerCase(), query = $("#finding-search").value.trim().toLowerCase();
    const sort = $("#finding-sort").value;
    const findings = (run.findings || []).filter(item =>
      (severity === "all" || item.severity === severity) &&
      (review === "all" || (item.review_status || "pending") === review) &&
      (rule === "all" || item.rule_id === rule) && (category === "all" || item.category === category) &&
      String(item.url || "").toLowerCase().includes(urlQuery) &&
      `${item.title || ""} ${item.evidence || ""}`.toLowerCase().includes(query)
    ).sort((a, b) => sort === "severity" ? (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4) :
      ((Date.parse(a.observed_at) || 0) - (Date.parse(b.observed_at) || 0)) * (sort === "newest" ? -1 : 1));
    $("#findings-count").textContent = `${findings.length} / ${(run.findings || []).length} 条发现`;
    $("#filter-status").textContent = `显示 ${findings.length} 条，共 ${(run.findings || []).length} 条`;
    replace("#findings-table", !findings.length && run.findings?.length ? empty("没有符合筛选条件的发现", "试着减少筛选条件；已有巡检记录不会被删除。", "清除全部筛选", clearFilters) : findingsTable(findings, run.id));
    renderComparison(run); renderCoverage(run);
  }

  async function loadRun(id, fresh = false) {
    if (!id) return;
    const sequence = ++loadSequence;
    const run = !fresh && cache.has(id) ? cache.get(id) : await api(`/api/runs/${encodeURIComponent(id)}`);
    cache.set(id, run);
    if (sequence !== loadSequence) return;
    const changed = selectedRun?.id !== run.id;
    selectedRun = run;
    if (changed) clearFilters(); else renderSelectedRun();
    return run;
  }

  async function openRun(id) {
    go("findings", true, false);
    replace("#findings-table", skeleton());
    try { await loadRun(id); } catch (error) { notify(error.message, true); renderSelectedRun(); }
  }

  async function showFinding(runId, findingId) {
    const trigger = document.activeElement;
    try {
      const run = cache.get(runId) || await api(`/api/runs/${encodeURIComponent(runId)}`);
      cache.set(runId, run);
      const finding = (run.findings || []).find(item => item.id === findingId);
      if (!finding) return notify("未找到这条发现，请刷新巡检记录。", true);
      $("#dialog-title").textContent = string(finding.title, "风险详情");
      const content = node("div");
      const badges = node("div", "button-row");
      badges.append(severityBadge(finding.severity), reviewBadge(finding.review_status));
      content.append(badges);
      const grid = node("dl", "detail-grid");
      const fields = [["来源页面", finding.url], ["检测规则", finding.rule_id], ["检测工具", finding.tool], ["发现时间", date(finding.observed_at)], ["证据位置", finding.line ? `第 ${finding.line} 行` : "页面 / 响应元数据"], ["置信度（仍需人工确认）", finding.confidence]];
      for (const [label, value] of fields) {
        const item = node("div", "detail-item"); item.append(node("dt", "", label), node("dd", "", string(value))); grid.append(item);
      }
      content.append(grid);
      const evidence = node("section", "detail-section");
      const evidenceHeader = node("div", "section-actions");
      evidenceHeader.append(node("h3", "", "命中证据（已脱敏）"), action("复制证据", async event => {
        const button = event.currentTarget; button.disabled = true;
        try {
          await navigator.clipboard.writeText(string(finding.evidence, ""));
          button.textContent = "已复制 ✓";
        } catch (_) {
          button.textContent = "复制失败，请手动选取";
        } finally { button.disabled = false; }
      }));
      evidence.append(evidenceHeader, node("pre", "evidence-box", string(finding.evidence, "本条发现未提供文本证据，请核查原始记录。")));
      content.append(evidence);
      for (const [label, value] of [["可能带来的影响", finding.impact], ["建议如何处理", finding.remediation]]) {
        const section = node("section", "detail-section"); section.append(node("h3", "", label), node("p", "", string(value))); content.append(section);
      }
      const form = node("form", "review-form");
      const label = node("label", "", "人工确认意见"); label.htmlFor = "review-note";
      const note = node("textarea"); note.id = "review-note"; note.rows = 3; note.maxLength = 500; note.placeholder = "记录你确认或排除这条风险的依据（可选，最多 500 字）";
      note.value = finding.review_note || finding.note || "";
      const buttons = node("div", "button-row");
      for (const [status, text] of [["confirmed", "确认是问题"], ["false_positive", "标记为误报"], ["pending", "保留待确认"]]) {
        buttons.append(action(text, async () => {
          const allButtons = $$("button", form); allButtons.forEach(button => { button.disabled = true; });
          try {
            await api("/api/reviews", { method: "POST", body: JSON.stringify({ run_id: runId, finding_id: findingId, status, note: note.value.trim() }) });
            cache.delete(runId);
            if (selectedRun?.id === runId) await loadRun(runId, true);
            if (state.runs[0]?.id === runId) {
              const latest = cache.get(runId) || await api(`/api/runs/${encodeURIComponent(runId)}`); cache.set(runId, latest); renderLatest(latest);
            }
            $("#finding-dialog").close(); notify("确认记录已保存，报告中会保留这次判断。");
          } catch (error) { notify(error.message, true); } finally { allButtons.forEach(button => { button.disabled = false; }); }
        }, `button ${status === "confirmed" ? "primary" : "secondary"} small`));
      }
      form.addEventListener("submit", event => event.preventDefault());
      form.append(label, note, buttons, node("p", "review-note", "标记误报会保留原始发现与证据，方便后续审阅。"));
      content.append(form); replace("#dialog-content", content);
      presentDialog($("#finding-dialog"), trigger, $("#close-dialog"));
    } catch (error) { notify(error.message, true); }
  }

  function renderReports() {
    if (!state.runs.length) return replace("#report-list", empty("暂时没有可导出的报告", "完成巡检后，可以预览证据并选择需要的格式。", "发起巡检", () => go("new-run")));
    const rows = state.runs.map(run => {
      const row = node("div", "report-row");
      const description = node("div");
      description.append(node("h3", "", targetLabel(run)), node("p", "", `${date(run.created_at)} · ${number(run.summary?.total)} 条发现 · ${run.id}`));
      const buttons = node("div", "button-row");
      buttons.append(action("预览报告", () => previewReport(run.id), "button primary small"));
      for (const [format, label] of [["html", "网页报告 ↓"], ["markdown", "Markdown ↓"], ["csv", "CSV ↓"], ["json", "JSON ↓"]]) {
        buttons.append(action(label, event => downloadReport(run.id, format, event.currentTarget)));
      }
      row.append(description, buttons); return row;
    });
    replace("#report-list", rows);
  }

  async function downloadReport(id, format, button) {
    button.disabled = true;
    try {
      const response = await api(`/api/reports/${encodeURIComponent(id)}?format=${encodeURIComponent(format)}`, { raw: true });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = node("a");
      anchor.href = url;
      anchor.download = `巡安巡检报告_${id}.${format === "markdown" ? "md" : format}`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      notify("报告已下载，内容对应本次巡检的实际记录。");
    } catch (error) { notify(error.message, true); } finally { button.disabled = false; }
  }

  function renderSettings() {
    const list = targets();
    $("#platform-status").textContent = connected ? state.platform || "恒脑接入状态未提供" : "服务未连接，接入状态未知";
    $("#integration-status").textContent = connected ? state.platform || "待配置" : "连接服务后查看";
    $("#last-refreshed").textContent = lastRefresh ? `最近同步 ${date(lastRefresh)} · 可见时每 20 秒自动同步` : "尚未连接";
    replace("#service-info", [["服务版本", connected ? state.version || "未提供" : "—"], ["恒脑接入说明", connected ? state.platform || "未提供" : "—"], ["私网目标", connected ? state.allow_private ? "允许（仍受授权范围限制）" : "禁止" : "—"], ["授权目标 / 近期事件", connected ? `${list.length} 个 / ${state.events.length} 条` : "—"]].map(([label, value]) => {
      const item = node("div"); item.append(node("span", "field-help", label), node("strong", "", value)); return item;
    }));
    $("#target-options").replaceChildren(...list.map(target => new Option(target, target)));
    const oldTarget = $("#schedule-target").value;
    $("#schedule-target").replaceChildren(...(list.length ? list.map(target => new Option(target, target)) : [new Option("尚未配置授权目标", "")]));
    if (list.includes(oldTarget)) $("#schedule-target").value = oldTarget;
    $("#schedule-target").disabled = !list.length;
    $("#schedule-form button[type=submit]").disabled = !list.length;
    $("#target-help").textContent = list.length ? `已配置 ${list.length} 个目标。请从建议地址中选择，或输入该范围内的页面地址。` : "尚未配置授权目标。请先按仓库部署文档配置服务端允许列表，也可以先使用内置样例。";
    replace("#configured-targets", list.length ? [...list.map(target => node("div", "target-item", target)), node("p", "field-help", "授权列表限定可检查的范围。新增目标需由部署者按仓库说明配置。")] : empty("还没有配置网站", "可以先体验内置样例。真实网站需在服务端配置允许列表。"));
    const schedules = state.schedules || [];
    if (!schedules.length) replace("#schedule-list", empty("还没有定时计划", "先配置授权目标，再设置自动检查间隔。"));
    else replace("#schedule-list", schedules.map(schedule => {
      const row = node("div", "schedule-row");
      const info = node("div");
      info.append(node("strong", "", string(schedule.target)), node("p", "", `每 ${number(schedule.interval_minutes)} 分钟 · ${schedule.enabled ? "已启用" : "已停用"}${schedule.next_run_at ? ` · 下次 ${date(schedule.next_run_at)}` : ""}`));
      row.append(info);
      if (schedule.last_run_id) info.append(action("查看上次结果 →", () => openRun(schedule.last_run_id), "text-button"));
      row.append(action(schedule.enabled ? "停用计划" : "启用计划", async event => {
        const button = event.currentTarget; button.disabled = true;
        try { await api(`/api/schedules/${encodeURIComponent(schedule.id)}`, { method: "POST", body: JSON.stringify({ enabled: !schedule.enabled }) }); await refresh(false); notify(schedule.enabled ? "定时计划已停用。" : "定时计划已启用。"); }
        catch (error) { notify(error.message, true); button.disabled = false; }
      }));
      return row;
    }));
    const events = (state.events || []).slice(0, 15);
    replace("#event-list", events.length ? events.map(event => {
      const row = node("div", "event-row");
      row.append(node("time", "", date(event.created_at || event.time || event.timestamp)), node("span", "", string(event.message || event.detail || event.event || event.type || event)));
      return row;
    }) : node("p", "body-copy", "暂时没有事件。巡检和计划执行后，这里会显示实际记录。"));
  }

  async function refresh(showMessage = true, silent = false) {
    if (refreshTask) {
      if (silent) return refreshTask;
      try { await refreshTask; } catch (_) { /* Manual retry fetches again. */ }
    }
    const task = refreshData(showMessage, silent);
    refreshTask = task;
    try { return await task; } finally { if (refreshTask === task) refreshTask = null; }
  }

  async function refreshData(showMessage, silent) {
    refreshing = true;
    const button = $("#refresh-button"); button.disabled = true;
    try {
      const data = await api("/api/state");
      state = {
        version: data.version, platform: data.platform, allow_private: data.allow_private,
        runs: Array.isArray(data.runs) ? data.runs : [],
        targets: Array.isArray(data.targets) ? data.targets : [],
        schedules: Array.isArray(data.schedules) ? data.schedules : [],
        events: Array.isArray(data.events) ? data.events : []
      };
      state.runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      lastRefresh = new Date().toISOString();
      setConnection(true, "服务已连接");
      updateRunOptions(); renderMetrics();
      const focus = document.activeElement;
      if (!silent || !focus.closest("#history-list, #history-pagination")) renderHistory();
      if (!silent || !focus.closest("#report-list")) renderReports();
      if (!silent || !focus.closest("#schedule-list")) renderSettings();
      const latest = state.runs[0];
      renderLatest(latest);
      if (latest) {
        const full = await api(`/api/runs/${encodeURIComponent(latest.id)}`);
        cache.set(latest.id, full); renderLatest(full);
        if (!selectedRun) selectedRun = full;
        else if (selectedRun.id === full.id) selectedRun = full;
      }
      if (!silent) renderSelectedRun();
      if (showMessage) notify("数据已刷新。");
    } catch (error) {
      if (!connected || !state.runs.length) {
        setConnection(false, "服务未连接");
        replace("#latest-run-content", empty("暂时无法连接服务", "请确认服务已启动；远程访问请先填写 API 访问令牌。", "设置连接", () => go("settings")));
      }
      if (!silent) notify(error.message, true);
      throw error;
    } finally { button.disabled = false; refreshing = false; }
  }

  async function bootstrap() {
    try { token = sessionStorage.getItem(tokenKey) || ""; } catch (_) { token = ""; }
    if (!token) {
      try {
        const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
        if (response.ok) { const data = await response.json(); token = data.token || ""; }
      } catch (_) { /* Remote sessions can use the visible token form. */ }
    }
    try { await refresh(false); } catch (_) { /* The connection panel provides a recoverable path. */ }
  }

  function updateMode() {
    const mode = $("input[name=mode]:checked").value;
    $("#demo-fields").hidden = mode !== "demo";
    $("#url-fields").hidden = mode !== "url";
    $("#target-input").required = mode === "url";
    $("#target-input").disabled = mode !== "url";
    $("#max-pages").disabled = mode !== "url";
    updateBaselineOptions();
  }

  $$("[data-page]").forEach(button => button.addEventListener("click", () => go(button.dataset.page)));
  $$("[data-go]").forEach(button => button.addEventListener("click", () => go(button.dataset.go)));
  $(".brand").addEventListener("click", event => { event.preventDefault(); go("overview"); });
  $("#quick-demo").addEventListener("click", startDemo);
  $$("input[name=mode]").forEach(input => input.addEventListener("change", updateMode));
  $("#refresh-button").addEventListener("click", () => { refresh().catch(() => {}); });
  $("#finding-run").addEventListener("change", event => openRun(event.target.value));
  for (const id of [...filterIds, "finding-sort"]) $("#" + id).addEventListener(["url-filter", "finding-search"].includes(id) ? "input" : "change", renderSelectedRun);
  $("#clear-filters").addEventListener("click", clearFilters);
  $("#target-input").addEventListener("input", updateBaselineOptions);
  for (const id of ["history-search", "history-mode"]) $("#" + id).addEventListener(id === "history-search" ? "input" : "change", () => { historyPage = 1; renderHistory(); });
  $("#custom-keywords").addEventListener("input", event => event.target.setCustomValidity(""));
  $("#close-dialog").addEventListener("click", () => $("#finding-dialog").close());
  $("#finding-dialog").addEventListener("click", event => {
    const dialog = event.currentTarget;
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  window.addEventListener("hashchange", () => go(location.hash.slice(1), false));

  $("#run-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const keywordInput = $("#custom-keywords");
    const customKeywords = keywordInput.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    keywordInput.setCustomValidity(customKeywords.length > 30 || customKeywords.some(value => value.length > 80) ? "最多填写 30 个关键词，每个关键词不能超过 80 字。" : "");
    if (!form.reportValidity()) return;
    const mode = $("input[name=mode]:checked").value;
    const body = {
      mode, variant: $("#demo-variant").value,
      target: mode === "url" ? $("#target-input").value.trim() : "",
      authorized: $("#authorized").checked,
      custom_keywords: customKeywords,
      max_pages: mode === "url" ? Number($("#max-pages").value) || 12 : 12
    };
    const baselineId = $("#baseline-select").value;
    if (baselineId) body.baseline_id = baselineId;
    busy = true;
    const controls = $$("input, select, textarea", form).map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    form.setAttribute("aria-busy", "true");
    const started = Date.now();
    const elapsed = setInterval(() => {
      $("#run-progress").textContent = `已等待 ${Math.floor((Date.now() - started) / 1000)} 秒 · 服务正在处理，完成后自动显示结果。当前接口不提供逐页进度。`;
    }, 1000);
    $("#run-submit").disabled = true;
    $("#run-submit").textContent = "正在巡检…";
    $("#run-progress").textContent = "正在检查页面并整理证据，请保留页面。完成后会自动显示结果。";
    $("#run-progress").classList.add("loading-dot");
    try {
      const run = await api("/api/runs", { method: "POST", body: JSON.stringify(body) });
      cache.set(run.id, run); selectedRun = run;
      if (mode === "demo") demoKeywords = { id: run.id, values: customKeywords };
      try { await refresh(false); } catch (_) { notify("巡检已保存，但列表同步失败。稍后可手动刷新。", true); }
      clearFilters();
      $("#severity-filter").value = "all"; $("#review-filter").value = "all";
      renderSelectedRun(); go("findings");
      notify(`巡检记录已保存，共 ${number(run.summary?.total)} 条发现。请查看覆盖范围并确认结果。`);
      $("#run-progress").textContent = `上次巡检记录：${run.id}`;
    } catch (error) {
      $("#run-progress").textContent = error.message; notify(error.message, true);
    } finally {
      clearInterval(elapsed);
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
      form.removeAttribute("aria-busy"); updateMode();
      busy = false; $("#run-submit").disabled = false; $("#run-submit").textContent = "开始巡检 →"; $("#run-progress").classList.remove("loading-dot");
    }
  });

  $("#token-form").addEventListener("submit", async event => {
    event.preventDefault();
    const entered = $("#api-token").value.trim();
    if (!entered) return notify("请填写部署者提供的 API 访问令牌。", true);
    token = entered;
    try {
      await refresh(false);
      try { sessionStorage.setItem(tokenKey, token); } catch (_) { notify("浏览器未允许保存会话，刷新后需要重新填写令牌。"); }
      $("#api-token").value = "";
      notify("服务连接成功。");
    } catch (_) { /* Existing error notification explains recovery. */ }
  });

  $("#clear-token").addEventListener("click", async () => {
    token = ""; try { sessionStorage.removeItem(tokenKey); } catch (_) { /* Nothing persisted. */ }
    $("#api-token").value = "";
    await bootstrap();
    if (connected) notify("手动令牌已清除，已切换到本机会话。");
  });

  $("#schedule-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const keywords = $("#schedule-keywords").value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    $("#schedule-keywords").setCustomValidity(keywords.length > 30 || keywords.some(word => word.length > 80) ? "最多 30 个关键词，每个不超过 80 字。" : "");
    if (!form.reportValidity()) return;
    const button = $("button[type=submit]", form); button.disabled = true;
    try {
      await api("/api/schedules", { method: "POST", body: JSON.stringify({ target: $("#schedule-target").value, interval_minutes: Number($("#schedule-interval").value), authorized: $("#schedule-authorized").checked, custom_keywords: keywords, enabled: true }) });
      await refresh(false); $("#schedule-authorized").checked = false; notify("定时计划已创建。请保持服务运行。");
    } catch (error) { notify(error.message, true); } finally { button.disabled = !targets().length; }
  });

  function presentDialog(dialog, trigger, closeButton) {
    dialog.returnFocus = trigger;
    if (!dialog.open) dialog.showModal();
    closeButton.focus();
  }

  for (const dialog of $$("dialog")) {
    dialog.addEventListener("close", () => {
      if (dialog.id === "report-dialog") previewSequence++;
      const trigger = dialog.returnFocus;
      if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus();
      else $("#main").focus({ preventScroll: true });
    });
    dialog.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const items = $$("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href]", dialog).filter(item => item.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }

  function startDemo() {
    $("input[name=mode][value=demo]").checked = true;
    $("#demo-variant").value = "before"; $("#baseline-select").value = "";
    $("#authorized").checked = false;
    updateMode(); go("new-run");
  }

  function dismissGuide() {
    try { localStorage.setItem("xunan-guide-seen", "1"); } catch (_) { /* Optional preference. */ }
    $("#guide-dialog").close();
  }
  $("#show-guide").addEventListener("click", () => presentDialog($("#guide-dialog"), document.activeElement, $("#close-guide")));
  $("#guide-start").addEventListener("click", () => { dismissGuide(); startDemo(); });
  $("#close-guide").addEventListener("click", dismissGuide);
  $("#guide-skip").addEventListener("click", dismissGuide);
  $("#guide-dialog").addEventListener("cancel", dismissGuide);
  $("#close-report").addEventListener("click", () => $("#report-dialog").close());

  async function previewReport(id) {
    const sequence = ++previewSequence;
    presentDialog($("#report-dialog"), document.activeElement, $("#close-report"));
    replace("#report-preview-content", skeleton());
    try {
      const run = await api(`/api/reports/${encodeURIComponent(id)}?format=json`);
      if (sequence !== previewSequence || !$("#report-dialog").open) return;
      const box = node("div", "report-preview");
      box.append(node("h3", "", targetLabel(run)), node("p", "body-copy", runLabel(run)));
      box.append(node("p", "report-summary", `共 ${number(run.summary?.total)} 条发现，检查 ${number(run.coverage?.visited)} 个资源。${run.coverage?.complete ? "本轮覆盖完整。" : "本轮覆盖不足，请核查过程记录。"}`));
      box.append(node("p", "field-help", (run.limitations || []).join("；")));
      const names = { new: "新发现", persistent: "持续存在", not_observed: "本次未再发现（待确认）", uncertain: "覆盖不足，待复查" };
      const comparison = node("section", "detail-section");
      comparison.append(node("h3", "", "基线对比"), node("p", "", run.baseline_id ? "未再发现不等于已修复，请结合覆盖情况与人工复核。" : "首轮检查，尚无复测结论。"));
      for (const [key, title] of Object.entries(names)) {
        const details = node("details", "detail-section");
        const entries = (run.comparison?.entries || []).filter(entry => entry.status === key);
        details.append(node("summary", "", `${title} · ${number(run.comparison?.counts?.[key])} 条`));
        for (const entry of entries) details.append(node("p", "body-copy", `${string(entry.title)} · ${string(entry.url)}`));
        comparison.append(details);
      }
      box.append(comparison);
      for (const finding of run.findings || []) {
        const item = node("details", "detail-section");
        item.append(node("summary", "", `${severityNames[finding.severity] || "提示"} · ${finding.title}`), node("p", "body-copy", finding.url), node("pre", "evidence-box", finding.evidence), node("p", "", `处理建议：${string(finding.remediation)}`), node("p", "", `复核：${reviewNames[finding.review_status] || "待确认"} · ${finding.review_note || "暂无备注"}`));
        box.append(item);
      }
      const json = node("details", "detail-section");
      json.append(node("summary", "", "查看完整 JSON 数据"), node("pre", "evidence-box", JSON.stringify(run, null, 2)));
      box.append(json);
      const buttons = node("div", "button-row");
      buttons.append(action("下载网页报告", event => downloadReport(id, "html", event.currentTarget)), action("下载 JSON", event => downloadReport(id, "json", event.currentTarget)));
      box.append(buttons); replace("#report-preview-content", box);
    } catch (error) {
      if (sequence === previewSequence) replace("#report-preview-content", empty("报告暂时无法加载", error.message, "重试", () => previewReport(id)));
    }
  }

  function autoRefresh() {
    if (document.hidden || busy || refreshing || $("dialog[open]")) return;
    refresh(false, true).catch(() => {});
  }
  setInterval(autoRefresh, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) autoRefresh(); });
  window.addEventListener("beforeunload", event => { if (busy) { event.preventDefault(); event.returnValue = ""; } });
  $$(".nav-item").forEach(button => { button.setAttribute("aria-label", pageNames[button.dataset.page]); button.title = pageNames[button.dataset.page]; });
  $("#schedule-keywords").addEventListener("input", event => event.target.setCustomValidity(""));

  updateMode(); renderMetrics(); renderLatest(null); renderHistory(); renderSelectedRun(); renderReports(); renderSettings();
  go(location.hash.slice(1) || "overview", false);
  bootstrap().then(() => {
    try { if (!localStorage.getItem("xunan-guide-seen") && !state.runs.length) presentDialog($("#guide-dialog"), $("#show-guide"), $("#close-guide")); } catch (_) { /* Guide remains available from overview. */ }
  });
})();
