# Waypath

A drone mission planner that runs in the browser and installs as an app. Open a map, tap out a route, tell the camera where to look, preview the flight, and save or export the plan.

One codebase (React, TypeScript, Vite, MapLibre) serves iPhone and iPad (Safari), Mac (Safari and Chrome), and Android phones and tablets (Chrome).

Waypath plans, simulates and exports. It does not fly a drone, and it does not check airspace, obstacles or terrain between waypoints. You are responsible for flying legally and safely.

## Run it

```bash
cd waypath
npm install
npm run dev        # development server at http://localhost:5173
```

To run the production build the way it is deployed:

```bash
npm run build
npm run preview    # http://localhost:4173, also reachable from other devices on your network
```

Opening the `npm run preview` address from a phone on the same Wi-Fi works for a quick look, but it is plain HTTP, so the phone will not install the app, work offline, or offer your location. Use an HTTPS deployment for that.

## Put it on HTTPS

The build output in `dist/` is a static site that works at a domain root or under any sub-path.

**Netlify (a `netlify.toml` is included)**

1. In Netlify choose *Add new project → Import an existing project* and pick this repository.
2. Set **Base directory** to `waypath`. The build command (`npm run build`) and publish directory (`dist`) are read from `netlify.toml`.
3. Deploy. The site address is your HTTPS preview URL.

**Any other static host** (Cloudflare Pages, Vercel, GitHub Pages, S3, your own server): run `npm run build` and upload the contents of `dist/`. Serve `sw.js` without long-lived caching so updates arrive.

## Install it

Open the HTTPS address first, then:

| Device | Steps |
| --- | --- |
| iPhone, iPad | In **Safari**, tap **Share**, then **Add to Home Screen**, then **Add**. |
| Mac, Safari 17 or later | **File → Add to Dock**, then **Add**. |
| Mac, Chrome | Click the install icon at the right of the address bar, or **⋮ → Cast, save and share → Install page as app**. |
| Android phone or tablet | In **Chrome**, tap **⋮**, then **Add to Home screen**, then **Install**. |

After the first visit the app starts without a connection. Map tiles you have already viewed are kept for two weeks; areas you have not viewed will be blank offline.

## Using it

- **Map tools** (bottom of the map): *Select* to pick and drag markers, *Waypoint* to add waypoints by tapping, *POI* to place a point of interest.
- **Route tab**: the waypoint list with reorder buttons. Tap a waypoint to edit altitude, speed to the next waypoint, heading, gimbal pitch, hold time and camera action.
- **Preview tab**: play, pause, scrub and change playback speed. Shows the drone, camera direction, altitude, heading and current waypoint.
- **Mission tab**: name, default speed and altitude, altitude reference, default heading, straight or smooth turns, what happens after the last waypoint, units and map background.
- **Route ideas** (Route tab): ready-made shapes (orbit, pull-back reveal, fly-over, survey grid) placed around the selected point of interest or the middle of the map. They are geometry only and know nothing about obstacles or airspace at the location.
- **Top bar**: missions (new, open, rename, duplicate, delete), undo, redo, export and import.

Keyboard: `V` select, `W` waypoint, `P` POI, `F` fit route, `Esc` cancel, `Delete` remove selected, arrow keys nudge the selected marker (Shift for 10 m), `Ctrl/⌘ Z` undo, `Ctrl/⌘ Shift Z` redo, `Space` play or pause on the Preview tab.

### How the numbers are worked out

- Distance is great-circle distance along the route (horizontal ground track; climbs and descents are not added).
- Each leg is flown at the speed set on the waypoint it leaves, or the mission default.
- Duration is the sum of leg length ÷ leg speed, plus every hold. Acceleration, wind, and time spent rotating or climbing are not modelled.
- The route line, the totals, the preview and the KML route all read one path built in `src/domain/path.ts`, so they cannot disagree. Smooth turns are part of that same path.
- *Fly back to waypoint 1* (Mission tab) adds a closing leg at the last waypoint's speed, ending at waypoint 1's altitude. It is a planned leg, not the aircraft's return-to-home failsafe, which is set in your flight app.
- With smooth turns the drone starts turning a set distance before each waypoint and cuts inside the corner. A waypoint with a hold or camera action is still flown to exactly.

### Altitude reference

- **Above takeoff point** (default): every altitude is measured from where the drone takes off.
- **Above ground (AGL)**: each altitude is measured from the ground under that waypoint. This option is only offered once terrain height has been looked up for every waypoint. Takeoff is assumed to be at waypoint 1. Terrain between waypoints is not checked.

