"use strict";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const PAGE_SIZE = 20;

let data;
let qaQuestionMap;
let qaResultMap;
let qaModelMap;
let qaSliceMap;
let indexRecordMap;
let crystalModelMap;
let currentSummaryRows = [];
let currentDetailRows = [];

const state = {
  experiment: "qa",
  qa: {
    mode: "compare",
    benchmarkFocus: "chembench_lamalab",
    modelFocus: "chemdfm_v2",
    modelGrouping: "chemistry",
    compareGrouping: "benchmark",
    domainScope: "selected",
    models: new Set(),
    slices: new Set(),
    task: "all",
    field: "all",
    metric: "protocol_correct",
    chart: "heatmap",
    sort: "fixed",
  },
  index: { models: new Set(), conditions: new Set(), metric: "exact_set_correct" },
  crystal: { models: new Set(), conditions: new Set(), path: "strict", metric: "task_success", unit: "candidate" },
  detail: null,
  detailSearch: "",
  detailStatus: "all",
  detailPattern: "all",
  expanded: null,
  page: 1,
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function svgNode(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function clear(element) { element.replaceChildren(); }
function show(element, visible) { element.hidden = !visible; }
function setText(id, text) { $(id).textContent = text == null ? "" : String(text); }
function key(...parts) { return parts.join("|"); }
function pct(value, denominator, digits = 1) { return denominator > 0 ? `${(100 * value / denominator).toFixed(digits)}%` : "N/A"; }
function asJson(value) { return JSON.stringify(value, null, 2); }
function compactNumber(value) { return Number.isInteger(value) ? String(value) : Number(value).toFixed(2); }

function modelLabel(modelId) {
  return qaModelMap.get(modelId)?.label || crystalModelMap.get(modelId)?.label || modelId;
}

function announce(message) { setText("live-region", message); }

function checkRow(id, label, checked, onChange, options = {}) {
  const row = node("label", `check-row ${options.child ? "child" : "parent"}`);
  const input = node("input");
  input.type = "checkbox";
  input.value = id;
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  row.append(input);
  if (options.color) {
    const swatch = node("span", "swatch");
    swatch.style.background = options.color;
    row.append(swatch);
  }
  const copy = node("span");
  copy.append(node("span", null, label));
  if (options.note) copy.append(node("small", null, options.note));
  row.append(copy);
  return row;
}

function fillSelect(select, options, value) {
  clear(select);
  for (const option of options) {
    const item = node("option", null, option.label);
    item.value = option.value;
    item.disabled = Boolean(option.disabled);
    select.append(item);
  }
  if (options.some((item) => item.value === value)) select.value = value;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = node("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  announce(`Downloaded ${filename}`);
}

function csvEscape(value) {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv(filename, rows) {
  if (!rows.length) return;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const csv = [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
  downloadBlob(filename, new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
}

function filterSnapshot() {
  return {
    schema_version: 1,
    experiment: state.experiment,
    qa: { ...state.qa, models: [...state.qa.models], slices: [...state.qa.slices] },
    index: { ...state.index, models: [...state.index.models], conditions: [...state.index.conditions] },
    crystal: { ...state.crystal, models: [...state.crystal.models], conditions: [...state.crystal.conditions] },
    detail: state.detail,
    detail_filters: { search: state.detailSearch, status: state.detailStatus, pattern: state.detailPattern },
    data_schema_version: data.schema_version,
    generated_at_utc: data.generated_at_utc,
  };
}

function exportFilter() {
  downloadBlob("chemistry-explorer-filter.json", new Blob([asJson(filterSnapshot()) + "\n"], { type: "application/json" }));
}

function exportChart() {
  const source = $("chart").querySelector("svg");
  if (!source) return;
  const clone = source.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  const metadata = svgNode("metadata");
  metadata.textContent = JSON.stringify(filterSnapshot());
  clone.insertBefore(metadata, clone.firstChild);
  downloadBlob(`chemistry-explorer-${state.experiment}-chart.svg`, new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
}

function resetDetail() {
  state.detail = null;
  state.detailSearch = "";
  state.detailStatus = "all";
  state.detailPattern = "all";
  state.expanded = null;
  state.page = 1;
  $("detail-search").value = "";
  $("detail-status").value = "all";
  $("detail-pattern").value = "all";
}

function switchExperiment(experiment) {
  state.experiment = experiment;
  resetDetail();
  render();
}

function qaRootSlices() { return data.qa.slices.filter((slice) => slice.kind === "benchmark"); }
function qaModelOrder() { return data.qa.models.map((model) => model.id); }
function selectedInOrder(order, selected) { return order.filter((value) => selected.has(value)); }

function qaActiveModels() {
  if (state.qa.mode === "model") return [state.qa.modelFocus];
  return selectedInOrder(qaModelOrder(), state.qa.models);
}

function selectedRootBenchmarks() {
  const roots = new Set();
  for (const sliceId of state.qa.slices) {
    const slice = qaSliceMap.get(sliceId);
    if (!slice) continue;
    roots.add(slice.kind === "benchmark" ? slice.id : slice.parent);
  }
  return [...roots];
}

function questionIdsForRoots(roots) {
  const ids = new Set();
  for (const root of roots) for (const id of qaSliceMap.get(root)?.question_ids || []) ids.add(id);
  return [...ids];
}

function questionIdsForSelectedSlices() {
  const ids = new Set();
  for (const sliceId of state.qa.slices) {
    for (const id of qaSliceMap.get(sliceId)?.question_ids || []) ids.add(id);
  }
  return [...ids];
}

function chemistryCells(scopeIds, scopeLabel) {
  const scope = new Set(scopeIds);
  const questions = data.qa.questions.filter((question) => scope.has(question.id));
  const cells = data.qa.chemistry_fields.map((field) => ({
    id: `virtual::chemistry::${field.id}::${scopeLabel}`,
    label: field.label,
    ids: questions.filter((question) => question.chemistry_field === field.id).map((question) => question.id),
    kind: "chemistry_field",
  })).filter((cell) => cell.ids.length);
  for (const tag of data.qa.cross_cutting_tags) {
    const ids = questions.filter((question) => question.cross_cutting_tags.includes(tag.id)).map((question) => question.id);
    if (ids.length) cells.push({
      id: `virtual::cross_tag::${tag.id}::${scopeLabel}`,
      label: `${tag.label} · cross-cutting`, ids, kind: "cross_tag",
    });
  }
  return cells;
}

function qaCells() {
  if (state.qa.mode === "benchmark") {
    const slice = qaSliceMap.get(state.qa.benchmarkFocus);
    return [{ id: slice.id, label: slice.label, ids: [...slice.question_ids], kind: slice.kind }];
  }
  if (state.qa.mode === "compare") {
    if (state.qa.compareGrouping === "benchmark") {
      return data.qa.slices.filter((slice) => state.qa.slices.has(slice.id)).map((slice) => ({
        id: slice.id, label: slice.label, ids: [...slice.question_ids], kind: slice.kind, parent: slice.parent,
      }));
    }
    const selectedIds = questionIdsForSelectedSlices();
    if (state.qa.compareGrouping === "chemistry") return chemistryCells(selectedIds, "selected");
    const selected = new Set(selectedIds);
    return data.qa.slices.filter((slice) => slice.kind === "task")
      .map((slice) => ({ ...slice, ids: slice.question_ids.filter((id) => selected.has(id)) }))
      .filter((slice) => slice.ids.length)
      .map((slice) => ({ id: `virtual::task::${slice.id}`, label: slice.label, ids: slice.ids, kind: "task", parent: slice.parent }));
  }
  const roots = selectedRootBenchmarks().length ? selectedRootBenchmarks() : qaRootSlices().map((slice) => slice.id);
  if (state.qa.modelGrouping === "benchmark") {
    return qaRootSlices().filter((slice) => roots.includes(slice.id)).map((slice) => ({ id: slice.id, label: slice.label, ids: [...slice.question_ids], kind: "benchmark" }));
  }
  if (state.qa.modelGrouping === "task") {
    return data.qa.slices.filter((slice) => slice.kind === "task" && roots.includes(slice.parent)).map((slice) => ({
      id: slice.id, label: slice.label, ids: [...slice.question_ids], kind: "task", parent: slice.parent,
    }));
  }
  const chemistryRoots = state.qa.domainScope === "chembench" ? ["chembench_lamalab"] : roots;
  return chemistryCells(questionIdsForRoots(chemistryRoots), state.qa.domainScope);
}

function filteredQaIds(cell) {
  return cell.ids.filter((id) => {
    const question = qaQuestionMap.get(id);
    if (!question) return false;
    if (state.qa.field !== "all" && question.chemistry_field !== state.qa.field) return false;
    if (state.qa.task !== "all" && question.task_key !== state.qa.task) return false;
    return true;
  });
}

function qaAggregate(model, cell) {
  const ids = filteredQaIds(cell);
  const rows = ids.map((id) => qaResultMap.get(key(model, id))).filter(Boolean);
  const planned = ids.length;
  const executed = rows.length;
  const valid = rows.filter((row) => row.protocol_valid === true).length;
  const length = rows.filter((row) => row.length_stop === true).length;
  const content = rows.filter((row) => row.content_match === true).length;
  const correct = rows.filter((row) => row.protocol_correct === true).length;
  let numerator = null;
  let denominator = null;
  let kindValue = "ratio";
  if (state.qa.metric === "protocol_correct") { numerator = correct; denominator = planned; }
  if (state.qa.metric === "content_match") { numerator = content; denominator = planned; }
  if (state.qa.metric === "protocol_valid") { numerator = valid; denominator = planned; }
  if (state.qa.metric === "conditional_accuracy") { numerator = correct; denominator = valid; }
  if (state.qa.metric === "S_total" || state.qa.metric === "S_partial") {
    const values = rows.filter((row) => row.ome_partial_scorable === true && Number.isFinite(row[state.qa.metric])).map((row) => row[state.qa.metric]);
    numerator = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    denominator = values.length;
    kindValue = "mean";
  }
  const value = kindValue === "mean" ? numerator : (denominator > 0 && numerator != null ? numerator / denominator : null);
  return { experiment: "qa", model, cell, ids, planned, executed, valid, length, content, correct, numerator, denominator, value, valueKind: kindValue };
}

function qaAggregateLabel(aggregate) {
  if (aggregate.planned === 0) return "No items";
  if (aggregate.value == null) return state.qa.metric.startsWith("S_") ? "Not applicable" : "N/A";
  if (aggregate.valueKind === "mean") return `${aggregate.value.toFixed(2)} mean · n=${aggregate.denominator}/${aggregate.planned}`;
  return `${aggregate.numerator}/${aggregate.denominator} · ${pct(aggregate.numerator, aggregate.denominator)}`;
}

function qaTaskOptions(cells) {
  const ids = new Set(cells.flatMap((cell) => cell.ids));
  const tasks = new Map();
  for (const id of ids) {
    const question = qaQuestionMap.get(id);
    tasks.set(question.task_key, question.task_label);
  }
  const options = [{ value: "all", label: "All tasks" }, ...[...tasks].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
  if (!options.some((option) => option.value === state.qa.task)) state.qa.task = "all";
  fillSelect($("qa-task-filter"), options, state.qa.task);
}

function updateQaControls() {
  document.querySelectorAll(".mode-button").forEach((button) => {
    const active = button.dataset.qaMode === state.qa.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  show($("qa-focus-benchmark"), state.qa.mode === "benchmark");
  show($("qa-focus-model"), state.qa.mode === "model");
  show($("qa-compare-grouping-wrap"), state.qa.mode === "compare");
  show($("qa-model-multiselect"), state.qa.mode !== "model");
  show($("qa-slice-multiselect"), state.qa.mode !== "benchmark");
  show($("qa-domain-scope-wrap"), state.qa.mode === "model" && state.qa.modelGrouping === "chemistry");

  fillSelect($("qa-benchmark-focus"), qaRootSlices().map((slice) => ({ value: slice.id, label: `${slice.label} · ${slice.question_ids.length} questions` })), state.qa.benchmarkFocus);
  fillSelect($("qa-model-focus"), data.qa.models.map((model) => ({ value: model.id, label: model.label })), state.qa.modelFocus);
  $("qa-model-grouping").value = state.qa.modelGrouping;
  $("qa-compare-grouping").value = state.qa.compareGrouping;
  $("qa-domain-scope").value = state.qa.domainScope;
  $("qa-domain-filter").value = state.qa.field;
  $("qa-metric").value = state.qa.metric;
  $("qa-chart-type").value = state.qa.chart;
  $("qa-sort").value = state.qa.sort;

  const modelChecks = $("qa-model-checks");
  clear(modelChecks);
  for (const model of data.qa.models) {
    modelChecks.append(checkRow(model.id, model.label, state.qa.models.has(model.id), (checked) => {
      checked ? state.qa.models.add(model.id) : state.qa.models.delete(model.id);
      resetDetail(); render();
    }, { color: model.color, note: model.id }));
  }
  setText("qa-model-count", `${state.qa.models.size}/9`);

  const sliceChecks = $("qa-slice-checks");
  clear(sliceChecks);
  for (const root of qaRootSlices()) {
    sliceChecks.append(checkRow(root.id, root.label, state.qa.slices.has(root.id), (checked) => {
      checked ? state.qa.slices.add(root.id) : state.qa.slices.delete(root.id);
      resetDetail(); render();
    }, { note: `${root.question_ids.length} questions` }));
    for (const child of data.qa.slices.filter((slice) => slice.parent === root.id)) {
      sliceChecks.append(checkRow(child.id, child.short_label, state.qa.slices.has(child.id), (checked) => {
        checked ? state.qa.slices.add(child.id) : state.qa.slices.delete(child.id);
        resetDetail(); render();
      }, { child: true, note: `${child.question_ids.length} questions` }));
    }
  }
  setText("qa-slice-count", `${state.qa.slices.size} selected`);
  qaTaskOptions(qaCells());
}

function indexAggregate(model, condition) {
  const rows = data.index.records.filter((row) => row.model === model && row.condition === condition);
  const executedRows = rows.filter((row) => row.executed);
  const numerator = executedRows.filter((row) => row[state.index.metric] === true).length;
  const executed = executedRows.length;
  const planned = rows.length;
  return {
    experiment: "index", model,
    cell: { id: condition, label: data.index.conditions.find((item) => item.id === condition).label, condition },
    rows, planned, executed, numerator: executed ? numerator : null, denominator: executed,
    value: executed ? numerator / executed : null,
    valid: executedRows.filter((row) => row.protocol_valid === true).length,
    length: executedRows.filter((row) => row.finish_reason === "length").length,
  };
}

function indexAggregateLabel(aggregate) {
  return aggregate.executed === 0 ? `N/A · 0/${aggregate.planned} executed` : `${aggregate.numerator}/${aggregate.denominator} · ${pct(aggregate.numerator, aggregate.denominator)}`;
}

function updateIndexControls() {
  const modelChecks = $("index-model-checks"); clear(modelChecks);
  for (const modelId of data.index.models) {
    const model = qaModelMap.get(modelId);
    modelChecks.append(checkRow(modelId, model.label, state.index.models.has(modelId), (checked) => {
      checked ? state.index.models.add(modelId) : state.index.models.delete(modelId);
      resetDetail(); render();
    }, { color: model.color, note: modelId === "deepseek_flash" ? "30 cells not executed" : "30 cells executed" }));
  }
  const conditionChecks = $("index-condition-checks"); clear(conditionChecks);
  for (const condition of data.index.conditions) {
    conditionChecks.append(checkRow(condition.id, condition.label, state.index.conditions.has(condition.id), (checked) => {
      checked ? state.index.conditions.add(condition.id) : state.index.conditions.delete(condition.id);
      resetDetail(); render();
    }));
  }
  $("index-metric").value = state.index.metric;
}

const CRYSTAL_METRIC_FIELDS = {
  strict: { parse: "strict_parse", composition: "composition_exact", geometry: "geometry_screen", reference: "reference_structure_match", spacegroup: "spacegroup_agreement", task_success: "task_success" },
  repaired: { parse: "repaired_parse", composition: "repaired_composition_exact", geometry: "repaired_geometry_screen", reference: "repaired_reference_structure_match", spacegroup: "repaired_spacegroup_agreement", task_success: "repaired_task_success" },
};

function crystalAggregate(model, condition) {
  const rows = data.crystal.records.filter((row) => row.model === model && row.condition === condition);
  const metricField = CRYSTAL_METRIC_FIELDS[state.crystal.path][state.crystal.metric];
  let units;
  if (state.crystal.unit === "candidate") {
    units = rows.map((row) => ({ id: `${row.sample_id}:${row.sample_index}`, success: row[metricField] === true }));
  } else {
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.sample_id)) groups.set(row.sample_id, []);
      groups.get(row.sample_id).push(row);
    }
    units = [...groups].map(([sampleId, candidates]) => ({
      id: sampleId,
      success: state.crystal.unit === "structure_at1"
        ? candidates.find((row) => row.sample_index === 1)?.[metricField] === true
        : candidates.some((row) => row[metricField] === true),
    }));
  }
  const numerator = units.filter((unit) => unit.success).length;
  return {
    experiment: "crystal", model,
    cell: { id: condition, label: data.crystal.conditions.find((item) => item.id === condition).label, condition },
    rows, planned: units.length, executed: units.length, numerator, denominator: units.length,
    value: units.length ? numerator / units.length : null, valid: rows.filter((row) => row.strict_parse === true).length,
    length: rows.filter((row) => row.stop_reason === "length").length, metricField,
  };
}

function crystalAggregateLabel(aggregate) {
  return aggregate.denominator ? `${aggregate.numerator}/${aggregate.denominator} · ${pct(aggregate.numerator, aggregate.denominator)}` : "N/A";
}

function updateCrystalControls() {
  const modelChecks = $("crystal-model-checks"); clear(modelChecks);
  for (const model of data.crystal.models) {
    modelChecks.append(checkRow(model.id, model.label, state.crystal.models.has(model.id), (checked) => {
      checked ? state.crystal.models.add(model.id) : state.crystal.models.delete(model.id);
      resetDetail(); render();
    }, { color: model.color }));
  }
  const conditionChecks = $("crystal-condition-checks"); clear(conditionChecks);
  for (const condition of data.crystal.conditions) {
    conditionChecks.append(checkRow(condition.id, condition.label, state.crystal.conditions.has(condition.id), (checked) => {
      checked ? state.crystal.conditions.add(condition.id) : state.crystal.conditions.delete(condition.id);
      resetDetail(); render();
    }));
  }
  $("crystal-path").value = state.crystal.path;
  $("crystal-metric").value = state.crystal.metric;
  $("crystal-unit").value = state.crystal.unit;
}

function activeAggregates() {
  if (state.experiment === "qa") {
    const models = qaActiveModels();
    const cells = qaCells();
    let aggregates = models.flatMap((model) => cells.map((cell) => qaAggregate(model, cell)));
    if (state.qa.mode === "benchmark" && state.qa.sort !== "fixed") {
      aggregates.sort((a, b) => state.qa.sort === "name"
        ? modelLabel(a.model).localeCompare(modelLabel(b.model))
        : (b.value ?? -1) - (a.value ?? -1));
    }
    return aggregates;
  }
  if (state.experiment === "index") {
    const models = selectedInOrder(data.index.models, state.index.models);
    const conditions = data.index.conditions.map((item) => item.id).filter((id) => state.index.conditions.has(id));
    return models.flatMap((model) => conditions.map((condition) => indexAggregate(model, condition)));
  }
  const models = data.crystal.models.map((item) => item.id).filter((id) => state.crystal.models.has(id));
  const conditions = data.crystal.conditions.map((item) => item.id).filter((id) => state.crystal.conditions.has(id));
  return models.flatMap((model) => conditions.map((condition) => crystalAggregate(model, condition)));
}

function aggregateLabel(aggregate) {
  if (aggregate.experiment === "qa") return qaAggregateLabel(aggregate);
  if (aggregate.experiment === "index") return indexAggregateLabel(aggregate);
  return crystalAggregateLabel(aggregate);
}

function colorForValue(value) {
  if (value == null) return "#e6eaed";
  const hue = 18 + Math.max(0, Math.min(1, value)) * 152;
  const light = 94 - Math.max(0, Math.min(1, value)) * 39;
  return `hsl(${hue} 54% ${light}%)`;
}

function openDetail(aggregate) {
  state.detail = { experiment: aggregate.experiment, model: aggregate.model, cellId: aggregate.cell.id, cellLabel: aggregate.cell.label };
  state.detailSearch = ""; state.detailStatus = "all"; state.detailPattern = "all"; state.expanded = null; state.page = 1;
  $("detail-search").value = ""; $("detail-status").value = "all"; $("detail-pattern").value = "all";
  renderDetails();
  $("detail-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function interactiveSvgGroup(svg, aggregate, children) {
  const group = svgNode("g", { class: "svg-cell", role: "button", tabindex: "0", "aria-label": `${modelLabel(aggregate.model)}, ${aggregate.cell.label}, ${aggregateLabel(aggregate)}` });
  children.forEach((child) => group.append(child));
  group.addEventListener("click", () => openDetail(aggregate));
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetail(aggregate); }
  });
  svg.append(group);
}

function renderHeatmap(aggregates) {
  const models = [...new Set(aggregates.map((row) => row.model))];
  const cells = [];
  const cellMap = new Map();
  for (const aggregate of aggregates) {
    if (!cellMap.has(aggregate.cell.id)) { cellMap.set(aggregate.cell.id, aggregate.cell); cells.push(aggregate.cell); }
  }
  const cellWidth = 118;
  const cellHeight = 46;
  const left = 205;
  const top = 118;
  const width = Math.max(760, left + cells.length * cellWidth + 24);
  const height = top + models.length * cellHeight + 48;
  const svg = svgNode("svg", { id: "main-chart-svg", viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": "Selected comparison heatmap" });

  cells.forEach((cell, column) => {
    const text = svgNode("text", { class: "svg-label", x: left + column * cellWidth + 8, y: top - 14, transform: `rotate(-38 ${left + column * cellWidth + 8} ${top - 14})` });
    text.textContent = cell.label;
    svg.append(text);
  });
  models.forEach((model, rowIndex) => {
    const label = svgNode("text", { class: "svg-label", x: left - 12, y: top + rowIndex * cellHeight + 29, "text-anchor": "end" });
    label.textContent = modelLabel(model);
    svg.append(label);
    cells.forEach((cell, column) => {
      const aggregate = aggregates.find((item) => item.model === model && item.cell.id === cell.id);
      if (!aggregate) return;
      const x = left + column * cellWidth;
      const y = top + rowIndex * cellHeight;
      const rect = svgNode("rect", { x, y, width: cellWidth - 5, height: cellHeight - 5, rx: 6, fill: colorForValue(aggregate.value), stroke: "#ffffff", "stroke-width": 1 });
      const text = svgNode("text", { class: aggregate.value == null ? "svg-na" : "svg-value", x: x + (cellWidth - 5) / 2, y: y + 25, "text-anchor": "middle" });
      text.textContent = aggregate.value == null ? "N/A" : aggregate.valueKind === "mean" ? aggregate.value.toFixed(2) : `${aggregate.numerator}/${aggregate.denominator}`;
      interactiveSvgGroup(svg, aggregate, [rect, text]);
    });
  });
  const axis = svgNode("text", { class: "svg-label", x: left, y: height - 14 });
  axis.textContent = "Click any cell to inspect question-level evidence.";
  svg.append(axis);
  $("chart").append(svg);
}

function renderBarsOrDots(aggregates, kind) {
  const rowHeight = 34;
  const left = 310;
  const right = 90;
  const width = 1120;
  const chartWidth = width - left - right;
  const top = 32;
  const height = Math.max(220, top + aggregates.length * rowHeight + 42);
  const svg = svgNode("svg", { id: "main-chart-svg", viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": `Selected comparison ${kind} chart` });
  for (const tick of [0, .25, .5, .75, 1]) {
    const x = left + tick * chartWidth;
    svg.append(svgNode("line", { x1: x, y1: top - 8, x2: x, y2: height - 28, stroke: "#dce4e7", "stroke-width": 1 }));
    const label = svgNode("text", { class: "svg-label", x, y: 18, "text-anchor": "middle" });
    label.textContent = `${Math.round(tick * 100)}%`;
    svg.append(label);
  }
  aggregates.forEach((aggregate, index) => {
    const y = top + index * rowHeight;
    const label = svgNode("text", { class: "svg-label", x: left - 10, y: y + 20, "text-anchor": "end" });
    label.textContent = `${modelLabel(aggregate.model)} · ${aggregate.cell.label}`;
    svg.append(label);
    const groupChildren = [];
    if (aggregate.value == null) {
      const na = svgNode("text", { class: "svg-na", x: left + 8, y: y + 20 }); na.textContent = "N/A"; groupChildren.push(na);
    } else if (kind === "bar") {
      groupChildren.push(svgNode("rect", { x: left, y: y + 5, width: Math.max(2, aggregate.value * chartWidth), height: 20, rx: 4, fill: qaModelMap.get(aggregate.model)?.color || crystalModelMap.get(aggregate.model)?.color || "#0f766e" }));
    } else {
      groupChildren.push(svgNode("line", { x1: left, y1: y + 15, x2: left + chartWidth, y2: y + 15, stroke: "#dce4e7", "stroke-width": 2 }));
      groupChildren.push(svgNode("circle", { cx: left + aggregate.value * chartWidth, cy: y + 15, r: 7, fill: qaModelMap.get(aggregate.model)?.color || crystalModelMap.get(aggregate.model)?.color || "#0f766e", stroke: "white", "stroke-width": 2 }));
    }
    const value = svgNode("text", { class: aggregate.value == null ? "svg-na" : "svg-value", x: width - right + 10, y: y + 20 });
    value.textContent = aggregateLabel(aggregate);
    groupChildren.push(value);
    interactiveSvgGroup(svg, aggregate, groupChildren);
  });
  $("chart").append(svg);
}

function renderChart(aggregates) {
  clear($("chart"));
  const empty = aggregates.length === 0 || aggregates.every((aggregate) => aggregate.planned === 0);
  show($("chart-empty"), empty);
  $("export-chart").disabled = empty;
  if (empty) return;
  let chartType = state.experiment === "qa" ? state.qa.chart : "heatmap";
  if (chartType === "heatmap") renderHeatmap(aggregates);
  else renderBarsOrDots(aggregates, chartType);
}

function summaryExportRow(aggregate) {
  const filter = JSON.stringify(filterSnapshot());
  return {
    experiment: aggregate.experiment,
    model_alias: aggregate.model,
    model_label: modelLabel(aggregate.model),
    scope_id: aggregate.cell.id,
    scope_label: aggregate.cell.label,
    scope_kind: aggregate.cell.kind || null,
    metric: state.experiment === "qa" ? state.qa.metric : state.experiment === "index" ? state.index.metric : `${state.crystal.path}:${state.crystal.metric}:${state.crystal.unit}`,
    numerator: aggregate.numerator,
    denominator: aggregate.denominator,
    planned: aggregate.planned,
    executed: aggregate.executed,
    proportion_or_mean: aggregate.value,
    protocol_valid_or_strict_parse_count: aggregate.valid,
    length_stop_count: aggregate.length,
    run_or_scorer_version: state.experiment === "qa" ? data.qa.scorer_version : state.experiment === "index" ? data.index.experiment_id : data.crystal.experiment_id,
    filter_json: filter,
  };
}

function renderSummaryTable(aggregates) {
  const head = $("summary-head"); const body = $("summary-body"); clear(head); clear(body);
  const header = node("tr");
  const qaScopeHeading = (state.qa.mode === "model" && state.qa.modelGrouping === "chemistry") || (state.qa.mode === "compare" && state.qa.compareGrouping === "chemistry")
    ? "Chemistry field / tag" : "Scope";
  const columns = state.experiment === "qa"
    ? [qaScopeHeading, "Model", "Score", "Rate / mean", "Protocol valid", "Length stop", "Planned"]
    : state.experiment === "index"
      ? ["Condition", "Model", "Score", "Executed", "Protocol valid", "Planned"]
      : ["Condition", "Model", "Score", "Rate", "Unit denominator", "Direct parse candidates"];
  columns.forEach((label) => header.append(node("th", null, label))); head.append(header);
  if (!aggregates.length) {
    const row = node("tr"); const cell = node("td", "na", "No items"); cell.colSpan = columns.length; row.append(cell); body.append(row);
  }
  for (const aggregate of aggregates) {
    const row = node("tr");
    row.append(node("td", null, aggregate.cell.label), node("td", null, modelLabel(aggregate.model)));
    const scoreCell = node("td");
    const scoreButton = node("button", "table-cell-button", aggregateLabel(aggregate));
    scoreButton.type = "button"; scoreButton.addEventListener("click", () => openDetail(aggregate)); scoreCell.append(scoreButton); row.append(scoreCell);
    if (state.experiment === "qa") {
      row.append(node("td", aggregate.value == null ? "na" : null, aggregate.value == null ? "N/A" : aggregate.valueKind === "mean" ? aggregate.value.toFixed(2) : pct(aggregate.numerator, aggregate.denominator)));
      row.append(node("td", null, `${aggregate.valid}/${aggregate.planned}`), node("td", null, `${aggregate.length}/${aggregate.planned}`), node("td", null, aggregate.planned));
    } else if (state.experiment === "index") {
      row.append(node("td", aggregate.executed ? null : "na", `${aggregate.executed}/${aggregate.planned}`), node("td", null, aggregate.executed ? `${aggregate.valid}/${aggregate.executed}` : "N/A"), node("td", null, aggregate.planned));
    } else {
      row.append(node("td", aggregate.value == null ? "na" : null, aggregate.value == null ? "N/A" : pct(aggregate.numerator, aggregate.denominator)), node("td", null, aggregate.denominator), node("td", null, `${aggregate.valid}/24`));
    }
    body.append(row);
  }
  currentSummaryRows = aggregates.map(summaryExportRow);
  setText("table-count", `${aggregates.length} cells`);
  $("export-summary").disabled = !aggregates.length;
}

function renderHeader(aggregates) {
  const chips = $("filter-chips"); clear(chips);
  const addChip = (text) => chips.append(node("span", "filter-chip", text));
  const stats = $("summary-stats"); clear(stats);
  const addStat = (value, label) => { const item = node("div", "summary-stat"); item.append(node("strong", null, value), node("span", null, label)); stats.append(item); };
  if (state.experiment === "qa") {
    const cells = qaCells(); const models = qaActiveModels();
    const uniqueIds = new Set(cells.flatMap((cell) => filteredQaIds(cell)));
    const selectedMolecules = new Set([...uniqueIds].map((id) => qaQuestionMap.get(id)).filter((q) => q.benchmark === "moleculariq").map((q) => q.source_labels.molecule_id));
    const groupingLabels = { chemistry: "chemistry fields", task: "evaluation tasks", benchmark: "source benchmarks" };
    const compareLabel = state.qa.compareGrouping === "chemistry" ? "QA by chemistry field across selected benchmarks" : state.qa.compareGrouping === "task" ? "QA by evaluation task across selected benchmarks" : "QA model × benchmark overview";
    setText("view-title", state.qa.mode === "compare" ? compareLabel : state.qa.mode === "benchmark" ? `${cells[0]?.label || "No benchmark"} across models` : `${modelLabel(state.qa.modelFocus)} across ${groupingLabels[state.qa.modelGrouping]}`);
    setText("view-subtitle", "Chemical fields describe what chemistry the questions test. Source benchmarks remain visible for provenance. Computational chemistry is a cross-cutting tag, so it can overlap physical, organic, and materials rows.");
    addStat(models.length, "models"); addStat(cells.length, "displayed scopes"); addStat(uniqueIds.size, "unique questions");
    if (selectedMolecules.size) addStat(selectedMolecules.size, "MolecularIQ molecules");
    addChip(`Mode: ${state.qa.mode}`); addChip(`Metric: ${state.qa.metric}`); addChip(`Chemical field: ${state.qa.field}`); addChip(`Task: ${state.qa.task}`);
    if (state.qa.mode === "model" && state.qa.modelGrouping === "chemistry") addChip(state.qa.domainScope === "chembench" ? "Chemistry scope: ChemBench 90 only" : "Chemistry scope: selected benchmarks");
    const overlapTotal = cells.reduce((sum, cell) => sum + filteredQaIds(cell).length, 0);
    setText("metric-note", `${state.qa.metric === "protocol_correct" ? "Default: protocol_correct / planned." : state.qa.metric === "content_match" ? "content_match uses the frozen extractor; it is not manual semantic grading." : state.qa.metric === "protocol_valid" ? "Protocol validity is reported independently of content correctness." : state.qa.metric === "conditional_accuracy" ? "Conditional accuracy uses protocol-valid answers only; it does not replace the planned denominator view." : "oMeBench partial means use only scorable mechanisms; n=0 is N/A."} ${overlapTotal > uniqueIds.size ? `Overlapping source or cross-cutting selections create ${overlapTotal} displayed memberships but only ${uniqueIds.size} unique questions.` : ""}`);
    setText("chart-title", state.qa.chart === "heatmap" ? "Model × selected scope heatmap" : state.qa.chart === "bar" ? "Selected scope bars" : "Selected scope dot plot");
  } else if (state.experiment === "index") {
    const models = selectedInOrder(data.index.models, state.index.models); const conditions = data.index.conditions.filter((item) => state.index.conditions.has(item.id));
    setText("view-title", "MolecularIQ atom-index conditions");
    setText("view-subtitle", "A0, A1, and A2 are independent generations from the index-control run. Unexecuted DeepSeek cells remain N/A and are not filled with historical QA responses.");
    addStat(models.length, "models"); addStat(conditions.length, "conditions"); addStat(10, "molecules"); addStat(60, "executed cells");
    addChip(`Metric: ${state.index.metric}`); addChip("Unit: 10 molecules");
    setText("metric-note", "Percentages use executed cells only, while planned and executed counts remain visible. The 60 executed cells are repeated conditions on ten molecules, not 60 independent molecules.");
    setText("chart-title", "Model × condition heatmap");
  } else {
    const models = data.crystal.models.filter((item) => state.crystal.models.has(item.id)); const conditions = data.crystal.conditions.filter((item) => state.crystal.conditions.has(item.id));
    setText("view-title", "MP-20-derived crystal diagnostic slice");
    setText("view-subtitle", "The 48 repaired π candidates and 96 reused chat-model candidates use the same frozen scorer. The earlier faulty π outputs are excluded from the current denominator.");
    addStat(models.length, "models"); addStat(conditions.length, "conditions"); addStat(12, "structures"); addStat(state.crystal.unit === "candidate" ? 24 : 12, "denominator / condition");
    addChip(`Path: ${state.crystal.path}`); addChip(`Metric: ${state.crystal.metric}`); addChip(`Unit: ${state.crystal.unit}`);
    setText("metric-note", `${state.crystal.path === "strict" ? "Direct parse does not use upstream postprocessing; existing parser tolerances remain." : "Author postprocessing is a separate diagnostic path and may rewrite symmetry representation."} Checks are independent, not a cumulative funnel. No energy, stability, or synthesizability metric is available.`);
    setText("chart-title", "Model × condition heatmap");
  }
}

function qaDetailModels() { return qaActiveModels(); }
function indexDetailModels() { return selectedInOrder(data.index.models, state.index.models); }
function crystalDetailModels() { return data.crystal.models.map((model) => model.id).filter((id) => state.crystal.models.has(id)); }

function qaDetailBase() {
  const cell = qaCells().find((item) => item.id === state.detail.cellId);
  if (!cell) return [];
  return filteredQaIds(cell).map((id) => ({ id, question: qaQuestionMap.get(id), focus: qaResultMap.get(key(state.detail.model, id)) }));
}

function indexDetailBase() {
  return data.index.records.filter((row) => row.model === state.detail.model && row.condition === state.detail.cellId)
    .map((row) => ({ id: row.question_id, question: qaQuestionMap.get(row.question_id), focus: row }));
}

function crystalDetailBase() {
  const rows = data.crystal.records.filter((row) => row.model === state.detail.model && row.condition === state.detail.cellId);
  const ids = [...new Set(rows.map((row) => row.sample_id))];
  return ids.map((id) => ({ id, question: rows.find((row) => row.sample_id === id), focus: crystalStructureValue(state.detail.model, state.detail.cellId, id) }));
}

function crystalStructureValue(model, condition, sampleId) {
  const rows = data.crystal.records.filter((row) => row.model === model && row.condition === condition && row.sample_id === sampleId);
  const field = CRYSTAL_METRIC_FIELDS[state.crystal.path][state.crystal.metric];
  if (state.crystal.unit === "candidate") return rows.some((row) => row[field] === true);
  if (state.crystal.unit === "structure_at1") return rows.find((row) => row.sample_index === 1)?.[field] === true;
  return rows.some((row) => row[field] === true);
}

function itemCorrect(entry, model) {
  if (state.experiment === "qa") return qaResultMap.get(key(model, entry.id))?.protocol_correct;
  if (state.experiment === "index") return indexRecordMap.get(key(model, entry.id, state.detail.cellId))?.exact_set_correct;
  return crystalStructureValue(model, state.detail.cellId, entry.id);
}

function detailModels() {
  if (state.experiment === "qa") return qaDetailModels();
  if (state.experiment === "index") return indexDetailModels();
  return crystalDetailModels();
}

function detailBase() {
  if (state.experiment === "qa") return qaDetailBase();
  if (state.experiment === "index") return indexDetailBase();
  return crystalDetailBase();
}

function detailMatches(entry) {
  const search = state.detailSearch.trim().toLowerCase();
  if (search) {
    const haystack = state.experiment === "crystal"
      ? `${entry.id} ${entry.question.material_id} ${entry.question.source_id}`.toLowerCase()
      : `${entry.id} ${entry.question?.prompt || ""} ${entry.question?.source_id || ""}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  const focus = entry.focus;
  if (state.detailStatus === "correct" && !(state.experiment === "crystal" ? focus === true : (state.experiment === "index" ? focus?.exact_set_correct === true : focus?.protocol_correct === true))) return false;
  if (state.detailStatus === "wrong" && !(state.experiment === "crystal" ? focus === false : (state.experiment === "index" ? focus?.executed && focus.exact_set_correct === false : focus?.protocol_correct === false))) return false;
  if (state.detailStatus === "invalid" && !(state.experiment === "qa" ? focus?.protocol_valid === false : state.experiment === "index" ? focus?.executed && focus.protocol_valid === false : false)) return false;
  if (state.detailStatus === "length" && !(state.experiment === "qa" ? focus?.length_stop === true : state.experiment === "index" ? focus?.finish_reason === "length" : false)) return false;
  if (state.detailStatus === "missing" && !(state.experiment === "index" && focus?.executed === false)) return false;
  const values = detailModels().map((model) => itemCorrect(entry, model));
  const booleans = values.filter((value) => typeof value === "boolean");
  if (state.detailPattern === "disagree" && !(new Set(values.map((value) => value === null || value === undefined ? "missing" : String(value))).size > 1)) return false;
  if (state.detailPattern === "unique" && booleans.filter(Boolean).length !== 1) return false;
  if (state.detailPattern === "all_correct" && !(booleans.length === values.length && booleans.every(Boolean))) return false;
  if (state.detailPattern === "all_wrong" && !(booleans.length === values.length && booleans.every((value) => value === false))) return false;
  return true;
}

function jointLabel(entry) {
  const models = detailModels();
  if (models.length !== 2) return null;
  const [a, b] = models.map((model) => itemCorrect(entry, model));
  if (a === undefined || b === undefined || a === null || b === null) return "missing cell";
  if (a && b) return "both correct";
  if (a) return `only ${modelLabel(models[0])} correct`;
  if (b) return `only ${modelLabel(models[1])} correct`;
  return "both wrong";
}

function badge(text, type) { return node("span", `status-badge ${type}`, text); }

function answerCard(model, record, options = {}) {
  const card = node("section", "answer-card");
  card.style.setProperty("--model-color", qaModelMap.get(model)?.color || crystalModelMap.get(model)?.color || "#0f766e");
  card.append(node("h4", null, options.title || modelLabel(model)));
  const meta = node("p", "answer-meta", options.meta || ""); card.append(meta);
  if (options.prediction !== undefined) card.append(node("p", "answer-meta", `Extracted: ${options.prediction ?? "—"}`));
  const actions = node("div", "answer-actions");
  actions.append(node("strong", null, options.resultLabel || ""));
  const copy = node("button", "copy-button", "Copy raw"); copy.type = "button";
  const raw = options.rawText;
  copy.disabled = raw == null;
  copy.addEventListener("click", () => copyText(raw || "")); actions.append(copy); card.append(actions);
  const details = node("details");
  const summary = node("summary", null, raw == null ? "Raw response unavailable" : "Show full raw response"); details.append(summary);
  details.append(node("pre", null, raw == null ? (options.missingReason || "No raw response") : raw));
  card.append(details);
  return card;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_error) {
    const area = node("textarea"); area.value = text; document.body.append(area); area.select(); document.execCommand("copy"); area.remove();
  }
  announce("Copied raw response text");
}

function renderQaExpanded(entry, container) {
  const question = entry.question;
  const meta = node("div", "question-meta");
  const fields = [
    ["Question ID", question.id], ["Source ID", question.source_id], ["Benchmark", question.benchmark_label],
    ["Task", question.task_label], ["Chemical field", question.chemistry_field_label],
    ["Cross-cutting tags", question.cross_cutting_tags.length ? question.cross_cutting_tags.join(", ") : "—"],
    ["Classification basis", question.chemistry_field_basis], ["Legacy analysis tag", question.analysis_domain],
    ["Pair / group", question.pair_id || question.group_id || "—"], ["Source revision", question.source_revision],
  ];
  fields.forEach(([label, value]) => { const item = node("div", "meta-item"); item.append(node("strong", null, label), node("span", null, value)); meta.append(item); });
  container.append(meta);
  const prompt = node("section", "prompt-box"); prompt.append(node("h4", null, "Question"), node("p", null, question.prompt));
  if (question.options.length) prompt.append(node("p", null, question.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join("\n")));
  container.append(prompt);
  const gold = node("section", "gold-box"); gold.append(node("h4", null, "Gold"), node("pre", null, asJson(question.gold))); container.append(gold);
  const source = node("p", "answer-meta");
  const link = node("a", null, question.source_url); link.href = question.source_url; link.target = "_blank"; link.rel = "noreferrer";
  source.append("Source: ", link, ` · original labels: ${JSON.stringify(question.source_labels)}`); container.append(source);
  const grid = node("div", "answer-grid");
  for (const model of qaDetailModels()) {
    const record = qaResultMap.get(key(model, question.id));
    const mechanismMetrics = record && question.benchmark === "omebench"
      ? ` · exact_mechanism_match=${record.exact_mechanism_match} · S_total=${record.S_total ?? "N/A"} · S_partial=${record.S_partial ?? "N/A"} · V=${record.V ?? "N/A"} · L=${record.L ?? "N/A"}`
      : "";
    grid.append(answerCard(model, record, {
      meta: record ? `status=${record.status} · protocol_valid=${record.protocol_valid} · content_match=${record.content_match}${mechanismMetrics} · finish=${record.finish_reason || "—"} · run=${record.run_id} · attempt=${record.attempt_id}` : "No matching record",
      prediction: record?.prediction,
      resultLabel: record?.protocol_correct === true ? "protocol correct" : record ? "not protocol correct" : "missing",
      rawText: record?.raw_text,
      missingReason: "No uniquely matched formal raw record",
    }));
  }
  container.append(grid);
}

function renderIndexExpanded(entry, container) {
  const question = entry.question;
  const gold = entry.focus?.gold || data.index.records.find((row) => row.question_id === entry.id)?.gold;
  const meta = node("div", "question-meta");
  [["Question ID", entry.id], ["Pair ID", entry.focus?.pair_id || "—"], ["Original SMILES", entry.focus?.original_smiles || "—"], ["Gold", JSON.stringify(gold)]].forEach(([label, value]) => {
    const item = node("div", "meta-item"); item.append(node("strong", null, label), node("span", null, value)); meta.append(item);
  });
  container.append(meta);
  if (question) { const prompt = node("section", "prompt-box"); prompt.append(node("h4", null, "Original QA question"), node("p", null, question.prompt)); container.append(prompt); }
  const grid = node("div", "answer-grid");
  const conditions = data.index.conditions.map((item) => item.id).filter((id) => state.index.conditions.has(id));
  for (const model of indexDetailModels()) for (const condition of conditions) {
    const record = indexRecordMap.get(key(model, entry.id, condition));
    grid.append(answerCard(model, record, {
      title: `${modelLabel(model)} · ${condition}`,
      meta: record ? `status=${record.status} · protocol_valid=${record.protocol_valid ?? "N/A"} · finish=${record.finish_reason || "—"} · run=${record.run_id} · attempt=${record.attempt_id || "—"}` : "Missing record",
      prediction: record?.prediction,
      resultLabel: record?.executed ? (record.exact_set_correct ? "exact set correct" : "exact set incorrect") : "N/A · not executed",
      rawText: record?.raw_text,
      missingReason: record?.raw_missing_reason || "No planned record",
    }));
    if (record) {
      const input = node("section", "input-box"); input.append(node("h4", null, `${modelLabel(model)} · ${condition} model input`), node("p", null, record.prompt));
      if (record.mapped_smiles) input.append(node("p", null, `Mapped SMILES: ${record.mapped_smiles}`));
      container.append(input);
    }
  }
  container.append(grid);
  if (entry.focus?.pair_id === "pair_06") {
    const note = node("p", "explanatory-note", "This numbered 2D diagram is explanatory material for the reader. A0 and A1 did not receive the image; A2 received atom-mapped SMILES, not the rendered image.");
    const image = node("img", "pair-image"); image.src = data.index.pair06_asset; image.alt = "pair_06 molecule with zero-based atom indices";
    container.append(note, image);
  }
}

function renderCrystalExpanded(entry, container) {
  const example = entry.question;
  const meta = node("div", "question-meta");
  [["Sample", entry.id], ["Material ID", example.material_id], ["Formula", example.expanded_formula], ["Condition", state.detail.cellId], ["Reference space group", `${example.reference_spacegroup} (${example.reference_spacegroup_number})`], ["Scorer", example.scorer_version]].forEach(([label, value]) => {
    const item = node("div", "meta-item"); item.append(node("strong", null, label), node("span", null, value)); meta.append(item);
  });
  container.append(meta);
  const prompt = node("section", "input-box"); prompt.append(node("h4", null, "Public generation input"), node("p", null, example.prompt)); container.append(prompt);
  const grid = node("div", "answer-grid");
  for (const model of crystalDetailModels()) {
    const rows = data.crystal.records.filter((row) => row.model === model && row.condition === state.detail.cellId && row.sample_id === entry.id).sort((a, b) => a.sample_index - b.sample_index);
    for (const row of rows) {
      const field = CRYSTAL_METRIC_FIELDS[state.crystal.path][state.crystal.metric];
      grid.append(answerCard(model, row, {
        title: `${modelLabel(model)} · candidate ${row.sample_index}`,
        meta: `${field}=${row[field]} · direct_parse=${row.strict_parse} · stop=${row.stop_reason} · provenance=${row.response_provenance} · seed=${row.seed} · run=${row.run_id}`,
        resultLabel: row[field] === true ? "passes selected check" : "does not pass selected check",
        rawText: row.raw_text,
      }));
    }
  }
  container.append(grid);
  const gold = node("section", "gold-box cif-box");
  const details = node("details"); details.append(node("summary", null, "Show reference CIF used only for scoring"), node("pre", null, example.gold_cif));
  gold.append(node("h4", null, `Reference CIF · ${example.gold_cif_path}`), details); container.append(gold);
}

function renderDetails() {
  const valid = state.detail && state.detail.experiment === state.experiment;
  show($("detail-controls"), Boolean(valid));
  $("export-items").disabled = !valid;
  const list = $("detail-list"); clear(list);
  if (!valid) {
    setText("detail-title", "Select a chart or table cell");
    setText("detail-context", "Select any aggregate cell to inspect the item, gold answer, formal raw responses, and scoring status.");
    setText("detail-filter-note", "");
    list.append(node("div", "empty-state", "No selected cell"));
    show($("pagination"), false);
    currentDetailRows = [];
    return;
  }
  setText("detail-title", `${modelLabel(state.detail.model)} · ${state.detail.cellLabel}`);
  setText("detail-context", "The filters below affect the item list and item CSV only; they do not change the aggregate denominator above. Selected models are shown side by side.");
  let entries = detailBase().filter(detailMatches);
  currentDetailRows = entries;
  const totalBase = detailBase().length;
  setText("detail-filter-note", `${entries.length}/${totalBase} items shown · upper summary denominator remains unchanged`);
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const visible = entries.slice(start, start + PAGE_SIZE);
  if (!visible.length) list.append(node("div", "empty-state", "No items match the display filter."));
  for (const entry of visible) {
    const row = node("article", "question-row");
    const summary = node("button", "question-summary"); summary.type = "button";
    summary.setAttribute("aria-expanded", state.expanded === entry.id ? "true" : "false");
    const copy = node("span");
    const title = state.experiment === "crystal" ? `${entry.id} · ${entry.question.material_id}` : `${entry.id} · ${entry.question?.task_label || entry.focus?.pair_id || "item"}`;
    copy.append(node("strong", null, title));
    const joint = jointLabel(entry);
    copy.append(node("small", null, `${state.experiment === "crystal" ? entry.question.expanded_formula : (entry.question?.prompt || entry.focus?.original_smiles || "").slice(0, 170)}${joint ? ` · ${joint}` : ""}`));
    const statuses = node("span", "mini-statuses");
    for (const model of detailModels()) {
      const value = itemCorrect(entry, model);
      statuses.append(badge(`${modelLabel(model)}: ${value === true ? "✓" : value === false ? "×" : "N/A"}`, value === true ? "good" : value === false ? "bad" : "na"));
    }
    summary.append(copy, statuses);
    summary.addEventListener("click", () => { state.expanded = state.expanded === entry.id ? null : entry.id; renderDetails(); });
    row.append(summary);
    if (state.expanded === entry.id) {
      const detail = node("div", "question-detail");
      if (state.experiment === "qa") renderQaExpanded(entry, detail);
      else if (state.experiment === "index") renderIndexExpanded(entry, detail);
      else renderCrystalExpanded(entry, detail);
      row.append(detail);
    }
    list.append(row);
  }
  show($("pagination"), entries.length > PAGE_SIZE);
  setText("page-label", `Page ${state.page}/${pages}`);
  $("page-prev").disabled = state.page <= 1;
  $("page-next").disabled = state.page >= pages;
}

function itemExportRows() {
  if (!state.detail) return [];
  const filterJson = JSON.stringify(filterSnapshot());
  const rows = [];
  if (state.experiment === "qa") {
    for (const entry of currentDetailRows) for (const model of qaDetailModels()) {
      const result = qaResultMap.get(key(model, entry.id)); const question = entry.question;
      rows.push({
        experiment: "qa", model_alias: model, question_id: entry.id, benchmark: question.benchmark,
        task: question.task_key, chemistry_field: question.chemistry_field,
        chemistry_field_basis: question.chemistry_field_basis,
        cross_cutting_tags: question.cross_cutting_tags,
        legacy_analysis_domain: question.analysis_domain, pair_id: question.pair_id,
        protocol_correct: result?.protocol_correct, protocol_valid: result?.protocol_valid, content_match: result?.content_match,
        official_score: result?.official_score, metric: result?.metric, exact_mechanism_match: result?.exact_mechanism_match,
        S_total: result?.S_total, S_partial: result?.S_partial, V: result?.V, L: result?.L,
        status: result?.status, finish_reason: result?.finish_reason, prediction: result?.prediction,
        gold_json: question.gold, raw_text: result?.raw_text, run_id: result?.run_id, attempt_id: result?.attempt_id,
        scorer_version: result?.scorer_version, raw_path: result?.raw_path, source_id: question.source_id,
        filter_json: filterJson,
      });
    }
  } else if (state.experiment === "index") {
    const conditions = data.index.conditions.map((item) => item.id).filter((id) => state.index.conditions.has(id));
    for (const entry of currentDetailRows) for (const model of indexDetailModels()) for (const condition of conditions) {
      const result = indexRecordMap.get(key(model, entry.id, condition));
      rows.push({
        experiment: "index", model_alias: model, condition, question_id: entry.id, pair_id: result?.pair_id,
        exact_set_correct: result?.exact_set_correct, protocol_valid: result?.protocol_valid, executed: result?.executed,
        status: result?.status, prediction: result?.prediction, gold_json: result?.gold,
        raw_text: result?.raw_text, missing_reason: result?.raw_missing_reason, run_id: result?.run_id,
        attempt_id: result?.attempt_id, raw_path: result?.raw_path, filter_json: filterJson,
      });
    }
  } else {
    for (const entry of currentDetailRows) for (const model of crystalDetailModels()) {
      const records = data.crystal.records.filter((row) => row.model === model && row.condition === state.detail.cellId && row.sample_id === entry.id);
      for (const result of records) rows.push({
        experiment: "crystal", model_alias: model, condition: result.condition, sample_id: result.sample_id,
        material_id: result.material_id, candidate_index: result.sample_index, scoring_path: state.crystal.path,
        selected_metric: state.crystal.metric, selected_metric_value: result[CRYSTAL_METRIC_FIELDS[state.crystal.path][state.crystal.metric]],
        strict_parse: result.strict_parse, composition_exact: result.composition_exact, geometry_screen: result.geometry_screen,
        reference_structure_match: result.reference_structure_match, task_success: result.task_success,
        repaired_parse: result.repaired_parse, repaired_composition_exact: result.repaired_composition_exact,
        repaired_geometry_screen: result.repaired_geometry_screen, repaired_reference_structure_match: result.repaired_reference_structure_match,
        repaired_task_success: result.repaired_task_success, raw_text: result.raw_text, raw_path: result.raw_path,
        run_id: result.run_id, scorer_version: result.scorer_version, filter_json: filterJson,
      });
    }
  }
  return rows;
}

function render() {
  document.querySelectorAll(".experiment-tab").forEach((button) => {
    const active = button.dataset.experiment === state.experiment;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  show($("qa-controls"), state.experiment === "qa");
  show($("index-controls"), state.experiment === "index");
  show($("crystal-controls"), state.experiment === "crystal");
  setText("controls-title", state.experiment === "qa" ? "QA filters" : state.experiment === "index" ? "Atom-index filters" : "Crystal filters");
  setText("controls-note", state.experiment === "qa" ? "The chart, numerical table, item evidence, and exports share one selection state." : "This section has its own conditions, metrics, and denominators. Switching sections clears incompatible drill-down state.");
  if (state.experiment === "qa") updateQaControls();
  if (state.experiment === "index") updateIndexControls();
  if (state.experiment === "crystal") updateCrystalControls();
  const aggregates = activeAggregates();
  renderHeader(aggregates);
  renderChart(aggregates);
  renderSummaryTable(aggregates);
  renderDetails();
}

function bind() {
  document.querySelectorAll(".experiment-tab").forEach((button) => button.addEventListener("click", () => switchExperiment(button.dataset.experiment)));
  document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => {
    state.qa.mode = button.dataset.qaMode;
    if (state.qa.mode === "model") state.qa.modelGrouping = "chemistry";
    resetDetail(); render();
  }));
  $("qa-benchmark-focus").addEventListener("change", (event) => { state.qa.benchmarkFocus = event.target.value; state.qa.task = "all"; resetDetail(); render(); });
  $("qa-model-focus").addEventListener("change", (event) => { state.qa.modelFocus = event.target.value; resetDetail(); render(); });
  $("qa-model-grouping").addEventListener("change", (event) => { state.qa.modelGrouping = event.target.value; if (state.qa.modelGrouping === "chemistry") state.qa.field = "all"; resetDetail(); render(); });
  $("qa-compare-grouping").addEventListener("change", (event) => { state.qa.compareGrouping = event.target.value; resetDetail(); render(); });
  $("qa-domain-scope").addEventListener("change", (event) => { state.qa.domainScope = event.target.value; resetDetail(); render(); });
  $("qa-task-filter").addEventListener("change", (event) => { state.qa.task = event.target.value; resetDetail(); render(); });
  $("qa-domain-filter").addEventListener("change", (event) => { state.qa.field = event.target.value; resetDetail(); render(); });
  $("qa-metric").addEventListener("change", (event) => { state.qa.metric = event.target.value; resetDetail(); render(); });
  $("qa-chart-type").addEventListener("change", (event) => { state.qa.chart = event.target.value; render(); });
  $("qa-sort").addEventListener("change", (event) => { state.qa.sort = event.target.value; render(); });
  $("qa-models-all").addEventListener("click", () => { state.qa.models = new Set(qaModelOrder()); resetDetail(); render(); });
  $("qa-models-clear").addEventListener("click", () => { state.qa.models = new Set(); resetDetail(); render(); });
  $("qa-slices-all").addEventListener("click", () => { state.qa.slices = new Set(qaRootSlices().map((slice) => slice.id)); resetDetail(); render(); });
  $("qa-slices-clear").addEventListener("click", () => { state.qa.slices = new Set(); resetDetail(); render(); });
  $("qa-reset").addEventListener("click", resetQa);
  $("index-metric").addEventListener("change", (event) => { state.index.metric = event.target.value; resetDetail(); render(); });
  $("index-reset").addEventListener("click", resetIndex);
  $("crystal-path").addEventListener("change", (event) => { state.crystal.path = event.target.value; resetDetail(); render(); });
  $("crystal-metric").addEventListener("change", (event) => { state.crystal.metric = event.target.value; resetDetail(); render(); });
  $("crystal-unit").addEventListener("change", (event) => { state.crystal.unit = event.target.value; resetDetail(); render(); });
  $("crystal-reset").addEventListener("click", resetCrystal);
  $("detail-search").addEventListener("input", (event) => { state.detailSearch = event.target.value; state.page = 1; renderDetails(); });
  $("detail-status").addEventListener("change", (event) => { state.detailStatus = event.target.value; state.page = 1; renderDetails(); });
  $("detail-pattern").addEventListener("change", (event) => { state.detailPattern = event.target.value; state.page = 1; renderDetails(); });
  $("page-prev").addEventListener("click", () => { state.page -= 1; renderDetails(); });
  $("page-next").addEventListener("click", () => { state.page += 1; renderDetails(); });
  $("export-summary").addEventListener("click", () => exportCsv(`chemistry-explorer-${state.experiment}-summary.csv`, currentSummaryRows));
  $("export-items").addEventListener("click", () => exportCsv(`chemistry-explorer-${state.experiment}-items.csv`, itemExportRows()));
  $("export-chart").addEventListener("click", exportChart);
  $("export-filter").addEventListener("click", exportFilter);
}

function resetQa() {
  state.qa.mode = "compare"; state.qa.benchmarkFocus = "chembench_lamalab"; state.qa.modelFocus = "chemdfm_v2";
  state.qa.modelGrouping = "chemistry"; state.qa.compareGrouping = "benchmark"; state.qa.domainScope = "selected"; state.qa.models = new Set(qaModelOrder());
  state.qa.slices = new Set(qaRootSlices().map((slice) => slice.id)); state.qa.task = "all"; state.qa.field = "all";
  state.qa.metric = "protocol_correct"; state.qa.chart = "heatmap"; state.qa.sort = "fixed"; resetDetail(); render(); announce("QA view reset");
}

function resetIndex() {
  state.index.models = new Set(data.index.models); state.index.conditions = new Set(data.index.conditions.map((item) => item.id)); state.index.metric = "exact_set_correct";
  resetDetail(); render(); announce("Atom-index view reset");
}

function resetCrystal() {
  state.crystal.models = new Set(data.crystal.models.map((model) => model.id)); state.crystal.conditions = new Set(data.crystal.conditions.map((item) => item.id));
  state.crystal.path = "strict"; state.crystal.metric = "task_success"; state.crystal.unit = "candidate"; resetDetail(); render(); announce("Crystal view reset");
}

function installData(candidate) {
  if (candidate?.schema_version !== 4 || !candidate.qa || !candidate.index || !candidate.crystal) throw new Error("Expected Chemistry Benchmark Explorer schema_version 4.");
  if (candidate.qa.questions.length !== 230 || candidate.qa.results.length !== 2070 || candidate.qa.models.length !== 9) throw new Error("QA snapshot does not contain 230 questions, 2070 results, and 9 models.");
  if (candidate.index.records.length !== 90 || candidate.crystal.records.length !== 144) throw new Error("Index or crystal record count does not match the frozen scope.");
  data = candidate;
  qaQuestionMap = new Map(data.qa.questions.map((question) => [question.id, question]));
  qaResultMap = new Map(data.qa.results.map((result) => [key(result.model, result.question_id), result]));
  qaModelMap = new Map(data.qa.models.map((model) => [model.id, model]));
  qaSliceMap = new Map(data.qa.slices.map((slice) => [slice.id, slice]));
  indexRecordMap = new Map(data.index.records.map((result) => [key(result.model, result.question_id, result.condition), result]));
  crystalModelMap = new Map(data.crystal.models.map((model) => [model.id, model]));
  if (qaQuestionMap.size !== 230 || qaResultMap.size !== 2070 || indexRecordMap.size !== 90) throw new Error("Duplicate or broken derived keys.");
  state.qa.models = new Set(qaModelOrder());
  state.qa.slices = new Set(qaRootSlices().map((slice) => slice.id));
  state.index.models = new Set(data.index.models);
  state.index.conditions = new Set(data.index.conditions.map((condition) => condition.id));
  state.crystal.models = new Set(data.crystal.models.map((model) => model.id));
  state.crystal.conditions = new Set(data.crystal.conditions.map((condition) => condition.id));
  setText("data-status", "Frozen snapshot ready · 230 QA questions · 9 models · 8 benchmarks");
  setText("data-substatus", `QA 2070 rows · index 60/90 executed · crystal 144 rows · schema ${data.schema_version}`);
  bind(); render();
}

function main() {
  try {
    installData(window.CHEM_EXPLORER_DATA);
  } catch (error) {
    show($("load-error"), true);
    setText("load-error", `Could not load the packaged snapshot: ${error.message}. Rebuild with python3 build_data.py and keep the data folder beside index.html.`);
    console.error(error);
  }
}

main();
