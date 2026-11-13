/**
 * Route ideas: common shot shapes fitted around a subject. They are geometry only.
 * Nothing here knows about obstacles, people, or airspace at the location.
 */
import { fromLocal } from './geo';
import { newWaypoint, type LatLng, type Waypoint } from './types';

export type IdeaId = 'orbit' | 'reveal' | 'flyover' | 'grid';

export const IDEAS: { id: IdeaId; title: string; detail: string }[] = [
  { id: 'orbit', title: 'Orbit', detail: 'A full circle around the subject with the camera locked on it. Best with smooth turns.' },
  { id: 'reveal', title: 'Pull-back reveal', detail: 'Starts low and close, then backs away and climbs while keeping the subject in frame.' },
  { id: 'flyover', title: 'Fly-over', detail: 'A straight pass over the subject with the camera tilting down to look straight at it.' },
  { id: 'grid', title: 'Survey grid', detail: 'Back-and-forth passes over a square area with the camera pointing down and a photo at each turn.' },
];

/** Waypoints for an idea. sizeM is the orbit radius, or half the length of the pass or grid. */
export function buildIdea(id: IdeaId, center: LatLng, sizeM: number, poiId: string, altitudeM: number): Waypoint[] {
  const at = (x: number, y: number, patch: Partial<Waypoint> = {}): Waypoint => ({ ...newWaypoint(fromLocal(center, { x, y })), ...patch });
  const lookAt = { heading: { mode: 'poi', poiId } as const, gimbal: { mode: 'poi', poiId } as const };

  if (id === 'orbit') {
    const steps = 8;
    const out: Waypoint[] = [];
    // Start due south of the subject and go round clockwise, finishing where it began.
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI + (i / steps) * 2 * Math.PI;
      out.push(at(Math.sin(a) * sizeM, Math.cos(a) * sizeM, { ...lookAt, action: i === 0 ? 'recordStart' : i === steps ? 'recordStop' : 'none' }));
    }
    return out;
  }
  if (id === 'reveal') {
    return [
      at(0, -sizeM * 0.3, { ...lookAt, altitudeM: Math.max(5, altitudeM * 0.3), action: 'recordStart' }),
      at(0, -sizeM, { ...lookAt, altitudeM }),
      at(0, -sizeM * 2, { ...lookAt, altitudeM: altitudeM * 1.75, action: 'recordStop' }),
    ];
  }
  if (id === 'flyover') {
    return [
      at(-sizeM, 0, { heading: { mode: 'route' }, gimbal: { mode: 'pitch', deg: -30 }, action: 'recordStart' }),
      at(0, 0, { heading: { mode: 'route' }, gimbal: { mode: 'pitch', deg: -90 } }),
      at(sizeM, 0, { heading: { mode: 'route' }, action: 'recordStop' }),
    ];
  }
  // Survey grid: four passes, alternating direction.
  const passes = 4;
  const out: Waypoint[] = [];
  for (let i = 0; i < passes; i++) {
    const y = -sizeM + (i / (passes - 1)) * 2 * sizeM;
    const xs = i % 2 === 0 ? [-sizeM, sizeM] : [sizeM, -sizeM];
    for (const x of xs) {
      out.push(at(x, y, { heading: { mode: 'route' }, gimbal: out.length === 0 ? { mode: 'pitch', deg: -90 } : { mode: 'none' }, action: 'photo' }));
    }
  }
  return out;
}
