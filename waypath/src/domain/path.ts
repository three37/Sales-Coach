/**
 * Flight path geometry.
 *
 * Everything that needs to know where the drone is and when — the route line on
 * the map, the distance and duration totals, the preview and the KML export —
 * reads the same FlightPath built here, so they cannot disagree.
 */
import { bearing, clamp, fromLocal, haversine, lerp, lerpAngle, lerpLatLng, toLocal } from './geo';
import type { GimbalSpec, HeadingSpec, LatLng, Mission, Poi, Waypoint, WaypointAction } from './types';

export interface FlightLeg {
  from: number;
  to: number;
  speedMps: number;
  points: LatLng[];
  /** Metres from the start of the leg to each point. */
  cum: number[];
  lengthM: number;
  durationS: number;
  /** Time and distance at which the leg starts. */
  t0: number;
  d0: number;
}

export interface FlightEvent {
  t: number;
  wpIndex: number;
  action: WaypointAction;
}

export interface FlightPath {
  mission: Mission;
  legs: FlightLeg[];
  /** Position the drone actually passes for each waypoint (the apex of the curve when the turn is curved). */
  anchors: LatLng[];
  /** Whether each waypoint is flown as a curve. */
  curved: boolean[];
  arrive: number[];
  depart: number[];
  /** Altitude of each waypoint above the takeoff point. */
  relAlt: number[];
  /** False when the mission is in above-ground mode but some terrain heights are missing. */
  aglResolved: boolean;
  events: FlightEvent[];
  totalDistanceM: number;
  totalDurationS: number;
  /** The whole route as one line. */
  line: LatLng[];
  /** True when the plan ends with a leg from the last waypoint back to waypoint 1. */
  returns: boolean;
}

export interface FlightSample extends LatLng {
  t: number;
  phase: 'idle' | 'move' | 'hold' | 'done';
  /** Last waypoint reached, and the one being flown to (-1 when there is none). */
  wpIndex: number;
  nextWpIndex: number;
  altRelM: number;
  /** Height above the terrain, only known at waypoints, so interpolated between them. null when unknown. */
  altAglM: number | null;
  headingDeg: number;
  gimbalPitchDeg: number;
  speedMps: number;
  distanceM: number;
  recording: boolean;
  photos: number;
}

const CURVE_STEPS = 12;

export function hasElevation(m: Mission): boolean {
  return m.waypoints.length > 0 && m.waypoints.every((w) => w.groundElevM != null);
}

export function wpAltitude(m: Mission, w: Waypoint): number {
  return w.altitudeM ?? m.defaults.altitudeM;
}
export function wpSpeed(m: Mission, w: Waypoint): number {
  const s = w.speedMps ?? m.defaults.speedMps;
  return Number.isFinite(s) && s > 0.05 ? s : 0.05;
}
export function wpHeading(m: Mission, w: Waypoint): HeadingSpec {
  return w.heading ?? m.defaults.heading;
}

/** A waypoint with a hold or an action is flown to exactly and stopped at, even in curved mode. */
export function isStop(w: Waypoint): boolean {
  return w.holdSec > 0 || w.action !== 'none';
}

/** Waypoint altitudes above the takeoff point (taken to be the ground under waypoint 1 in above-ground mode). */
export function relativeAltitudes(m: Mission): { relAlt: number[]; aglResolved: boolean } {
  const raw = m.waypoints.map((w) => wpAltitude(m, w));
  if (m.defaults.altitudeRef !== 'agl') return { relAlt: raw, aglResolved: true };
  if (!hasElevation(m)) return { relAlt: raw, aglResolved: false };
  const g0 = m.waypoints[0].groundElevM as number;
  return { relAlt: m.waypoints.map((w, i) => raw[i] + (w.groundElevM as number) - g0), aglResolved: true };
}

/** POI height above the takeoff point, in the same frame as relAlt. */
export function poiRelAlt(m: Mission, poi: Poi): number {
  if (m.defaults.altitudeRef === 'agl' && hasElevation(m) && poi.groundElevM != null) {
    return poi.heightM + poi.groundElevM - (m.waypoints[0].groundElevM as number);
  }
  return poi.heightM;
}

