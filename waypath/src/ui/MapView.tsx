import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';
import type { Feature, LineString } from 'geojson';
// MapLibre 6 ships its worker as a separate module; let Vite bundle it and hand us the address.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState } from 'react';
import { headingAtWaypoint, sampleFlight, type FlightPath } from '../domain/path';
import type { LatLng } from '../domain/types';
import { useStore, type Settings } from '../store/store';
import { usePath } from './usePath';

maplibregl.setWorkerUrl(new URL(workerUrl, document.baseURI).href);

const OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const EOX =
  '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)';

function buildStyle(s: Settings): StyleSpecification {
  const sources: StyleSpecification['sources'] = {
    route: { type: 'geojson', data: emptyLine() },
    flown: { type: 'geojson', data: emptyLine() },
    aim: { type: 'geojson', data: emptyLine() },
  };
  const layers: StyleSpecification['layers'] = [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfe6dd' } }];
  const raster = (tiles: string[], attribution: string, maxzoom: number) => {
    sources.base = { type: 'raster', tiles, tileSize: 256, attribution, maxzoom };
    layers.push({ id: 'base', type: 'raster', source: 'base' });
  };
  if (s.basemap === 'streets') raster(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], OSM, 19);
  else if (s.basemap === 'satellite')
    raster(['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'], EOX, 15);
  else if (s.basemap === 'custom' && /^https:\/\/.+\{z\}.+/.test(s.customTileUrl)) raster([s.customTileUrl.trim()], 'Custom map tiles', 20);

  const light = s.basemap === 'satellite' || s.basemap === 'custom';
  layers.push(
    { id: 'aim', type: 'line', source: 'aim', paint: { 'line-color': '#ff7a1a', 'line-width': 2, 'line-dasharray': [1, 2] } },
    { id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': light ? '#00131f' : '#ffffff', 'line-width': 8 } },
    { id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': light ? '#3ee0ff' : '#1557d6', 'line-width': 4 } },
    { id: 'flown', type: 'line', source: 'flown', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff9f1c', 'line-width': 5 } },
  );
  return { version: 8, sources, layers };
}

function emptyLine(): Feature<LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
}
function lineOf(points: LatLng[]): Feature<LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.length > 1 ? points.map((p) => [p.lng, p.lat]) : [] },
  };
}

/** The part of the route already covered at a given moment. */
function flownLine(path: FlightPath, here: LatLng, distance: number): LatLng[] {
  const out: LatLng[] = [];
  for (const leg of path.legs) {
    if (leg.d0 >= distance) break;
    leg.points.forEach((p, k) => {
      if (leg.d0 + leg.cum[k] <= distance) out.push(p);
    });
  }
  out.push(here);
  return out;
}

function makeWaypointEl(): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'wp-marker';
  el.innerHTML = '<span class="wp-tick"></span><span class="wp-num"></span>';
  return el;
}
function makePoiEl(): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'poi-marker';
  el.innerHTML = '<span class="poi-dot"></span><span class="poi-label"></span>';
  return el;
}
function makeDroneEl(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'drone-marker';
  el.innerHTML = `<div class="drone-rot"><svg viewBox="-60 -90 120 120" width="120" height="120" aria-hidden="true">
    <path class="drone-fov" d="M0 0 L-38 -84 A92 92 0 0 1 38 -84 Z"/>
    <path class="drone-body" d="M0 -18 L13 14 L0 7 L-13 14 Z"/>
  </svg></div>`;
  return el;
}

