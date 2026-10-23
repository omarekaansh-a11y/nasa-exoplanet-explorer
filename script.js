"use strict";

const dataStatus = document.querySelector("#data-status");
const rankingChart = document.querySelector("#ranking-chart");
const scatterChart = document.querySelector("#scatter-chart");
const wireframeChart = document.querySelector("#wireframe-chart");
const archiveScaleChart = document.querySelector("#archive-scale-chart");
const updatedAt = document.querySelector("#updated-at");
const tooltip = document.querySelector("#chart-tooltip");
const archiveScaleCount = document.querySelector("#archive-scale-count");
const summaryScreened = document.querySelector("#summary-screened");
const summaryArchive = document.querySelector("#summary-archive");
const summaryYield = document.querySelector("#summary-yield");

let candidates = [];
let wireframeView = { yaw: -0.55, pitch: 0.62 };
let wireframeDrag = null;
const wireframeReset = document.querySelector("#wireframe-reset");

wireframeChart.addEventListener("pointerdown", (event) => {
  if (candidates.length < 3 || event.target.closest("#wireframe-reset") || (event.pointerType !== "touch" && event.button !== 0)) return;
  wireframeDrag = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    moved: false,
  };
  wireframeChart.classList.add("is-dragging");
});

window.addEventListener("pointermove", (event) => {
  if (!wireframeDrag || event.pointerId !== wireframeDrag.pointerId) return;
  const dx = event.clientX - wireframeDrag.lastX;
  const dy = event.clientY - wireframeDrag.lastY;
  wireframeDrag.lastX = event.clientX;
  wireframeDrag.lastY = event.clientY;
  if (!wireframeDrag.moved && Math.hypot(event.clientX - wireframeDrag.startX, event.clientY - wireframeDrag.startY) > 4) {
    wireframeDrag.moved = true;
    hideTooltip();
  }
  if (!wireframeDrag.moved) return;
  wireframeView.yaw += dx * 0.008;
  if (wireframeDrag.pointerType !== "touch") {
    wireframeView.pitch = Math.max(-1.15, Math.min(1.15, wireframeView.pitch + dy * 0.008));
  }
  renderWireframe(candidates);
}, { passive: false });

function endWireframeDrag(event) {
  if (!wireframeDrag || (event && event.pointerId !== wireframeDrag.pointerId)) return;
  wireframeDrag = null;
  wireframeChart.classList.remove("is-dragging");
}

window.addEventListener("pointerup", endWireframeDrag);
window.addEventListener("pointercancel", endWireframeDrag);

wireframeChart.addEventListener("keydown", (event) => {
  const rotations = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] };
  const rotation = rotations[event.key];
  if (!rotation || candidates.length < 3 || event.target.closest("button")) return;
  event.preventDefault();
  wireframeView.yaw += rotation[0];
  wireframeView.pitch = Math.max(-1.15, Math.min(1.15, wireframeView.pitch + rotation[1]));
  renderWireframe(candidates);
});

wireframeReset.addEventListener("click", () => {
  if (candidates.length < 3) return;
  wireframeView = { yaw: -0.55, pitch: 0.62 };
  renderWireframe(candidates);
});

function formatNumber(value, digits = 2) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function updateStatus(message) {
  dataStatus.textContent = message;
}

function showMessage(target, message, withRetry = false) {
  const notice = document.createElement("div");
  notice.className = "error-state";
  const text = document.createElement("p");
  text.textContent = message;
  notice.append(text);
  if (withRetry) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => loadRankings(true));
    notice.append(retry);
  }
  target.replaceChildren(notice);
}