function dedupe(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.lat !== p.lat || last.lng !== p.lng) out.push(p);
  }
  return out;
}

interface Corner {
  /** Points from the start of the curve to its apex, and from the apex to its end. */
  inbound: LatLng[];
  outbound: LatLng[];
  apex: LatLng;
}

function buildCorner(prev: LatLng, at: LatLng, next: LatLng, distance: number): Corner | null {
  const a = toLocal(at, prev);
  const c = toLocal(at, next);
  const lenIn = Math.hypot(a.x, a.y);
  const lenOut = Math.hypot(c.x, c.y);
  // Never use more than 45% of a leg, so curves at both ends of a short leg cannot overlap.
  const d = Math.min(distance, lenIn * 0.45, lenOut * 0.45);
  if (!(d >= 0.5)) return null;
  const p0 = { x: (a.x / lenIn) * d, y: (a.y / lenIn) * d };
  const p2 = { x: (c.x / lenOut) * d, y: (c.y / lenOut) * d };
  // Quadratic Bezier with the waypoint as its control point.
  const at_ = (t: number) => {
    const u = 1 - t;
    return fromLocal(at, { x: u * u * p0.x + t * t * p2.x, y: u * u * p0.y + t * t * p2.y });
  };
  const inbound: LatLng[] = [];
  const outbound: LatLng[] = [];
  for (let i = 0; i <= CURVE_STEPS; i++) inbound.push(at_((i / CURVE_STEPS) * 0.5));
  for (let i = 0; i <= CURVE_STEPS; i++) outbound.push(at_(0.5 + (i / CURVE_STEPS) * 0.5));
  return { inbound, outbound, apex: at_(0.5) };
}

export function buildFlightPath(mission: Mission): FlightPath {
  const wps = mission.waypoints;
  const n = wps.length;
  const { relAlt, aglResolved } = relativeAltitudes(mission);
  const curvedMode = mission.defaults.turnMode === 'curved' && mission.defaults.turnDistanceM > 0;

  const corners: (Corner | null)[] = wps.map((w, i) => {
    if (!curvedMode || i === 0 || i === n - 1 || isStop(w)) return null;
    return buildCorner(wps[i - 1], w, wps[i + 1], mission.defaults.turnDistanceM);
  });
  const anchors: LatLng[] = wps.map((w, i) => corners[i]?.apex ?? { lat: w.lat, lng: w.lng });

  const legs: FlightLeg[] = [];
  const arrive: number[] = new Array(n).fill(0);
  const depart: number[] = new Array(n).fill(0);
  const events: FlightEvent[] = [];
  const line: LatLng[] = [];
  let t = 0;
  let d = 0;

  for (let i = 0; i < n; i++) {
    arrive[i] = t;
    if (wps[i].action !== 'none') events.push({ t, wpIndex: i, action: wps[i].action });
    t += Math.max(0, wps[i].holdSec || 0);
    depart[i] = t;
    if (i === n - 1) break;

    const start = corners[i]?.outbound ?? [anchors[i]];
    const end = corners[i + 1]?.inbound ?? [anchors[i + 1]];
    const points = dedupe([...start, ...end]);
    const cum = [0];
    for (let k = 1; k < points.length; k++) cum.push(cum[k - 1] + haversine(points[k - 1], points[k]));
    const lengthM = cum[cum.length - 1];
    const speedMps = wpSpeed(mission, wps[i]);
    const durationS = lengthM / speedMps;
    legs.push({ from: i, to: i + 1, speedMps, points, cum, lengthM, durationS, t0: t, d0: d });
    for (const p of points) line.push(p);
    t += durationS;
    d += lengthM;
  }
  // Optional closing leg back to waypoint 1, flown at the last waypoint's speed.
  const returns = mission.defaults.finish === 'returnToStart' && n >= 2;
  if (returns) {
    const points = dedupe([anchors[n - 1], { lat: wps[0].lat, lng: wps[0].lng }]);
    const lengthM = points.length > 1 ? haversine(points[0], points[1]) : 0;
    const speedMps = wpSpeed(mission, wps[n - 1]);
    const durationS = lengthM / speedMps;
    legs.push({ from: n - 1, to: 0, speedMps, points, cum: points.length > 1 ? [0, lengthM] : [0], lengthM, durationS, t0: t, d0: d });
    for (const p of points) line.push(p);
    t += durationS;
    d += lengthM;
  }
  if (n === 1) line.push(anchors[0]);

  return {
    mission,
    legs,
    anchors,
    curved: corners.map((c) => c != null),
    arrive,
    depart,
    relAlt,
    aglResolved,
    events,
    totalDistanceM: d,
    totalDurationS: t,
    line: dedupe(line),
    returns,
  };
}

