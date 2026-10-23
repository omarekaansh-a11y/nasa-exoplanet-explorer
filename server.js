"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 8000);
const TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";
const CACHE_TTL_MS = 15 * 60 * 1000;
const COLUMNS = ["pl_name", "pl_rade", "pl_insol", "st_teff", "sy_dist"];
const OPTIONAL_COLUMNS = ["pl_eqt"];
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

let cached = null;
let refreshedAt = 0;
let refreshInFlight = null;

function parseCsvRow(text) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  fields.push(value);
  return fields;
}

function parseCsv(csv) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("NASA returned an empty planet table.");
  const headers = parseCsvRow(lines[0]);
  const indexes = Object.fromEntries(headers.map((name, index) => [name, index]));
  for (const column of COLUMNS) {
    if (indexes[column] === undefined) throw new Error(`NASA response is missing ${column}.`);
  }

  return lines.slice(1).map((line) => {
    const cells = parseCsvRow(line);
    const planet = { name: cells[indexes.pl_name] };
    for (const key of COLUMNS.slice(1)) planet[key] = Number(cells[indexes[key]]);
    for (const key of OPTIONAL_COLUMNS) {
      const index = indexes[key];
      const value = index === undefined ? NaN : Number(cells[index]);
      planet[key] = Number.isFinite(value) && value > 0 ? value : null;
    }
    return planet;
  });
}

function isUsable(planet) {
  return typeof planet.name === "string" && planet.name.length > 0
    && [planet.pl_rade, planet.pl_insol, planet.st_teff, planet.sy_dist]
      .every((value) => Number.isFinite(value) && value > 0);
}

function candidateScore(planet) {
  return Math.abs(Math.log2(planet.pl_insol)) + Math.abs(planet.pl_rade - 1);
}

function toPublicPlanet(planet, rank) {
  const score = candidateScore(planet);
  return {
    rank,
    name: planet.name,
    rating: Math.round((10 / (1 + score)) * 10) / 10,
    radiusEarth: planet.pl_rade,
    insolationEarth: planet.pl_insol,
    planetTemperatureK: planet.pl_eqt,
    stellarTemperatureK: planet.st_teff,
    distanceParsecs: planet.sy_dist,
  };
}

function buildDataset(raw, sourceRows) {
  const clean = raw.filter(isUsable);
  const candidates = clean
    .filter((planet) => planet.pl_rade >= 0.5 && planet.pl_rade <= 1.6
      && planet.pl_insol >= 0.25 && planet.pl_insol <= 2.25)
    .sort((a, b) => candidateScore(a) - candidateScore(b));
  const ranked = candidates.map((planet, index) => toPublicPlanet(planet, index + 1));
  return {
    totalRows: sourceRows,
    usableRows: clean.length,
    candidates: ranked,
    allPlanets: clean,
  };
}

async function loadDataset(force = false) {
  if (!force && cached && Date.now() - refreshedAt < CACHE_TTL_MS) return cached;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const query = "select pl_name,pl_rade,pl_insol,pl_eqt,st_teff,sy_dist from pscomppars";
      const url = `${TAP_URL}?${new URLSearchParams({ query, format: "csv" })}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`NASA TAP returned HTTP ${response.status}.`);
      const raw = parseCsv(await response.text());
      const fresh = buildDataset(raw, raw.length);
      if (fresh.candidates.length === 0) throw new Error("No planets matched the project’s current screen.");
      cached = fresh;
      refreshedAt = Date.now();
      return cached;
    })().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function parseRankQuery(query) {
  const match = query.trim().match(/^(?:rank\s*|#\s*)?(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function lookupPlanet(dataset, query) {
  const requested = query.trim();
  const rank = parseRankQuery(requested);
  if (rank !== null) {
    const result = dataset.candidates[rank - 1];
    return result
      ? { found: true, eligible: true, planet: result, totalCandidates: dataset.candidates.length }
      : { found: false, message: `Rank ${rank} is outside the candidate list, which contains ${dataset.candidates.length} planets.` };
  }

  const normalized = requested.toLocaleLowerCase();
  const exact = dataset.allPlanets.filter((planet) => planet.name.toLocaleLowerCase() === normalized);
  const matches = exact.length ? exact : dataset.allPlanets.filter((planet) => planet.name.toLocaleLowerCase().includes(normalized));
  if (!matches.length) return { found: false, message: `No NASA Archive planet matched “${requested}”. Check the spelling or try a candidate rank.` };
  if (matches.length > 1) {
    return { found: false, ambiguous: true, suggestions: matches.slice(0, 6).map((planet) => planet.name) };
  }

  const planet = matches[0];
  const candidate = dataset.candidates.find((item) => item.name === planet.name);
  if (candidate) return { found: true, eligible: true, planet: candidate, totalCandidates: dataset.candidates.length };
  return {
    found: true,
    eligible: false,
    name: planet.name,
    radiusEarth: planet.pl_rade,
    insolationEarth: planet.pl_insol,
    planetTemperatureK: planet.pl_eqt,
    message: "This planet is in the NASA table but outside the project’s current candidate filters, so it has no shortlist rank or rating.",
  };
}

function safeFilePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  } catch {
    return null;
  }
  const publicFiles = new Set([
    "/index.html",
    "/styles.css",
    "/script.js",
    "/assets/blueprint-lines.png",
    "/assets/fonts/Aileron-Regular.woff2",
  ]);
  if (!publicFiles.has(decoded)) return null;
  const fullPath = path.resolve(ROOT, `.${decoded}`);
  return fullPath.startsWith(`${ROOT}${path.sep}`) ? fullPath : null;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end("Method not allowed");
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    try {
      const dataset = await loadDataset(url.pathname === "/api/refresh");
      const updatedAt = new Date(refreshedAt).toISOString();
      if (url.pathname === "/api/rankings" || url.pathname === "/api/refresh") {
        sendJson(response, 200, {
          source: "NASA Exoplanet Archive pscomppars",
          updatedAt,
          totalRows: dataset.totalRows,
          usableRows: dataset.usableRows,
          candidateCount: dataset.candidates.length,
          top15: dataset.candidates.slice(0, 15),
          candidates: dataset.candidates,
          allPlanets: dataset.allPlanets,
        });
        return;
      }
      if (url.pathname === "/api/lookup") {
        const query = (url.searchParams.get("q") || "").slice(0, 120);
        if (!query.trim()) {
          sendJson(response, 400, { error: "Enter a planet name or rank." });
          return;
        }
        sendJson(response, 200, { ...lookupPlanet(dataset, query), updatedAt });
        return;
      }
      sendJson(response, 404, { error: "API route not found." });
      return;
    } catch (error) {
      sendJson(response, 502, {
        error: "The NASA Archive could not be reached. Try refreshing in a moment.",
        detail: error.message,
      });
      return;
    }
  }

  const filePath = safeFilePath(url.pathname);
  if (!filePath) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(contents);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Exoplanet Explorer is serving on http://${HOST}:${PORT}`);
  console.log("Ranking data is fetched from NASA TAP and refreshed every 15 minutes.");
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

