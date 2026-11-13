/**
 * Versioned mission file. This is the format used to move plans between devices,
 * so it carries every setting and is validated field by field on the way in.
 */
import { clamp } from './geo';
import {
  LIMITS,
  defaultDefaults,
  newId,
  type GimbalSpec,
  type HeadingSpec,
  type Mission,
  type Poi,
  type Waypoint,
  type WaypointAction,
} from './types';

export const FILE_FORMAT = 'waypath.mission';
export const FILE_VERSION = 1;
export const FILE_EXTENSION = '.json';

export class MissionFileError extends Error {}

export interface ParsedMissionFile {
  mission: Mission;
  warnings: string[];
}

export function serializeMission(mission: Mission): string {
  return JSON.stringify(
    { format: FILE_FORMAT, version: FILE_VERSION, exportedAt: new Date().toISOString(), mission },
    null,
    2,
  );
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.slice(0, 200) : fallback);

function coord(o: Record<string, unknown>, what: string): { lat: number; lng: number } {
  const lat = num(o.lat);
  const lng = num(o.lng);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new MissionFileError(`${what} has a missing or invalid position.`);
  }
  return { lat, lng };
}

function heading(v: unknown, poiIds: Set<string>, warn: (s: string) => void, what: string): HeadingSpec | null {
  if (!isObj(v)) return null;
  if (v.mode === 'route') return { mode: 'route' };
  if (v.mode === 'custom') return { mode: 'custom', deg: (((num(v.deg) ?? 0) % 360) + 360) % 360 };
  if (v.mode === 'poi' && typeof v.poiId === 'string') {
    if (poiIds.has(v.poiId)) return { mode: 'poi', poiId: v.poiId };
    warn(`${what} faced a point of interest that is not in the file; it now follows the route.`);
    return { mode: 'route' };
  }
  return null;
}

function gimbal(v: unknown, poiIds: Set<string>, warn: (s: string) => void, what: string): GimbalSpec {
  if (!isObj(v)) return { mode: 'none' };
  if (v.mode === 'pitch') return { mode: 'pitch', deg: clamp(num(v.deg) ?? 0, LIMITS.gimbal.min, LIMITS.gimbal.max) };
  if (v.mode === 'poi' && typeof v.poiId === 'string') {
    if (poiIds.has(v.poiId)) return { mode: 'poi', poiId: v.poiId };
    warn(`${what} tilted the camera at a point of interest that is not in the file; its gimbal is now unset.`);
  }
  return { mode: 'none' };
}

const ACTIONS: WaypointAction[] = ['none', 'photo', 'recordStart', 'recordStop'];

export function parseMissionFile(text: string): ParsedMissionFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new MissionFileError('This file is not valid JSON, so it cannot be a mission file.');
  }
  if (!isObj(data) || data.format !== FILE_FORMAT) {
    throw new MissionFileError('This is not a Waypath mission file.');
  }
  const version = num(data.version);
  if (version == null || version < 1) throw new MissionFileError('The mission file has no version number.');
  if (version > FILE_VERSION) {
    throw new MissionFileError(
      `This file was saved by a newer version of Waypath (file version ${version}). Update the app to open it.`,
    );
  }
  // Version 1 is the only version so far; older versions would be upgraded here.
  const src = data.mission;
  if (!isObj(src)) throw new MissionFileError('The mission file contains no mission.');

  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);

  const pois: Poi[] = (Array.isArray(src.pois) ? src.pois : []).filter(isObj).map((p, i) => ({
    id: str(p.id, newId()),
    name: str(p.name, `POI ${i + 1}`),
    ...coord(p, `Point of interest ${i + 1}`),
    heightM: clamp(num(p.heightM) ?? 0, LIMITS.altitude.min, LIMITS.altitude.max),
    groundElevM: num(p.groundElevM),
  }));
  const poiIds = new Set(pois.map((p) => p.id));

  const d = isObj(src.defaults) ? src.defaults : {};
  const base = defaultDefaults();
  const defaults = {
    speedMps: clamp(num(d.speedMps) ?? base.speedMps, LIMITS.speed.min, LIMITS.speed.max),
    altitudeM: clamp(num(d.altitudeM) ?? base.altitudeM, LIMITS.altitude.min, LIMITS.altitude.max),
    altitudeRef: d.altitudeRef === 'agl' ? ('agl' as const) : ('takeoff' as const),
    heading: heading(d.heading, poiIds, warn, 'The mission default heading') ?? base.heading,
    turnMode: d.turnMode === 'curved' ? ('curved' as const) : ('straight' as const),
    turnDistanceM: clamp(num(d.turnDistanceM) ?? base.turnDistanceM, LIMITS.turnDistance.min, LIMITS.turnDistance.max),
    // Added after the first release; files without it end at the last waypoint, as before.
    finish: d.finish === 'returnToStart' ? ('returnToStart' as const) : ('stop' as const),
  };

  const waypoints: Waypoint[] = (Array.isArray(src.waypoints) ? src.waypoints : []).filter(isObj).map((w, i) => {
    const what = `Waypoint ${i + 1}`;
    const alt = num(w.altitudeM);
    const speed = num(w.speedMps);
    return {
      id: str(w.id, newId()),
      ...coord(w, what),
      altitudeM: alt == null ? null : clamp(alt, LIMITS.altitude.min, LIMITS.altitude.max),
      speedMps: speed == null ? null : clamp(speed, LIMITS.speed.min, LIMITS.speed.max),
      heading: heading(w.heading, poiIds, warn, what),
      gimbal: gimbal(w.gimbal, poiIds, warn, what),
      holdSec: clamp(num(w.holdSec) ?? 0, LIMITS.hold.min, LIMITS.hold.max),
      action: ACTIONS.includes(w.action as WaypointAction) ? (w.action as WaypointAction) : 'none',
      groundElevM: num(w.groundElevM),
    };
  });

  if (defaults.altitudeRef === 'agl' && !(waypoints.length > 0 && waypoints.every((w) => w.groundElevM != null))) {
    warn('The mission uses above-ground altitudes but the file has no terrain heights for some waypoints.');
  }

  const now = new Date().toISOString();
  return {
    mission: {
      id: str(src.id, newId()),
      name: str(src.name, 'Imported mission'),
      createdAt: str(src.createdAt, now),
      updatedAt: str(src.updatedAt, now),
      defaults,
      waypoints,
      pois,
    },
    warnings,
  };
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, '-');
  return cleaned.slice(0, 60) || 'mission';
}
