/**
 * Terrain height lookup from the public "Terrain Tiles" dataset (Mapzen/AWS open data,
 * Terrarium encoding). Returns null for a point when the data cannot be fetched, and the
 * app keeps above-ground features switched off until every waypoint has a height.
 */
import type { LatLng } from './types';

const ZOOM = 13;
const TILE = 256;
const URL_TEMPLATE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const ELEVATION_ATTRIBUTION = 'Terrain: Mapzen Terrain Tiles (AWS Open Data)';

const cache = new Map<string, Promise<Uint8ClampedArray | null>>();

/** Terrarium encoding: height in metres = R*256 + G + B/256 - 32768. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function tilePixel(p: LatLng, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const fx = ((p.lng + 180) / 360) * n;
  const latRad = (p.lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.max(0, Math.floor(fx)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(fy)));
  return {
    x,
    y,
    px: Math.min(TILE - 1, Math.max(0, Math.floor((fx - x) * TILE))),
    py: Math.min(TILE - 1, Math.max(0, Math.floor((fy - y) * TILE))),
  };
}

async function loadTile(x: number, y: number): Promise<Uint8ClampedArray | null> {
  try {
    const url = URL_TEMPLATE.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, TILE, TILE);
    return ctx.getImageData(0, 0, TILE, TILE).data;
  } catch {
    return null;
  }
}

export async function lookupElevations(points: LatLng[]): Promise<(number | null)[]> {
  return Promise.all(
    points.map(async (p) => {
      if (Math.abs(p.lat) > 85) return null;
      const { x, y, px, py } = tilePixel(p, ZOOM);
      const key = `${x}/${y}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = loadTile(x, y);
        cache.set(key, pending);
        // Do not remember failures, so a later attempt (back online) can succeed.
        void pending.then((d) => {
          if (!d) cache.delete(key);
        });
      }
      const data = await pending;
      if (!data) return null;
      const o = (py * TILE + px) * 4;
      const h = decodeTerrarium(data[o], data[o + 1], data[o + 2]);
      return Math.round(h * 10) / 10;
    }),
  );
}