Terrain heights come from the public Mapzen Terrain Tiles on AWS Open Data. If they cannot be reached, the app says so and stays in above-takeoff mode.

## Files

| File | Purpose |
| --- | --- |
| `name.waypath.json` | Mission file. Versioned (`"format": "waypath.mission", "version": 1`), carries every setting. Use it to back up a plan or move it to another device. Opening a file never overwrites a mission already on the device. |
| `name.kml` | Route, waypoints and points of interest for viewing in Google Earth. Not a flight plan. |

Saving uses a normal browser download. Where the system share sheet accepts the file, a **Share** button also appears (on iPhone and iPad this offers *Save to Files* and AirDrop). Opening uses the standard file picker; on a Mac you can also drop a mission file onto the window.

Where saved files go: **iPhone/iPad** Files app → Downloads; **Android** Downloads; **Mac** Finder → Downloads.

### DJI Fly KMZ

Not included. The rule for this project is that a DJI export is only added for a drone model whose output has been checked against a known-good file from that exact model, and no such file was available. The export dialog shows the option as unavailable and says why. To add a model, supply a waypoint mission KMZ saved by DJI Fly on that aircraft; the writer can then be built against DJI's published WPML documentation and compared with it.

## Tests

```bash
npm test           # route maths, mission file round trip, KML, terrain decoding
npm run build && npm run e2e   # the full workflow in real browsers
```

`npm run e2e` drives the built app through: first launch with the sample mission, new mission, three waypoints, a POI, speed change and time estimate, per-waypoint overrides, undo and redo, dragging, reordering, preview, reload and recovery, export, reimport, rename, duplicate, delete, smooth turns, the return leg, route ideas, the above-ground gate, and screen rotation. It needs Playwright (`npm i -D playwright && npx playwright install chromium webkit`) and, optionally on Linux, `webkit2gtk-driver` and `xvfb` for WebKitGTK.

## What has been verified

Last full run: 193 checks passed, 0 failed.

| Check | Chromium 153 (Playwright) | WebKit (WebKitGTK 2.52.6) | Physical device |
| --- | --- | --- | --- |
| Full workflow, phone portrait | Passed at 390×844, touch input | Passed at 447×844 (narrowest the test window allows), mouse input | Not run |
| Full workflow, phone landscape | Passed at 844×390, touch input | Passed at 844×390, mouse input | Not run |
| Full workflow, tablet | Passed at 820×1180, touch input | Passed at 820×1180, mouse input | Not run |
| Full workflow, desktop | Passed at 1280×800, mouse and keyboard | Passed at 1280×800, mouse and keyboard | Not run |
| Rotation keeps plan and controls | Passed | Passed | Not run |
| Return leg to waypoint 1; route ideas | Passed | Passed | Not run |
| Reload recovers the mission (IndexedDB) | Passed | Passed | Not run |
| Mission file export → reimport identical | Passed, through the browser's real download | Passed; file captured as the page handed it to the browser | Not run |
| Totals match an independent calculation | Passed | Passed | n/a |
| Terrain lookup and above-ground gate | Passed with a stand-in terrain server | Passed against the live terrain data | Not run |
| Map tiles drawn | Passed with a stand-in tile server | Not run | Not run |
| Manifest, service worker, offline start | Passed | Not run | Not run |

Not verified, and worth checking on your own devices:

- **Safari itself.** WebKitGTK shares Safari's engine but is not Safari. Touch gestures, the iOS file picker, and Safari's download and share behaviour were not exercised.
- **Installing the app** on iPhone, iPad, Mac or Android, and running it from the Home Screen or Dock.
- **File handling on devices**: saving to and opening from iOS Files, Android Downloads and Finder.
- **Live map backgrounds.** The test machine could not reach the OpenStreetMap or Sentinel-2 tile servers, so the streets and satellite backgrounds have not been seen with real imagery. The satellite address in particular is untested.
- **KML in Google Earth.** The file's structure is tested; it has not been opened in Google Earth.
- **DJI Fly export.** Not built; see above.

## Map and data credits

- Streets: © OpenStreetMap contributors, from the OpenStreetMap tile servers. These are a shared community resource with a usage policy; for heavy use, set a custom tile address in the Mission tab.
- Satellite (low detail, about 10 m per pixel): Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016). For high-detail imagery, enter a tile address from a provider you have an account with.
- Terrain: Mapzen Terrain Tiles, AWS Open Data.
