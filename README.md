# Worlds Worth a Closer Look

**Project name:** Worlds Worth a Closer Look, an Exoplanet Explorer

An interactive, one page research screening tool built around current measurements from NASA's Exoplanet Archive. It compares planet radius and received stellar energy with Earth, ranks a small set of worlds for further investigation, and visualizes both the screened sample and the larger archive context.

> This is an exploratory comparison, not a habitability classifier. The displayed rating is a transparent transformation of two measurements. It is not a probability, model confidence, or claim that a planet can support life.

## Website

**Live website:** Deployment is pending. The project has not yet been published to a public hosting URL.

**Run locally:** [http://127.0.0.1:8000](http://127.0.0.1:8000) after starting the server using the instructions below. This address is local to the computer running the server and is not a public website link.

## Objectives

* Retrieve real, current exoplanet measurements from NASA's Planetary Systems Composite Parameters table.
* Clean observations that are incomplete or physically invalid for this screen.
* Apply a clearly stated radius and stellar energy screen and rank qualifying planets by similarity to Earth's radius and insolation.
* Show the top ten candidates, a search by candidate rank or planet name, and interactive charts that make the screened sample legible beside the full usable archive.
* Communicate source, units, data freshness, assumptions, and scientific limitations on the page.

## Current snapshot and findings

The server retrieved the live NASA table on **23 October 2026 at 00:12 UTC**. That response contained **6,451** table rows. **5,752** rows had complete, positive values for the fields required by this project's screen. **45** planets passed the current radius and insolation filters.

The top ranked object in that snapshot was **Teegarden's Star b**, with a radius of **1.05 Earth radii**, stellar insolation of **1.08 times Earth's**, and a displayed rating of **8.6/10**. The next highest were **TRAPPIST-1 d** at **7.3/10**, **TOI-700 d** at **7.2/10**, and **TOI-700 e** at **7.0/10**.

| Rank | Planet | Radius (Earth radii) | Insolation (Earth = 1) | Equilibrium temperature (K) | Rating |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | Teegarden's Star b | 1.050 | 1.080 | 277.0 | 8.6/10 |
| 2 | TRAPPIST-1 d | 0.788 | 1.115 | 286.2 | 7.3/10 |
| 3 | TOI-700 d | 1.145 | 0.850 | 268.8 | 7.2/10 |
| 4 | TOI-700 e | 0.919 | 1.270 | 272.9 | 7.0/10 |
| 5 | GJ 3378 b | 1.320 | 0.910 | 272.0 | 6.9/10 |
| 6 | Kepler-1649 c | 1.060 | 0.750 | 234.0 | 6.8/10 |
| 7 | LP 890-9 c | 1.367 | 0.906 | 272.0 | 6.6/10 |
| 8 | K2-72 e | 1.290 | 1.200 | 286.3 | 6.4/10 |
| 9 | Ross 128 b | 1.110 | 1.380 | 301.0 | 6.4/10 |
| 10 | GJ 273 b | 1.510 | 1.060 | 292.5 | 6.3/10 |

This is a dated snapshot of a live table, not a frozen dataset. NASA may revise values and the set of available records, so later refreshes can change counts, order, and ratings. The interface refreshes its server cache every fifteen minutes.

## Data and exact sources

The application requests these columns from NASA's `pscomppars` table:

```sql
select pl_name, pl_rade, pl_insol, pl_eqt, st_teff, sy_dist from pscomppars
```

The request is made to the NASA Exoplanet Archive TAP synchronous endpoint with CSV output:

```text
https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+pl_name%2C+pl_rade%2C+pl_insol%2C+pl_eqt%2C+st_teff%2C+sy_dist+from+pscomppars&format=csv
```

Sources and documentation:

* [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/)
* [NASA Exoplanet Archive TAP interface documentation](https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html)
* [Planetary Systems and Planetary Systems Composite Parameters column definitions](https://exoplanetarchive.ipac.caltech.edu/docs/API_TD_columns.html)

`pl_rade` is planet radius in Earth radii, `pl_insol` is stellar energy received relative to Earth, `pl_eqt` is modeled equilibrium temperature in kelvin, `st_teff` is stellar effective temperature in kelvin, and `sy_dist` is system distance in parsecs. The two latter fields are required to match the original cleaning workflow but do not enter the ranking score. Equilibrium temperature is a modeled black body estimate, not a measured surface temperature.

## Screening and ranking method

The implementation follows the project's exploratory Python workflow. It does not deploy a trained model. No trained model artifact or frozen input dataset was supplied for this website.

1. **Clean:** retain rows with a planet name and finite, positive radius, insolation, stellar temperature, and system distance.
2. **Screen:** retain planets with radius between **0.5 and 1.6 Earth radii**, inclusive, and insolation between **0.25 and 2.25 times Earth's**, inclusive. The upper energy bound was expanded from the initial 2.0 suggestion to 2.25 to produce the requested 45 planet sample in the captured run.
3. **Score and order:** for each screened planet, compute

   ```text
   score = abs(log2(insolation)) + abs(radius - 1)
   ```

   Sort in ascending score. Smaller scores mean closer values to Earth's reference of radius 1 and insolation 1 under this custom formula.
4. **Display a rating:** convert the score to a value on a ten point scale using

   ```text
   rating = round(10 / (1 + score), 1)
   ```

   This is a monotonic display mapping, so it does not change the candidate order. A hypothetical Earth measurement receives 10/10. The score is not a scientifically validated habitability metric.
5. **Visualize:** show the radius versus insolation relation, highlight the top ten, mark Earth, and plot candidate measurements in a rotatable temperature wireframe. The all archive overview provides scale for the screened subset. Where temperature is missing, a plotted surface height is interpolated for visualization and is not treated as an observed temperature.

K Means clustering appears in the starter project concept but does not determine this website's ranking or rating. No trained clustering model is deployed. The ranking formula above is the entire ranking method.

## Website features

* Top ten ranked candidates with radius, stellar energy, equilibrium temperature when available, and rating.
* Search by NASA planet name or full candidate rank.
* A radius versus stellar energy chart with the same screened planet set represented in the temperature wireframe.
* A wider archive scale visualization showing usable records alongside the screened sample.
* A rotatable temperature wireframe, with a reset view control and hover or keyboard focus details.
* Earth reference marks and responsive layout for smaller screens.
* The server returns measurements and rankings through a small JSON API. The browser code contains the plotting and display logic.

## Run locally

Requirements: Node.js 18 or newer and an internet connection for the NASA TAP request.

```powershell
cd path\to\Blueprint-Lab-Website
node server.js
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Stop the server with `Ctrl+C`. To use another port:

```powershell
$env:PORT=8001
node server.js
```

The application has no external front end package dependencies. The local Node server fetches the NASA data, caches it for fifteen minutes, and serves the page and JSON API. If the NASA Archive is temporarily unreachable, retry after it becomes available.

## Project files

```text
Blueprint-Lab-Website/
├── index.html
├── favicon.svg
├── styles.css
├── script.js
├── server.js
├── README.md
└── assets/
    ├── blueprint-lines.png
    └── fonts/
        ├── Aileron-Regular.woff2
        └── AILERON-LICENSE.txt
```

## Limitations and interpretation

Planet radius and stellar insolation do not establish a planet's surface conditions. The score does not model atmosphere, composition, orbital eccentricity, stellar activity, tidal locking, clouds, or measurement uncertainty. The displayed equilibrium temperature is not surface temperature. Planets without reported equilibrium temperature may receive an interpolated height solely to keep the mesh continuous. NASA's composite values can be revised and may combine measurements with different uncertainty and provenance.

Use the ranking only as a transparent way to browse a small set of planets with Earth adjacent radius and stellar energy. It is not a habitability result, life detection, or substitute for peer reviewed analysis.