async function loadRankings(force = false) {
  updateStatus(force ? "Refreshing NASA data" : "Connecting to NASA data", "loading");
  rankingChart.innerHTML = '<p class="loading-state">Fetching current measurements from NASA’s Exoplanet Archive…</p>';
  scatterChart.innerHTML = '<p class="loading-state">Preparing measurement chart…</p>';
  wireframeChart.innerHTML = '<p class="loading-state">Preparing 3D wireframe…</p>';
  archiveScaleChart.innerHTML = '<p class="loading-state">Preparing NASA archive overview…</p>';

  let payload;
  try {
    const response = await fetch(force ? "/api/refresh" : "/api/rankings", { cache: "no-store" });
    payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load rankings.");
    if (!Array.isArray(payload.top15) || !Array.isArray(payload.candidates) || !Array.isArray(payload.allPlanets)) {
      throw new Error("The data service returned an unexpected response.");
    }
  } catch (error) {
    console.error("NASA data request failed:", error);
    updateStatus("NASA data unavailable", "error");
    showMessage(rankingChart, error.message || "NASA data could not be loaded.", true);
    showMessage(scatterChart, "Chart unavailable until NASA data loads.");
    showMessage(wireframeChart, "Wireframe unavailable until NASA data loads.");
    showMessage(archiveScaleChart, "Archive overview unavailable until NASA data loads.");
    return;
  }

  candidates = payload.candidates;
  archiveScaleCount.textContent = `${payload.usableRows.toLocaleString()} usable records · ${candidates.length} screened`;
  summaryScreened.textContent = String(candidates.length).padStart(2, "0");
  summaryArchive.textContent = payload.usableRows.toLocaleString();
  summaryYield.textContent = `${((candidates.length / payload.usableRows) * 100).toFixed(2)}%`;
  updatedAt.textContent = `NASA data refreshed ${new Date(payload.updatedAt).toLocaleString()}`;
  updateStatus("NASA data live", "live");

  try {
    renderRanking(payload.top15.slice(0, 10));
  } catch (error) {
    console.error("Ranking chart render failed:", error);
    showMessage(rankingChart, "The ranking view could not be drawn. Reload the page to try again.");
  }

  try {
    renderScatter(candidates);
  } catch (error) {
    console.error("Measurement chart render failed:", error);
    showMessage(scatterChart, "The measurement chart could not be drawn.");
  }

  try {
    renderArchiveScale(payload.allPlanets, candidates);
  } catch (error) {
    console.error("Archive scale chart render failed:", error);
    showMessage(archiveScaleChart, "The archive overview could not be drawn.");
  }

  try {
    renderWireframe(candidates);
  } catch (error) {
    console.error("3D wireframe render failed:", error);
    showMessage(wireframeChart, "The 3D measurement view could not be drawn.");
  }

}

