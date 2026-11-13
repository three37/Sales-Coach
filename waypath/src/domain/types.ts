export interface LatLng {
  lat: number;
  lng: number;
}

/** Where the aircraft nose points. */
export type HeadingSpec =
  | { mode: 'route' }
  | { mode: 'custom'; deg: number }
  | { mode: 'poi'; poiId: string };

/** Camera tilt. 0 = level, -90 = straight down. */
export type GimbalSpec =
  | { mode: 'none' }
  | { mode: 'pitch'; deg: number }
  | { mode: 'poi'; poiId: string };

export type WaypointAction = 'none' | 'photo' | 'recordStart' | 'recordStop';

/** 'takeoff' = metres above the takeoff point. 'agl' = metres above the ground under each waypoint. */
export type AltitudeRef = 'takeoff' | 'agl';
export type TurnMode = 'straight' | 'curved';
/** What the plan does after the last waypoint: end there, or fly back to waypoint 1. */
export type FinishMode = 'stop' | 'returnToStart';

export interface Waypoint extends LatLng {
  id: string;
  /** null = use the mission default */
  altitudeM: number | null;
  /** Speed for the leg leaving this waypoint. null = use the mission default */
  speedMps: number | null;
  /** Heading for the leg leaving this waypoint. null = use the mission default */
  heading: HeadingSpec | null;
  gimbal: GimbalSpec;
  holdSec: number;
  action: WaypointAction;
  /** Terrain height above sea level, when it has been looked up. */
  groundElevM: number | null;
}

export interface Poi extends LatLng {
  id: string;
  name: string;
  /** Height of the subject, in the mission's altitude reference. */
  heightM: number;
  groundElevM: number | null;
}

export interface MissionDefaults {
  speedMps: number;
  altitudeM: number;
  altitudeRef: AltitudeRef;
  heading: HeadingSpec;
  turnMode: TurnMode;
  /** How far before/after a waypoint a curved turn starts and ends. */
  turnDistanceM: number;
  finish: FinishMode;
}

export interface Mission {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  defaults: MissionDefaults;
  waypoints: Waypoint[];
  pois: Poi[];
}

export const LIMITS = {
  speed: { min: 0.5, max: 15 },
  altitude: { min: -200, max: 1500 },
  hold: { min: 0, max: 600 },
  turnDistance: { min: 0, max: 200 },
  gimbal: { min: -90, max: 30 },
} as const;

export function newId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function defaultDefaults(): MissionDefaults {
  return {
    speedMps: 5,
    altitudeM: 40,
    altitudeRef: 'takeoff',
    heading: { mode: 'route' },
    turnMode: 'straight',
    turnDistanceM: 10,
    finish: 'stop',
  };
}

export function newMission(name = 'Untitled mission'): Mission {
  const now = new Date().toISOString();
  return { id: newId(), name, createdAt: now, updatedAt: now, defaults: defaultDefaults(), waypoints: [], pois: [] };
}

export function newWaypoint(p: LatLng): Waypoint {
  return {
    id: newId(),
    lat: p.lat,
    lng: p.lng,
    altitudeM: null,
    speedMps: null,
    heading: null,
    gimbal: { mode: 'none' },
    holdSec: 0,
    action: 'none',
    groundElevM: null,
  };
}
