import type { LatLng } from './types';

export const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north, 0..360. */
export function bearing(a: LatLng, b: LatLng): number {
  const p1 = a.lat * RAD;
  const p2 = b.lat * RAD;
  const dl = (b.lng - a.lng) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(Math.atan2(y, x) / RAD);
}

export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Interpolate between two compass angles the short way round. */
export function lerpAngle(a: number, b: number, f: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return norm360(a + d * f);
}

export function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Flat east/north metres around an origin. Accurate to well under 1% across a few kilometres. */
export function toLocal(origin: LatLng, p: LatLng): { x: number; y: number } {
  return {
    x: (p.lng - origin.lng) * RAD * EARTH_RADIUS_M * Math.cos(origin.lat * RAD),
    y: (p.lat - origin.lat) * RAD * EARTH_RADIUS_M,
  };
}

export function fromLocal(origin: LatLng, v: { x: number; y: number }): LatLng {
  return {
    lat: origin.lat + v.y / EARTH_RADIUS_M / RAD,
    lng: origin.lng + v.x / (EARTH_RADIUS_M * Math.cos(origin.lat * RAD)) / RAD,
  };
}

export function lerpLatLng(a: LatLng, b: LatLng, f: number): LatLng {
  return { lat: lerp(a.lat, b.lat, f), lng: lerp(a.lng, b.lng, f) };
}