function renderArchiveScale(allPlanets, screened) {
  const width = 1200;
  const height = 430;
  const margin = { top: 22, right: 28, bottom: 62, left: 82 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const positive = allPlanets.filter((planet) => Number.isFinite(planet.pl_insol) && planet.pl_insol > 0 && Number.isFinite(planet.pl_rade) && planet.pl_rade > 0);
  const xValues = positive.map((planet) => planet.pl_insol);
  const yValues = positive.map((planet) => planet.pl_rade);
  const xMin = Math.max(1e-5, Math.min(...xValues));
  const xMax = Math.max(...xValues);
  const yMin = Math.max(0.03, Math.min(...yValues));
  const yMax = Math.max(...yValues);
  const x = (value) => margin.left + ((Math.log10(value) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * plotWidth;
  const y = (value) => margin.top + ((Math.log10(yMax) - Math.log10(value)) / (Math.log10(yMax) - Math.log10(yMin))) * plotHeight;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "archive-scale-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-labelledby", "archive-scale-svg-title archive-scale-svg-desc");
  const title = document.createElementNS(ns, "title");
  title.id = "archive-scale-svg-title";
  title.textContent = "Scale of NASA exoplanet archive data compared with screened planets";
  const desc = document.createElementNS(ns, "desc");
  desc.id = "archive-scale-svg-desc";
  desc.textContent = `Logarithmic radius and stellar energy chart showing ${positive.length} usable NASA archive planets in muted blue, with ${screened.length} screened planets highlighted in amber and Earth marked in red.`;
  svg.append(title, desc);
  const addLine = (x1, y1, x2, y2, className) => {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("class", className);
    svg.append(line);
  };
  const addText = (value, tx, ty, className, anchor = "middle") => {
    const text = document.createElementNS(ns, "text");
    text.textContent = value;
    text.setAttribute("x", tx); text.setAttribute("y", ty);
    text.setAttribute("class", className);
    text.setAttribute("text-anchor", anchor);
    svg.append(text);
    return text;
  };
  const xTicks = [1e-4, 1e-2, 1, 100, 10000].filter((v) => v >= xMin && v <= xMax);
  const yTicks = [0.1, 0.3, 1, 3, 10, 30, 100].filter((v) => v >= yMin && v <= yMax);
  xTicks.forEach((tick) => {
    const px = x(tick);
    addLine(px, margin.top, px, height - margin.bottom, "scatter-grid");
    addText(`10${String(Math.round(Math.log10(tick))).replace("-", "−")}`, px, height - margin.bottom + 20, "scatter-tick");
  });
  yTicks.forEach((tick) => {
    const py = y(tick);
    addLine(margin.left, py, width - margin.right, py, "scatter-grid");
    addText(`10${String(Math.round(Math.log10(tick))).replace("-", "−")}`, margin.left - 12, py + 4, "scatter-tick", "end");
  });
  addLine(margin.left, margin.top, margin.left, height - margin.bottom, "scatter-axis");
  addLine(margin.left, height - margin.bottom, width - margin.right, height - margin.bottom, "scatter-axis");
  addText("PLANET RADIUS · EARTH = 1 · LOG SCALE", 14, margin.top + plotHeight / 2, "scatter-label scatter-label-y")
    .setAttribute("transform", `rotate(-90 14 ${margin.top + plotHeight / 2})`);
  addText("STELLAR ENERGY · EARTH = 1 · LOG SCALE", margin.left + plotWidth / 2, height - 8, "scatter-label scatter-label-x");

  positive.forEach((planet) => {
    const point = document.createElementNS(ns, "circle");
    point.setAttribute("cx", x(planet.pl_insol));
    point.setAttribute("cy", y(planet.pl_rade));
    point.setAttribute("r", "2.8");
    point.setAttribute("class", "archive-planet");
    svg.append(point);
  });
  screened.forEach((planet) => {
    const point = document.createElementNS(ns, "circle");
    point.setAttribute("cx", x(planet.insolationEarth));
    point.setAttribute("cy", y(planet.radiusEarth));
    point.setAttribute("r", "5.5");
    point.setAttribute("class", "archive-screened");
    point.setAttribute("aria-label", `${planet.name}, screened candidate`);
    const pointTitle = document.createElementNS(ns, "title");
    pointTitle.textContent = `${planet.name} · screened candidate · radius ${formatNumber(planet.radiusEarth)} Earth · energy ${formatNumber(planet.insolationEarth)} Earth`;
    point.append(pointTitle);
    svg.append(point);
  });
  const earth = document.createElementNS(ns, "circle");
  earth.setAttribute("cx", x(1)); earth.setAttribute("cy", y(1));
  earth.setAttribute("r", "7"); earth.setAttribute("class", "earth-reference-dot");
  const earthTitle = document.createElementNS(ns, "title");
  earthTitle.textContent = "Earth reference";
  earth.append(earthTitle);
  svg.append(earth);
  archiveScaleChart.replaceChildren(svg);
}

function renderRanking(planets) {
  rankingChart.replaceChildren();
  planets.forEach((planet) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.setAttribute("role", "listitem");
    row.dataset.rank = planet.rank;
    const temperatureText = Number.isFinite(planet.planetTemperatureK) ? `${formatNumber(planet.planetTemperatureK, 0)} K` : "not reported";
    row.setAttribute("aria-label", `Rank ${planet.rank}, ${planet.name}, ${planet.rating} out of 10. Radius ${formatNumber(planet.radiusEarth)} Earth radii. Stellar energy ${formatNumber(planet.insolationEarth)} times Earth. Planet equilibrium temperature ${temperatureText}.`);
    row.title = `${planet.name} · ${planet.rating}/10 · radius ${formatNumber(planet.radiusEarth)} Earth · energy ${formatNumber(planet.insolationEarth)} Earth · planet temperature ${temperatureText}`;

    const rank = document.createElement("span");
    rank.className = "rank-number";
    rank.textContent = String(planet.rank).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "rank-name";
    name.textContent = planet.name;
    const measurements = document.createElement("span");
    measurements.className = "rank-measurements";
    measurements.textContent = `RADIUS ${formatNumber(planet.radiusEarth)} R⊕ · ENERGY ${formatNumber(planet.insolationEarth)}× EARTH · PLANET TEMP ${temperatureText}`;
    const labels = document.createElement("span");
    labels.className = "rank-labels";
    labels.append(name, measurements);
    const track = document.createElement("span");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    fill.style.setProperty("--bar-width", `${planet.rating * 10}%`);
    track.append(fill);
    const rating = document.createElement("span");
    rating.className = "rank-rating";
    rating.textContent = `${planet.rating.toFixed(1)}/10`;

    row.append(rank, labels, track, rating);
    rankingChart.append(row);
  });
}

function renderScatter(data) {
  const width = 900;
  const height = 760;
  const margin = { top: 30, right: 38, bottom: 82, left: 88 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const minInsolation = 0.25;
  const maxInsolation = 2.25;
  const minRadius = 0.5;
  const maxRadius = 1.6;
  const x = (value) => margin.left + (Math.log(value / minInsolation) / Math.log(maxInsolation / minInsolation)) * plotWidth;
  const y = (value) => margin.top + ((maxRadius - value) / (maxRadius - minRadius)) * plotHeight;
  const xTicks = [0.25, 0.5, 1, 2, 2.25];
  const yTicks = [0.5, 0.8, 1.0, 1.2, 1.6];
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "scatter-svg");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-labelledby", "scatter-svg-title scatter-svg-desc");
  const title = document.createElementNS(ns, "title");
  title.id = "scatter-svg-title";
  title.textContent = "Candidate planet radius and stellar energy";
  const desc = document.createElementNS(ns, "desc");
  desc.id = "scatter-svg-desc";
  desc.textContent = "Each circle is one planet that passed the current screen. Stellar energy is logarithmic. The top ten planets are gold and Earth is marked in red. Hover or focus a circle for its rank and measurements.";
  svg.append(title, desc);

  const addLine = (x1, y1, x2, y2, className) => {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("class", className);
    svg.append(line);
  };
  const addText = (value, tx, ty, className, anchor = "middle") => {
    const text = document.createElementNS(ns, "text");
    text.textContent = value;
    text.setAttribute("x", tx); text.setAttribute("y", ty);
    text.setAttribute("class", className);
    text.setAttribute("text-anchor", anchor);
    svg.append(text);
    return text;
  };

  yTicks.forEach((tick) => {
    const py = y(tick);
    addLine(margin.left, py, width - margin.right, py, "scatter-grid");
    addText(tick.toFixed(1), margin.left - 12, py + 4, "scatter-tick", "end");
  });
  xTicks.forEach((tick) => {
    const px = x(tick);
    addLine(px, margin.top, px, height - margin.bottom, "scatter-grid");
    addText(String(tick), px, height - margin.bottom + 20, "scatter-tick");
  });
  addLine(margin.left, margin.top, margin.left, height - margin.bottom, "scatter-axis");
  addLine(margin.left, height - margin.bottom, width - margin.right, height - margin.bottom, "scatter-axis");
  addText("PLANET RADIUS · EARTH = 1", 14, margin.top + plotHeight / 2, "scatter-label scatter-label-y", "middle")
    .setAttribute("transform", `rotate(-90 14 ${margin.top + plotHeight / 2})`);
  addText("STELLAR ENERGY · EARTH = 1 · LOG SCALE", margin.left + plotWidth / 2, height - 10, "scatter-label scatter-label-x");

  const earthX = x(1);
  const earthY = y(1);
  data.forEach((planet) => {
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", x(planet.insolationEarth));
    circle.setAttribute("cy", y(planet.radiusEarth));
    const isTopRanked = Number(planet.rank) <= 10;
    circle.setAttribute("r", isTopRanked ? "7" : "5.5");
    circle.setAttribute("class", `scatter-candidate${isTopRanked ? " is-top-ranked" : ""}`);
    circle.setAttribute("tabindex", "0");
    circle.setAttribute("role", "img");
    circle.setAttribute("aria-label", `Rank ${planet.rank}: ${planet.name}, ${planet.rating} out of 10. Radius ${formatNumber(planet.radiusEarth)} Earth; stellar energy ${formatNumber(planet.insolationEarth)} Earth.`);
    circle.dataset.rank = planet.rank;
    const pointTitle = document.createElementNS(ns, "title");
    pointTitle.textContent = `${planet.name} · rank ${planet.rank} · ${planet.rating}/10`;
    circle.append(pointTitle);
    circle.addEventListener("pointerenter", (event) => showTooltip(event, planet));
    circle.addEventListener("pointermove", moveTooltip);
    circle.addEventListener("pointerleave", hideTooltip);
    circle.addEventListener("focus", (event) => showTooltip(event, planet));
    circle.addEventListener("blur", hideTooltip);
    svg.append(circle);
  });
  const earth = document.createElementNS(ns, "circle");
  earth.setAttribute("cx", earthX);
  earth.setAttribute("cy", earthY);
  earth.setAttribute("r", "8");
  earth.setAttribute("class", "earth-reference-dot");
  earth.setAttribute("role", "img");
  earth.setAttribute("aria-label", "Earth reference: radius 1 Earth and stellar energy 1 Earth.");
  svg.append(earth);
  addText("Earth", earthX + 12, earthY - 9, "scatter-tick", "start");
  scatterChart.replaceChildren(svg);
}

function renderWireframe(data) {
  const width = 860;
  const height = 650;
  const center = { x: width / 2, y: height / 2 + 10 };
  const scale = 400;
  const yawCos = Math.cos(wireframeView.yaw);
  const yawSin = Math.sin(wireframeView.yaw);
  const pitchCos = Math.cos(wireframeView.pitch);
  const pitchSin = Math.sin(wireframeView.pitch);
  const measured = data.filter((planet) => Number.isFinite(planet.planetTemperatureK) && planet.planetTemperatureK > 0);
  if (measured.length < 3) throw new Error("Not enough planet equilibrium temperatures are available to draw the surface.");
  const temperatureMin = Math.min(...measured.map((planet) => planet.planetTemperatureK));
  const temperatureMax = Math.max(...measured.map((planet) => planet.planetTemperatureK));
  const temperatureSpan = Math.max(1, temperatureMax - temperatureMin);
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const energyCoordinate = (energy) => clamp(Math.log(energy / 0.25) / Math.log(2.25 / 0.25));
  const radiusCoordinate = (radius) => clamp((radius - 0.5) / (1.6 - 0.5));
  const temperatureCoordinate = (temperature) => clamp((temperature - temperatureMin) / temperatureSpan);
  const project = (x, y, z) => {
    const worldX = (x - 0.5) * 1.2;
    const worldY = (y - 0.5) * 0.88;
    const worldZ = (z - 0.5) * 0.94;
    const rotatedX = worldX * yawCos - worldY * yawSin;
    const rotatedY = worldX * yawSin + worldY * yawCos;
    const vertical = rotatedY * pitchSin + worldZ * pitchCos;
    return { x: center.x + rotatedX * scale, y: center.y - vertical * scale };
  };
  const estimateTemperature = (x, y) => {
    const neighbors = measured.map((planet) => {
      const dx = x - energyCoordinate(planet.insolationEarth);
      const dy = y - radiusCoordinate(planet.radiusEarth);
      return { planet, distanceSquared: dx * dx + dy * dy };
    });
    let weightedTemperature = 0;
    let totalWeight = 0;
    neighbors.forEach(({ planet, distanceSquared }) => {
      const weight = 1 / Math.pow(distanceSquared + 0.03, 0.65);
      weightedTemperature += planet.planetTemperatureK * weight;
      totalWeight += weight;
    });
    return weightedTemperature / totalWeight;
  };
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "wireframe-svg");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-labelledby", "wireframe-title wireframe-desc");
  const title = document.createElementNS(ns, "title");
  title.id = "wireframe-title";
  title.textContent = "Interpolated wireframe of candidate planet equilibrium temperatures";
  const desc = document.createElementNS(ns, "desc");
  desc.id = "wireframe-desc";
  desc.textContent = `Interpolated surface of planet equilibrium temperature in Kelvin across stellar energy and planet radius, using ${measured.length} screened planets with reported values. The blue mesh is inverse distance weighted interpolation. All ${data.length} screened planets appear in both charts; those without reported temperatures use the interpolated surface height and are identified as unreported in their details. The top ten are highlighted in amber, with Earth shown in red. Hover or focus a marker for details.`;
  svg.append(title, desc);

  const addLabel = (value, x, y, className = "wireframe-tick", anchor = "middle") => {
    const label = document.createElementNS(ns, "text");
    label.textContent = value;
    label.setAttribute("x", x);
    label.setAttribute("y", y);
    label.setAttribute("class", className);
    label.setAttribute("text-anchor", anchor);
    svg.append(label);
    return label;
  };

  const gridSize = 9;
  const surfacePoints = Array.from({ length: gridSize }, (_, row) => (
    Array.from({ length: gridSize }, (_, column) => {
      const x = column / (gridSize - 1);
      const y = row / (gridSize - 1);
      const z = temperatureCoordinate(estimateTemperature(x, y));
      return project(x, y, z);
    })
  ));
  const addSurfacePath = (points, direction) => {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("class", `wireframe-surface-line wireframe-${direction}`);
    path.setAttribute("d", points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "));
    svg.append(path);
  };
  surfacePoints.forEach((row) => addSurfacePath(row, "energy-line"));
  for (let column = 0; column < gridSize; column += 1) {
    addSurfacePath(surfacePoints.map((row) => row[column]), "radius-line");
  }

  const axisOrigin = project(0, 0, 0);
  const energyEnd = project(1, 0, 0);
  const radiusEnd = project(0, 1, 0);
  const temperatureEnd = project(0, 0, 1);
  [[axisOrigin, energyEnd], [axisOrigin, radiusEnd], [axisOrigin, temperatureEnd]].forEach(([start, end]) => {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", end.x);
    line.setAttribute("y2", end.y);
    line.setAttribute("class", "wireframe-edge");
    svg.append(line);
  });

  [0.25, 0.5, 1, 2.25].forEach((value) => {
    const point = project(energyCoordinate(value), 0, 0);
    addLabel(String(value), point.x + 3, point.y + 14, "wireframe-index");
  });
  [0.5, 0.8, 1.2, 1.6].forEach((value) => {
    const point = project(0, radiusCoordinate(value), 0);
    addLabel(value.toFixed(1), point.x - 7, point.y + 10, "wireframe-index", "end");
  });
  [0, 0.5, 1].forEach((step) => {
    const value = temperatureMin + temperatureSpan * step;
    const point = project(0, 0, step);
    addLabel(`${Math.round(value)} K`, point.x - 10, point.y + 3, "wireframe-index", "end");
  });
  addLabel(`${data.length} PLANETS · TOP 10 HIGHLIGHTED`, width - 10, 16, "wireframe-tick", "end");

  data.forEach((planet) => {
    const energy = energyCoordinate(planet.insolationEarth);
    const radius = radiusCoordinate(planet.radiusEarth);
    // Place each marker on the interpolated surface while keeping its reported
    // temperature in the tooltip and accessible label.
    const point = project(energy, radius, temperatureCoordinate(estimateTemperature(energy, radius)));
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", point.x);
    circle.setAttribute("cy", point.y);
    const isTopRanked = Number(planet.rank) <= 10;
    circle.setAttribute("r", isTopRanked ? "5.5" : "4.2");
    circle.setAttribute("class", `wireframe-candidate${isTopRanked ? " is-top-ranked" : ""}`);
    circle.setAttribute("tabindex", "0");
    circle.setAttribute("role", "img");
    const temperatureLabel = Number.isFinite(planet.planetTemperatureK) ? `${formatNumber(planet.planetTemperatureK, 0)} Kelvin` : "temperature not reported";
    circle.setAttribute("aria-label", `Rank ${planet.rank}: ${planet.name}, ${planet.rating} out of 10. Radius ${formatNumber(planet.radiusEarth)} Earth; stellar energy ${formatNumber(planet.insolationEarth)} Earth; planet equilibrium temperature ${temperatureLabel}.`);
    circle.dataset.rank = planet.rank;
    const pointTitle = document.createElementNS(ns, "title");
    pointTitle.textContent = `Rank ${planet.rank} · ${planet.name} · ${Number.isFinite(planet.planetTemperatureK) ? `${formatNumber(planet.planetTemperatureK, 0)} K reported` : "temperature not reported"} · ${planet.rating}/10`;
    circle.append(pointTitle);
    circle.addEventListener("pointerenter", (event) => showTooltip(event, planet));
    circle.addEventListener("pointermove", moveTooltip);
    circle.addEventListener("pointerleave", hideTooltip);
    circle.addEventListener("focus", (event) => showTooltip(event, planet));
    circle.addEventListener("blur", hideTooltip);
    svg.append(circle);
  });
  const earthEnergy = energyCoordinate(1);
  const earthRadius = radiusCoordinate(1);
  const earthPoint = project(earthEnergy, earthRadius, temperatureCoordinate(255));
  const earthMarker = document.createElementNS(ns, "circle");
  earthMarker.setAttribute("cx", earthPoint.x);
  earthMarker.setAttribute("cy", earthPoint.y);
  earthMarker.setAttribute("r", "8");
  earthMarker.setAttribute("class", "wireframe-earth");
  earthMarker.setAttribute("role", "img");
  earthMarker.setAttribute("aria-label", "Earth reference: radius 1 Earth, stellar energy 1 Earth, equilibrium temperature about 255 Kelvin.");
  svg.append(earthMarker);
  addLabel("EARTH", earthPoint.x + 12, earthPoint.y - 10, "wireframe-tick", "start");

  wireframeChart.replaceChildren(svg);
}

function showTooltip(event, planet) {
  const title = document.createElement("strong");
  title.className = "tooltip-title";
  title.textContent = planet.name;
  const rank = document.createElement("span");
  rank.className = "tooltip-rank";
  rank.textContent = `RANK ${String(planet.rank).padStart(2, "0")} · ${planet.rating.toFixed(1)}/10 EARTH SIMILARITY`;
  const measurements = document.createElement("span");
  measurements.className = "tooltip-measurements";
  const temperature = Number.isFinite(planet.planetTemperatureK) ? `Planet ${formatNumber(planet.planetTemperatureK, 0)} K` : "Planet temperature not reported";
  measurements.textContent = `Radius ${formatNumber(planet.radiusEarth)} Earth · Energy ${formatNumber(planet.insolationEarth)} Earth · ${temperature} · Star ${formatNumber(planet.stellarTemperatureK, 0)} K · Distance ${formatNumber(planet.distanceParsecs)} pc`;
  tooltip.replaceChildren(title, rank, measurements);
  tooltip.hidden = false;
  if (event.clientX !== undefined) moveTooltip(event);
  else {
    const box = event.currentTarget.getBoundingClientRect();
    positionTooltip(box.left + box.width / 2, box.top + box.height / 2);
  }
}

function moveTooltip(event) {
  positionTooltip(event.clientX, event.clientY);
}

function positionTooltip(x, y) {
  const box = tooltip.getBoundingClientRect();
  const left = Math.max(12, Math.min(x + 16, window.innerWidth - box.width - 12));
  const top = Math.max(12, Math.min(y - box.height - 16, window.innerHeight - box.height - 12));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() { tooltip.hidden = true; }

loadRankings();

