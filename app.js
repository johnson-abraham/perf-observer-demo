(() => {
  const requestedTypes = [
    "navigation", "paint", "resource", "mark", "measure", "longtask",
    "layout-shift", "largest-contentful-paint", "first-input", "event",
    "element", "long-animation-frame", "visibility-state"
  ];
  const entries = [];
  const counts = new Map();
  const filters = new Map();
  const support = new Map();
  const filtersEl = document.getElementById("filters");
  const bodyEl = document.getElementById("entries-body");
  const tableEl = document.getElementById("entries-table");
  const emptyEl = document.getElementById("empty-state");
  let observer = null;
  let observing = false;

  const prettyType = type => type === "paint" ? "paint" : type;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const number = value => Number.isFinite(value) ? `${value.toFixed(2)} ms` : "—";
  const detailFor = entry => {
    if (entry.entryType === "layout-shift") return `value ${Number(entry.value || 0).toFixed(4)}${entry.hadRecentInput ? " · recent input" : ""}`;
    if (entry.entryType === "event" || entry.entryType === "first-input") return `interaction: ${entry.name || "event"}${entry.processingStart ? ` · processing ${number(entry.processingStart - entry.startTime)}` : ""}`;
    if (entry.entryType === "resource") return entry.initiatorType ? `initiated by ${entry.initiatorType}` : "resource timing";
    if (entry.entryType === "largest-contentful-paint" || entry.entryType === "element") return entry.element ? `${entry.element.tagName.toLowerCase()}${entry.element.id ? `#${entry.element.id}` : ""}` : "paint candidate";
    if (entry.entryType === "navigation") return entry.name === location.href ? "document navigation" : entry.name;
    if (entry.entryType === "longtask") return `attribution: ${entry.attribution?.[0]?.name || "unknown"}`;
    return "";
  };
  const nameFor = entry => entry.name || (entry.entryType === "event" ? "interaction" : entry.entryType);

  function renderFilters() {
    filtersEl.innerHTML = '<span class="filter-label">Show</span>';
    requestedTypes.filter(type => support.get(type)).forEach(type => {
      const label = document.createElement("label");
      label.className = "filter";
      label.innerHTML = `<input type="checkbox" checked data-filter="${escapeHtml(type)}"><span>${escapeHtml(prettyType(type))}</span><span class="count" data-count="${escapeHtml(type)}">0</span>`;
      filtersEl.appendChild(label);
      filters.set(type, true);
    });
    filtersEl.addEventListener("change", event => {
      const input = event.target.closest("input[data-filter]");
      if (!input) return;
      filters.set(input.dataset.filter, input.checked);
      renderEntries();
    });
  }

  function renderSupport() {
    const supportEl = document.getElementById("support-list");
    supportEl.innerHTML = requestedTypes.map(type => {
      const yes = support.get(type);
      return `<div class="support-row"><span class="support-label"><code>${escapeHtml(type)}</code></span><span class="support-indicator ${yes ? "yes" : ""}"><i class="mini-dot"></i>${yes ? "Supported" : "Unavailable"}</span></div>`;
    }).join("");
  }

  function addEntries(list) {
    for (const entry of list) {
      entries.unshift(entry);
      counts.set(entry.entryType, (counts.get(entry.entryType) || 0) + 1);
    }
    if (entries.length > 250) entries.length = 250;
    renderEntries();
  }

  function renderEntries() {
    document.getElementById("total-count").textContent = entries.length;
    requestedTypes.forEach(type => {
      const countEl = filtersEl.querySelector(`[data-count="${CSS.escape(type)}"]`);
      if (countEl) countEl.textContent = counts.get(type) || 0;
    });
    const visible = entries.filter(entry => filters.get(entry.entryType) !== false);
    emptyEl.hidden = visible.length > 0;
    tableEl.hidden = visible.length === 0;
    bodyEl.innerHTML = visible.slice(0, 100).map(entry => {
      const type = escapeHtml(entry.entryType);
      const detail = detailFor(entry);
      return `<tr><td><span class="type-pill ${type}">${type}</span></td><td><div class="entry-name" title="${escapeHtml(nameFor(entry))}">${escapeHtml(nameFor(entry))}</div>${detail ? `<div class="entry-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</div>` : ""}</td><td class="numeric">${number(entry.startTime)}</td><td class="numeric">${number(entry.duration)}</td></tr>`;
    }).join("");
  }

  function startObservers(includeBuffered = true) {
    if (!("PerformanceObserver" in window)) {
      requestedTypes.forEach(type => support.set(type, false));
      renderSupport();
      document.getElementById("connection-label").textContent = "Not supported";
      document.getElementById("state-label").innerHTML = '<span class="mini-dot"></span>Unavailable';
      document.getElementById("state-label").classList.add("paused");
      return;
    }
    const supported = new Set(PerformanceObserver.supportedEntryTypes || []);
    requestedTypes.forEach(type => support.set(type, supported.has(type)));
    observer = new PerformanceObserver(list => addEntries(list.getEntries()));
    requestedTypes.filter(type => support.get(type)).forEach(type => {
      try {
        const options = { type };
        if (includeBuffered) options.buffered = true;
        if (type === "event") options.durationThreshold = 16;
        observer.observe(options);
      } catch (error) {
        support.set(type, false);
      }
    });
    renderSupport();
    if (includeBuffered) renderFilters();
    observing = requestedTypes.some(type => support.get(type));
    updateObserverState();
  }

  function updateObserverState() {
    const button = document.getElementById("pause-button");
    const label = document.getElementById("state-label");
    button.innerHTML = observing
      ? '<svg viewBox="0 0 24 24" fill="none"><path d="M9 5v14M15 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Pause</span>'
      : '<svg viewBox="0 0 24 24" fill="none"><path d="m8 5 11 7-11 7V5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Resume</span>';
    button.setAttribute("aria-label", observing ? "Pause observer" : "Resume observer");
    label.innerHTML = `<span class="mini-dot"></span>${observing ? "Listening" : "Paused"}`;
    label.classList.toggle("paused", !observing);
    document.getElementById("connection-label").textContent = observing ? "Observer ready" : "Observer paused";
  }

  document.getElementById("pause-button").addEventListener("click", () => {
      if (observing) observer?.disconnect();
    else {
      // Reconnect without replaying entries already shown in the log.
      startObservers(false);
      return;
    }
    observing = !observing;
    updateObserverState();
  });

  document.getElementById("clear-button").addEventListener("click", () => {
    entries.length = 0;
    counts.clear();
    renderEntries();
  });

  document.getElementById("long-task-button").addEventListener("click", () => {
    const endAt = performance.now() + 180;
    while (performance.now() < endAt) { /* intentionally occupy the main thread */ }
  });

  document.getElementById("shift-button").addEventListener("click", event => {
    const block = document.getElementById("shift-block");
    block.classList.toggle("bump");
    event.currentTarget.textContent = block.classList.contains("bump") ? "Reset" : "Shift";
  });

  document.getElementById("measure-button").addEventListener("click", () => {
    const start = `demo-operation-${Date.now()}-start`;
    const end = start.replace("-start", "-end");
    performance.mark(start);
    const until = performance.now() + 45;
    while (performance.now() < until) { /* small, measurable operation */ }
    performance.mark(end);
    performance.measure("demo-operation", start, end);
    performance.clearMarks(start);
    performance.clearMarks(end);
  });

  document.getElementById("resource-button").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = "Loading…";
    try {
      const url = new URL(location.href);
      url.searchParams.set("perf-resource", String(Date.now()));
      const response = await fetch(url, { cache: "no-store" });
      await response.text();
    } catch (error) {
      // Opening this file directly can block fetch; use a local web server for this stimulus.
      button.title = "Fetch is unavailable from file://. Serve this page from localhost to record a resource timing entry.";
    } finally {
      button.textContent = oldText;
      button.disabled = false;
    }
  });

  startObservers();
})();