function findPoi(m: Mission, id: string): Poi | undefined {
  return m.pois.find((p) => p.id === id);
}

/** Position on a leg at a distance from its start, and the direction of travel there. */
function pointOnLeg(leg: FlightLeg, dist: number): { p: LatLng; course: number } {
  const pts = leg.points;
  if (pts.length < 2) return { p: pts[0], course: 0 };
  let k = 1;
  while (k < pts.length - 1 && leg.cum[k] < dist) k++;
  const span = leg.cum[k] - leg.cum[k - 1];
  const f = span > 0 ? clamp((dist - leg.cum[k - 1]) / span, 0, 1) : 0;
  return { p: lerpLatLng(pts[k - 1], pts[k], f), course: bearing(pts[k - 1], pts[k]) };
}

/** Gimbal setting in force at each waypoint: an unset gimbal keeps whatever the previous waypoint left. */
function effectiveGimbals(m: Mission): GimbalSpec[] {
  const out: GimbalSpec[] = [];
  let cur: GimbalSpec = { mode: 'pitch', deg: 0 };
  for (const w of m.waypoints) {
    if (w.gimbal.mode !== 'none') cur = w.gimbal;
    out.push(cur);
  }
  return out;
}

function pitchToPoi(m: Mission, poi: Poi, p: LatLng, altRel: number): number {
  const horiz = haversine(p, poi);
  const drop = altRel - poiRelAlt(m, poi);
  if (horiz < 0.01 && Math.abs(drop) < 0.01) return 0;
  return clamp((-Math.atan2(drop, horiz) * 180) / Math.PI, -90, 30);
}

function headingAt(path: FlightPath, i: number, f: number, p: LatLng, course: number): number {
  const m = path.mission;
  const spec = wpHeading(m, m.waypoints[i]);
  if (spec.mode === 'custom') {
    const next = m.waypoints[i + 1] ?? (path.returns ? m.waypoints[0] : undefined);
    const nextSpec = next ? wpHeading(m, next) : null;
    return nextSpec?.mode === 'custom' ? lerpAngle(spec.deg, nextSpec.deg, f) : spec.deg;
  }
  if (spec.mode === 'poi') {
    const poi = findPoi(m, spec.poiId);
    if (poi && haversine(p, poi) > 0.05) return bearing(p, poi);
  }
  return course;
}

function gimbalAt(path: FlightPath, gimbals: GimbalSpec[], i: number, f: number, p: LatLng, altRel: number): number {
  const m = path.mission;
  const spec = gimbals[i];
  if (spec.mode === 'poi') {
    const poi = findPoi(m, spec.poiId);
    return poi ? pitchToPoi(m, poi, p, altRel) : 0;
  }
  if (spec.mode !== 'pitch') return 0;
  const next = m.waypoints[i + 1]?.gimbal;
  return next?.mode === 'pitch' ? lerp(spec.deg, next.deg, f) : spec.deg;
}