export function MapView() {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const drone = useRef<Marker | null>(null);
  const [styleTick, setStyleTick] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  const path = usePath();
  const mission = path.mission;
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const settings = useStore((s) => s.settings);
  const fitRequest = useStore((s) => s.fitRequest);
  const ready = useStore((s) => s.ready);
  const previewOn = useStore((s) => s.tab === 'preview');
  const previewT = useStore((s) => s.preview.t);

  // Create the map once.
  useEffect(() => {
    if (!holder.current) return;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: holder.current,
        style: buildStyle(useStore.getState().settings),
        center: [-113.8958, 40.7622],
        zoom: 14,
        maxZoom: 21,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
      });
    } catch (e) {
      setFailed('The map could not start. This browser may have WebGL turned off.');
      console.error(e);
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      'top-right',
    );
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), 'bottom-left');
    map.on('style.load', () => setStyleTick((n) => n + 1));
    const reportView = () => {
      const c = map.getCenter();
      const b = map.getBounds();
      const widthM = b.getSouthWest().distanceTo(b.getSouthEast());
      const heightM = b.getSouthWest().distanceTo(b.getNorthWest());
      useStore.getState().setMapView({ center: { lat: c.lat, lng: c.lng }, spanM: Math.min(widthM, heightM) });
    };
    map.on('moveend', reportView);
    map.on('load', reportView);
    map.on('click', (e) => {
      const target = e.originalEvent.target as Element | null;
      if (target?.closest('.wp-marker, .poi-marker')) return;
      const st = useStore.getState();
      const p = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      if (st.tool === 'waypoint') st.addWaypoint(p);
      else if (st.tool === 'poi') {
        st.addPoi(p);
        st.setTool('select');
      } else st.select(null);
    });
    mapRef.current = map;
    (window as unknown as { __waypathMap?: MlMap }).__waypathMap = map;
    const ms = markers.current;
    return () => {
      ms.forEach((m) => m.remove());
      ms.clear();
      drone.current?.remove();
      drone.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Swap the basemap. The overlay layers are part of the style, so they come back with it.
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    mapRef.current?.setStyle(buildStyle(settings), { diff: false });
  }, [settings.basemap, settings.customTileUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Route line.
  useEffect(() => {
    const src = mapRef.current?.getSource('route') as GeoJSONSource | undefined;
    src?.setData(lineOf(path.line));
  }, [path, styleTick]);

  // Waypoint and POI markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const st = useStore.getState;
    const seen = new Set<string>();

    const ensure = (id: string, kind: 'wp' | 'poi', p: LatLng): Marker => {
      seen.add(id);
      const existing = markers.current.get(id);
      if (!existing) {
        const el = kind === 'wp' ? makeWaypointEl() : makePoiEl();
        const created = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map);
        const move = () => {
          const ll = created.getLngLat();
          st().liveEdit((m) => {
            const item = kind === 'wp' ? m.waypoints.find((w) => w.id === id) : m.pois.find((x) => x.id === id);
            if (!item) return;
            item.lat = ll.lat;
            item.lng = ll.lng;
            item.groundElevM = null;
          });
        };
        created.on('dragstart', () => {
          st().beginGesture();
          st().select({ kind, id });
        });
        created.on('drag', move);
        created.on('dragend', () => {
          move();
          st().endGesture();
        });
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          st().select({ kind, id });
          if (st().tab !== 'route') st().setTab('route');
        });
        markers.current.set(id, created);
        return created;
      }
      const cur = existing.getLngLat();
      if (cur.lat !== p.lat || cur.lng !== p.lng) existing.setLngLat([p.lng, p.lat]);
      return existing;
    };

    mission.waypoints.forEach((w, i) => {
      const el = ensure(w.id, 'wp', w).getElement();
      const selected = selection?.kind === 'wp' && selection.id === w.id;
      el.classList.toggle('selected', selected);
      el.classList.toggle('first', i === 0);
      el.style.zIndex = selected ? '3' : '2';
      el.setAttribute('aria-label', `Waypoint ${i + 1}`);
      el.dataset.index = String(i + 1);
      (el.querySelector('.wp-num') as HTMLElement).textContent = String(i + 1);
      (el.querySelector('.wp-tick') as HTMLElement).style.transform = `rotate(${headingAtWaypoint(path, i)}deg)`;
    });
    mission.pois.forEach((p) => {
      const el = ensure(p.id, 'poi', p).getElement();
      el.classList.toggle('selected', selection?.kind === 'poi' && selection.id === p.id);
      el.setAttribute('aria-label', `Point of interest ${p.name}`);
      (el.querySelector('.poi-label') as HTMLElement).textContent = p.name;
    });
    for (const [id, mk] of markers.current) {
      if (!seen.has(id)) {
        mk.remove();
        markers.current.delete(id);
      }
    }
  }, [mission, selection, path]);

  // Preview drone, the flown part of the route, and the line to whatever the camera is aimed at.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const flown = map.getSource('flown') as GeoJSONSource | undefined;
    const aim = map.getSource('aim') as GeoJSONSource | undefined;
    const sample = previewOn ? sampleFlight(path, previewT) : null;
    if (!sample) {
      drone.current?.remove();
      drone.current = null;
      flown?.setData(emptyLine());
      aim?.setData(emptyLine());
      return;
    }
    const dm = drone.current ?? new maplibregl.Marker({ element: makeDroneEl(), anchor: 'center' }).setLngLat([sample.lng, sample.lat]).addTo(map);
    drone.current = dm;
    dm.setLngLat([sample.lng, sample.lat]);
    const el = dm.getElement();
    (el.querySelector('.drone-rot') as HTMLElement).style.transform = `rotate(${sample.headingDeg}deg)`;
    el.classList.toggle('recording', sample.recording);
    flown?.setData(lineOf(flownLine(path, sample, sample.distanceM)));

    const wp = mission.waypoints[sample.wpIndex];
    const spec = wp ? (wp.heading ?? mission.defaults.heading) : null;
    const poi = spec?.mode === 'poi' ? mission.pois.find((p) => p.id === spec.poiId) : undefined;
    aim?.setData(poi ? lineOf([sample, poi]) : emptyLine());
  }, [path, mission, previewOn, previewT, styleTick]);

  // Frame the whole plan when asked (opening a mission, the Fit button).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const m = useStore.getState().mission;
    const pts: LatLng[] = [...m.waypoints, ...m.pois];
    if (pts.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    pts.forEach((p) => b.extend([p.lng, p.lat]));
    const size = Math.min(holder.current?.clientWidth ?? 400, holder.current?.clientHeight ?? 400);
    // Leave room for the floating controls, but never more padding than the map can spare.
    const pad = Math.max(16, Math.min(90, size * 0.18));
    const extra = Math.min(50, size * 0.12);
    map.fitBounds(b, { padding: { top: pad + extra, bottom: pad + extra, left: pad, right: pad }, maxZoom: 17, duration: 0 });
  }, [fitRequest, ready]);

  return (
    <div className={`map-wrap tool-${tool}`}>
      <div ref={holder} className="map" role="application" aria-label="Mission map" />
      {failed && <div className="map-failed">{failed}</div>}
    </div>
  );
}
