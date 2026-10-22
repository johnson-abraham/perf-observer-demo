(() => {
  const observedTypes = ["long-animation-frame", "longtask"];
  const loafFields = [
    "startTime", "duration", "name", "entryType", "renderStart",
    "styleAndLayoutStart", "blockingDuration", "firstUIEventTimestamp",
    "paintTime", "presentationTime"
  ];
  const scriptFields = [
    "startTime", "duration", "name", "entryType", "executionStart",
    "forcedStyleAndLayoutDuration", "invoker", "invokerType", "pauseDuration",
    "sourceCharPosition", "sourceFunctionName", "sourceURL", "windowAttribution",
    "window"
  ];
  const attributionFields = ["containerType", "containerSrc", "containerId", "containerName"];
  const entries = [];
  const support = new Map();
  let observer = null;
  let observing = false;
  let nextEntryId = 1;

  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const ms = value => Number.isFinite(value) ? `${value.toFixed(2)} ms` : "—";

  function percentage(value, duration) {
    if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return 0;
    return Math.min(100, Math.max(0, value / duration * 100));
  }

  function timelineLane(label, detail, startOffset, laneDuration, frameDuration, variant, title, barLabel = "", submarkers = []) {
    const left = percentage(startOffset, frameDuration);
    const width = Math.min(100 - left, percentage(laneDuration, frameDuration));
    const safeTitle = escapeHtml(title || `${label}: ${ms(laneDuration)}`);
    const markerHtml = submarkers.filter(offset => Number.isFinite(offset) && offset >= 0 && offset <= frameDuration)
      .map(offset => `<i class="trace-exec-marker" style="left:${percentage(offset, frameDuration)}%" title="Execution starts · ${ms(offset)}"></i>`).join("");
    const bar = laneDuration > 0
      ? `<span class="trace-bar ${variant}" style="left:${left}%;width:${width}%" title="${safeTitle}">${barLabel ? `<span class="trace-bar-label">${escapeHtml(barLabel)}</span>` : ""}</span>${markerHtml}`
      : "";
    return `<div class="trace-lane">
      <div class="trace-label"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></div>
      <div class="trace-track">${bar}</div>
    </div>`;
  }

  function timelineMarker(label, timestamp, entryStart, frameDuration, variant) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
    const offset = timestamp - entryStart;
    if (offset < 0 || offset > frameDuration) return "";
    return { label, offset, variant };
  }

  function renderFrameTimeline(entry) {
    const duration = Number(entry.duration);
    const start = Number(entry.startTime);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(start)) {
      return '<p class="trace-empty">Timeline unavailable for this entry.</p>';
    }

    const scripts = Array.from(entry.scripts || []);
    const lanes = [timelineLane("Frame", "total duration", 0, duration, duration, "frame", `Frame duration ${ms(duration)}`, `Long animation frame · ${ms(duration)}`)];
    let executionMarkerCount = 0;

    scripts.forEach((script, index) => {
      const scriptStart = Number(script.startTime);
      const scriptDuration = Number(script.duration);
      const offset = scriptStart - start;
      const fn = script.sourceFunctionName || script.invoker || script.name || `Script ${index + 1}`;
      const source = script.sourceURL ? String(script.sourceURL).split("/").pop() : "script";
      const detail = `${ms(scriptDuration)} · ${source}`;
      const executionStart = Number(script.executionStart);
      const executionOffset = executionStart - start;
      const executionMarkers = Number.isFinite(executionStart) && executionOffset >= offset && executionOffset <= offset + scriptDuration
        ? [executionOffset]
        : [];
      executionMarkerCount += executionMarkers.length;
      lanes.push(timelineLane(fn, detail, offset, scriptDuration, duration, "script", `${fn} — ${script.sourceURL || "source unavailable"} — ${ms(scriptDuration)}`, fn, executionMarkers));
    });

    const renderStart = Number(entry.renderStart);
    const layoutStart = Number(entry.styleAndLayoutStart);
    const paintTime = Number(entry.paintTime);
    if (Number.isFinite(renderStart) && renderStart > 0 && Number.isFinite(paintTime) && paintTime >= renderStart) {
      lanes.push(timelineLane("Render", "renderStart → paintTime", renderStart - start, paintTime - renderStart, duration, "render", `Rendering phase ${ms(paintTime - renderStart)}`));
    }

    const milestones = [
      timelineMarker("User Input", Number(entry.firstUIEventTimestamp), start, duration, "user-input"),
      timelineMarker("Render start", renderStart, start, duration, "render"),
      timelineMarker("Style / layout start", layoutStart, start, duration, "layout"),
      timelineMarker("Paint", paintTime, start, duration, "paint"),
      timelineMarker("Presented", Number(entry.presentationTime), start, duration, "presented")
    ].filter(Boolean);
    const markers = milestones.map(({ label, offset, variant }) =>
      `<span class="trace-marker ${variant}" style="left:${percentage(offset, duration)}%" title="${escapeHtml(`${label} · ${ms(offset)}`)}"><i></i></span>`
    ).join("");
    const milestoneLegend = milestones.map(({ label, offset, variant }) =>
      `<span class="trace-legend-item ${variant}"><i></i>${escapeHtml(label)} <b>${ms(offset)}</b></span>`
    ).join("");
    const scriptDetails = scripts.map((script, index) => {
      const fn = script.sourceFunctionName || script.invoker || `Script ${index + 1}`;
      const scriptStart = Number(script.startTime);
      const executionStart = Number(script.executionStart);
      const sourcePosition = script.sourceCharPosition;
      const formatDurationField = value => Number.isFinite(value) ? ms(value) : value;
      const fields = [
        ["Entry type", script.entryType],
        ["Script name", script.name],
        ["Start offset", Number.isFinite(scriptStart) ? ms(scriptStart - start) : "—"],
        ["Execution start", Number.isFinite(executionStart) ? ms(executionStart - start) : "—"],
        ["Invoker", script.invoker],
        ["Invoker type", script.invokerType],
        ["Source URL", script.sourceURL],
        ["Source character", sourcePosition],
        ["Forced style/layout", formatDurationField(script.forcedStyleAndLayoutDuration)],
        ["Pause duration", formatDurationField(script.pauseDuration)],
        ["Window attribution", script.windowAttribution]
      ].filter(([, value]) => value !== undefined && value !== null && value !== "");
      return `<details class="script-detail"><summary>${escapeHtml(fn)} · ${ms(Number(script.duration))}</summary><dl>${fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></details>`;
    }).join("");
    const scriptNote = scripts.length
      ? `${scripts.length} script${scripts.length === 1 ? "" : "s"} reported`
      : "No script records reported for this frame";

    return `<section class="trace" aria-label="Long animation frame timeline">
      <div class="trace-heading"><div><strong>Frame timeline</strong><span>${escapeHtml(scriptNote)}</span></div><div class="trace-stats"><span>Start <b>${ms(start)}</b></span><span>Blocking <b>${ms(Number(entry.blockingDuration))}</b></span></div></div>
      <div class="trace-chart">
        <div class="trace-ruler"><span>0 ms</span><span>${ms(duration * .25)}</span><span>${ms(duration * .5)}</span><span>${ms(duration * .75)}</span><span>${ms(duration)}</span></div>
        ${lanes.join("")}
        <div class="trace-marker-row" aria-label="Frame milestones">${markers}</div>
      </div>
      <div class="trace-legend">${milestoneLegend || '<span class="trace-caption">No frame milestones were reported.</span>'}${executionMarkerCount ? '<span class="trace-legend-item execution"><i></i>Script execution start</span>' : ""}</div>
      ${scriptDetails ? `<section class="script-details"><h3>Script details</h3>${scriptDetails}</section>` : ""}
      <p class="trace-caption">Milestone times are offsets within the frame. Script timing, invoker, source, pause, and forced layout data come from the browser entry.</p>
    </section>`;
  }

  function readFields(source, fields) {
    const result = {};
    for (const field of fields) {
      try {
        const value = source[field];
        if (value !== undefined) result[field] = value;
      } catch (error) {
        result[field] = `[unavailable: ${error.message}]`;
      }
    }
    return result;
  }

  function callToJSON(value) {
    try {
      return typeof value.toJSON === "function" ? value.toJSON() : undefined;
    } catch (error) {
      return { serializationError: error.message };
    }
  }

  function stringifySnapshot(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, item) => {
      if (item === window) return { type: "Window", isCurrentWindow: true };
      if (item && typeof item === "object") {
        if (Object.prototype.toString.call(item) === "[object Window]") {
          return { type: "Window", isCurrentWindow: item === window };
        }
        if (seen.has(item)) return "[Circular reference]";
        seen.add(item);
      }
      if (typeof item === "bigint") return item.toString();
      return item;
    }, 2);
  }

  function snapshotFor(entry) {
    const snapshot = callToJSON(entry) || {};
    if (entry.entryType === "long-animation-frame") {
      Object.assign(snapshot, readFields(entry, loafFields));
      snapshot.scripts = Array.from(entry.scripts || [], script => ({
        ...readFields(script, scriptFields),
        serialized: callToJSON(script)
      }));
    } else if (entry.entryType === "longtask") {
      Object.assign(snapshot, readFields(entry, ["startTime", "duration", "name", "entryType"]));
      snapshot.attribution = Array.from(entry.attribution || [], item => ({
        ...readFields(item, attributionFields),
        serialized: callToJSON(item)
      }));
    }
    return snapshot;
  }

  function supportStatus(type, supported) {
    support.set(type, supported);
    const element = document.getElementById(type === "long-animation-frame" ? "loaf-support" : "longtask-support");
    element.className = `support-indicator ${supported ? "yes" : "no"}`;
    element.innerHTML = `<i class="mini-dot"></i>${supported ? "Supported" : "Unavailable"}`;
  }

  function addEntries(list) {
    console.log(list);
    for (const entry of list) {
      entries.unshift({ id: nextEntryId++, entry, snapshot: snapshotFor(entry) });
    }
    if (entries.length > 250) entries.length = 250;
    renderEntries();
  }

  function renderEntries() {
    const table = document.getElementById("entries-table");
    const empty = document.getElementById("empty-state");
    const body = document.getElementById("entries-body");
    const count = document.getElementById("total-count");
    const openInspectors = new Set(Array.from(body.querySelectorAll("details[open]"), details => details.dataset.entryId));
    count.textContent = entries.length;
    empty.hidden = entries.length > 0;
    table.hidden = entries.length === 0;
    body.innerHTML = entries.slice(0, 100).map(({ id, entry, snapshot }) => {
      const type = escapeHtml(entry.entryType);
      const blocking = entry.entryType === "long-animation-frame" ? ms(entry.blockingDuration) : "—";
      const json = escapeHtml(stringifySnapshot(snapshot));
      const inspectControl = entry.entryType === "long-animation-frame"
        ? `<button class="inspect-trigger" type="button" data-open-frame="${id}">Open timeline</button>`
        : `<details class="inspect" data-entry-id="${id}"${openInspectors.has(String(id)) ? " open" : ""}><summary>All fields</summary><pre>${json}</pre></details>`;
      return `<tr>
        <td><span class="type-pill">${type}</span></td>
        <td class="numeric">${ms(entry.startTime)}</td>
        <td class="numeric"><span class="entry-number">${ms(entry.duration)}</span></td>
        <td class="numeric">${blocking}</td>
        <td>${inspectControl}</td>
      </tr>`;
    }).join("");
  }

  document.getElementById("entries-body").addEventListener("click", event => {
    const trigger = event.target.closest("[data-open-frame]");
    if (!trigger) return;

    const item = entries.find(({ id }) => id === Number(trigger.dataset.openFrame));
    if (!item) return;

    document.getElementById("timeline-dialog-title").textContent = "Long animation frame";
    document.getElementById("timeline-dialog-meta").textContent = `Start ${ms(item.entry.startTime)} · Duration ${ms(item.entry.duration)} · Blocking ${ms(item.entry.blockingDuration)}`;
    document.getElementById("timeline-dialog-content").innerHTML = `${renderFrameTimeline(item.entry)}<h3 class="snapshot-title">Entry fields</h3><pre>${escapeHtml(stringifySnapshot(item.snapshot))}</pre>`;
    document.getElementById("timeline-dialog").showModal();
  });

  document.getElementById("timeline-dialog").addEventListener("click", event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.getElementById("timeline-dialog-close").addEventListener("click", () => {
    document.getElementById("timeline-dialog").close();
  });

  function updateObserverState() {
    const button = document.getElementById("pause-button");
    const label = document.getElementById("state-label");
    button.innerHTML = observing
      ? '<svg viewBox="0 0 24 24" fill="none"><path d="M9 5v14M15 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Pause</span>'
      : '<svg viewBox="0 0 24 24" fill="none"><path d="m8 5 11 7-11 7V5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Resume</span>';
    button.setAttribute("aria-label", observing ? "Pause observer" : "Resume observer");
    label.innerHTML = `<span class="mini-dot"></span>${observing ? "Listening" : "Paused"}`;
    label.classList.toggle("paused", !observing);
    document.getElementById("connection-label").textContent = observing ? "Observer listening" : "Observer paused";
  }

  function setUnsupportedMessage() {
    if (observedTypes.some(type => support.get(type))) return;
    document.getElementById("empty-title").textContent = "These entry types are unavailable here";
    document.getElementById("empty-copy").textContent = "Try a browser that exposes long-animation-frame or longtask in supportedEntryTypes.";
  }

  function startObserver(includeBuffered = true) {
    if (!("PerformanceObserver" in window)) {
      observedTypes.forEach(type => supportStatus(type, false));
      document.getElementById("connection-label").textContent = "PerformanceObserver unavailable";
      document.getElementById("state-label").innerHTML = '<span class="mini-dot"></span>Unavailable';
      document.getElementById("state-label").classList.add("paused");
      setUnsupportedMessage();
      return;
    }

    const supportedTypes = new Set(PerformanceObserver.supportedEntryTypes || []);
    observedTypes.forEach(type => supportStatus(type, supportedTypes.has(type)));
    observer = new PerformanceObserver(list => addEntries(list.getEntries()));

    for (const type of observedTypes) {
      if (!support.get(type)) continue;
      try {
        const options = { type };
        if (includeBuffered) options.buffered = true;
        observer.observe(options);
      } catch (error) {
        supportStatus(type, false);
      }
    }

    observing = observedTypes.some(type => support.get(type));
    updateObserverState();
    setUnsupportedMessage();
  }

  function blockMainThread(duration) {
    const endAt = performance.now() + duration;
    while (performance.now() < endAt) { /* Deliberately block to generate an entry. */ }
  }

  document.getElementById("pause-button").addEventListener("click", () => {
    if (observing) {
      observer?.disconnect();
      observing = false;
      updateObserverState();
    } else {
      // Resume without replaying entries already present in the log.
      startObserver(false);
    }
  });

  document.getElementById("clear-button").addEventListener("click", () => {
    entries.length = 0;
    document.getElementById("empty-title").textContent = "Waiting for long frames and tasks";
    document.getElementById("empty-copy").textContent = "Run a stimulus or interact with the page to generate entries.";
    renderEntries();
    setUnsupportedMessage();
  });

  document.getElementById("long-task-button").addEventListener("click", () => blockMainThread(180));
  document.getElementById("raf-task-button").addEventListener("click", () => {
    requestAnimationFrame(() => blockMainThread(120));
  });

  const multiScriptButton = document.getElementById("multi-script-button");
  function validatePhase() { blockMainThread(30); }
  function calculatePhase() { blockMainThread(30); }
  function finalizePhase() { blockMainThread(30); }
  multiScriptButton.addEventListener("click", validatePhase);
  multiScriptButton.addEventListener("click", calculatePhase);
  multiScriptButton.addEventListener("click", finalizePhase);

  startObserver();
})();