/** Where the drone is, and what it is doing, t seconds into the flight. */
export function sampleFlight(path: FlightPath, tIn: number): FlightSample | null {
  const m = path.mission;
  const n = m.waypoints.length;
  if (n === 0) return null;
  const t = clamp(tIn, 0, path.totalDurationS);
  const gimbals = effectiveGimbals(m);

  let recording = false;
  let photos = 0;
  for (const e of path.events) {
    if (e.t > t) break;
    if (e.action === 'photo') photos++;
    else if (e.action === 'recordStart') recording = true;
    else if (e.action === 'recordStop') recording = false;
  }

  const agl = (i: number, f: number, altRel: number): number | null => {
    if (!hasElevation(m)) return null;
    const g0 = m.waypoints[0].groundElevM as number;
    const gi = m.waypoints[i].groundElevM as number;
    const gj = (m.waypoints[i + 1] ?? (path.returns ? m.waypoints[0] : m.waypoints[i])).groundElevM as number;
    return altRel + g0 - lerp(gi, gj, f);
  };

  // Moving along a leg?
  for (const leg of path.legs) {
    if (t > leg.t0 && t < leg.t0 + leg.durationS) {
      const dist = (t - leg.t0) * leg.speedMps;
      const f = leg.lengthM > 0 ? dist / leg.lengthM : 0;
      const { p, course } = pointOnLeg(leg, dist);
      const altRel = lerp(path.relAlt[leg.from], path.relAlt[leg.to], f);
      return {
        ...p,
        t,
        phase: 'move',
        wpIndex: leg.from,
        nextWpIndex: leg.to,
        altRelM: altRel,
        altAglM: agl(leg.from, f, altRel),
        headingDeg: headingAt(path, leg.from, f, p, course),
        gimbalPitchDeg: gimbalAt(path, gimbals, leg.from, f, p, altRel),
        speedMps: leg.speedMps,
        distanceM: leg.d0 + dist,
        recording,
        photos,
      };
    }
  }

  // Back at waypoint 1 at the end of a return leg.
  if (path.returns && t >= path.totalDurationS) {
    const back = path.legs[path.legs.length - 1];
    const p = { lat: m.waypoints[0].lat, lng: m.waypoints[0].lng };
    const course = pointOnLeg(back, back.lengthM).course;
    return {
      ...p,
      t,
      phase: 'done',
      wpIndex: 0,
      nextWpIndex: -1,
      altRelM: path.relAlt[0],
      altAglM: agl(0, 0, path.relAlt[0]),
      headingDeg: headingAt(path, n - 1, 1, p, course),
      gimbalPitchDeg: gimbalAt(path, gimbals, n - 1, 1, p, path.relAlt[0]),
      speedMps: 0,
      distanceM: path.totalDistanceM,
      recording,
      photos,
    };
  }

  // Otherwise at a waypoint: holding, about to start, or finished.
  let i = 0;
  for (let k = 0; k < n; k++) if (path.arrive[k] <= t) i = k;
  const p = path.anchors[i];
  const outLeg = path.legs[i];
  const inLeg = path.legs[i - 1];
  const course = outLeg
    ? pointOnLeg(outLeg, 0).course
    : inLeg
      ? pointOnLeg(inLeg, inLeg.lengthM).course
      : 0;
  const altRel = path.relAlt[i];
  const phase: FlightSample['phase'] =
    n > 1 && i === n - 1 && t >= path.totalDurationS && !path.returns ? 'done' : m.waypoints[i].holdSec > 0 ? 'hold' : 'idle';
  return {
    ...p,
    t,
    phase,
    wpIndex: i,
    nextWpIndex: i < n - 1 ? i + 1 : -1,
    altRelM: altRel,
    altAglM: agl(i, 0, altRel),
    headingDeg: headingAt(path, i, 0, p, course),
    gimbalPitchDeg: gimbalAt(path, gimbals, i, 0, p, altRel),
    speedMps: 0,
    distanceM: outLeg ? outLeg.d0 : path.totalDistanceM,
    recording,
    photos,
  };
}

/** Heading the drone holds while sitting at a waypoint; used to draw the marker's direction tick. */
export function headingAtWaypoint(path: FlightPath, i: number): number {
  const outLeg = path.legs[i];
  const inLeg = path.legs[i - 1];
  const course = outLeg ? pointOnLeg(outLeg, 0).course : inLeg ? pointOnLeg(inLeg, inLeg.lengthM).course : 0;
  return headingAt(path, i, 0, path.anchors[i], course);
}
