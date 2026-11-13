import { create } from 'zustand';
import { lookupElevations } from '../domain/elevation';
import { buildIdea, type IdeaId } from '../domain/ideas';
import { hasElevation } from '../domain/path';
import { sampleMission } from '../domain/sample';
import {
  newId,
  newMission,
  newWaypoint,
  type LatLng,
  type Mission,
  type MissionDefaults,
  type Poi,
  type Waypoint,
} from '../domain/types';
import type { Units } from '../domain/units';
import { db } from './db';

export type Tool = 'select' | 'waypoint' | 'poi';
export type Selection = { kind: 'wp' | 'poi'; id: string } | null;
export type PanelTab = 'route' | 'preview' | 'mission';
export type Basemap = 'streets' | 'satellite' | 'custom' | 'plain';
export type ElevationStatus = 'idle' | 'loading' | 'ok' | 'unavailable';

export interface MissionSummary {
  id: string;
  name: string;
  updatedAt: string;
  waypoints: number;
}

export interface Settings {
  units: Units;
  basemap: Basemap;
  customTileUrl: string;
}

interface State {
  ready: boolean;
  storageError: string | null;
  mission: Mission;
  past: Mission[];
  future: Mission[];
  missions: MissionSummary[];
  selection: Selection;
  tool: Tool;
  tab: PanelTab;
  panelOpen: boolean;
  settings: Settings;
  elevation: ElevationStatus;
  toast: { id: number; text: string; kind: 'info' | 'error' } | null;
  preview: { t: number; playing: boolean; rate: number };
  /** Bumped to ask the map to frame the whole route. */
  fitRequest: number;
  /** Where the map is looking, so route ideas can be placed there. */
  mapView: { center: LatLng; spanM: number } | null;

  init: () => Promise<void>;
  edit: (fn: (m: Mission) => void, coalesceKey?: string) => void;
  beginGesture: () => void;
  liveEdit: (fn: (m: Mission) => void) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;

  addWaypoint: (p: LatLng, afterIndex?: number) => void;
  addPoi: (p: LatLng) => void;
  updateWaypoint: (id: string, patch: Partial<Waypoint>, coalesceKey?: string) => void;
  updatePoi: (id: string, patch: Partial<Poi>, coalesceKey?: string) => void;
  updateDefaults: (patch: Partial<MissionDefaults>, coalesceKey?: string) => void;
  moveWaypoint: (id: string, delta: -1 | 1) => void;
  removeSelected: () => void;
  removeItem: (sel: NonNullable<Selection>) => void;
  reverseRoute: () => void;
  /** Add a ready-made route shape around a subject. Returns how many waypoints were added. */
  addIdea: (id: IdeaId, sizeM: number) => number;
  setMapView: (v: { center: LatLng; spanM: number }) => void;

  select: (s: Selection) => void;
  setTool: (t: Tool) => void;
  setTab: (t: PanelTab) => void;
  setPanelOpen: (open: boolean) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setPreview: (patch: Partial<State['preview']>) => void;
  requestFit: () => void;
  notify: (text: string, kind?: 'info' | 'error') => void;
  dismissToast: () => void;

  renameMission: (id: string, name: string, typing?: boolean) => Promise<void>;
  createMission: () => Promise<void>;
  openMission: (id: string) => Promise<void>;
  duplicateMission: (id: string) => Promise<void>;
  deleteMission: (id: string) => Promise<void>;
  importMission: (m: Mission) => Promise<void>;
  flush: () => Promise<void>;
  refreshElevation: () => Promise<void>;
}

const HISTORY_LIMIT = 100;
const LAST_KEY = 'waypath.lastMission';
const SEEDED_KEY = 'waypath.seeded';
const SETTINGS_KEY = 'waypath.settings';

const ls = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: settings just do not persist */
    }
  },
};

function loadSettings(): Settings {
  const base: Settings = { units: 'metric', basemap: 'streets', customTileUrl: '' };
  try {
    const raw = JSON.parse(ls.get(SETTINGS_KEY) ?? '{}');
    return {
      units: raw.units === 'imperial' ? 'imperial' : 'metric',
      basemap: ['streets', 'satellite', 'custom', 'plain'].includes(raw.basemap) ? raw.basemap : base.basemap,
      customTileUrl: typeof raw.customTileUrl === 'string' ? raw.customTileUrl : '',
    };
  } catch {
    return base;
  }
}

const clone = (m: Mission): Mission => structuredClone(m);
const summary = (m: Mission): MissionSummary => ({
  id: m.id,
  name: m.name,
  updatedAt: m.updatedAt,
  waypoints: m.waypoints.length,
});
const sortSummaries = (list: MissionSummary[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let elevTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
let lastCoalesce: { key: string; at: number } | null = null;
let gestureSnapshot: Mission | null = null;
let toastId = 0;

export const useStore = create<State>()((set, get) => {
  /** Apply a change to the mission, then schedule saving and a terrain lookup. */
  function commit(next: Mission, extra: Partial<State> = {}) {
    next.updatedAt = new Date().toISOString();
    // Keep the selection only while the thing it points at still exists.
    const sel = get().selection;
    const stillThere =
      sel && (sel.kind === 'wp' ? next.waypoints.some((w) => w.id === sel.id) : next.pois.some((p) => p.id === sel.id));
    set({
      mission: next,
      selection: stillThere ? sel : null,
      missions: sortSummaries([summary(next), ...get().missions.filter((s) => s.id !== next.id)]),
      ...extra,
    });
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flush(), 250);
    clearTimeout(elevTimer);
    elevTimer = setTimeout(() => void get().refreshElevation(), 600);
  }

  function pushHistory(before: Mission): Pick<State, 'past' | 'future'> {
    return { past: [...get().past.slice(-(HISTORY_LIMIT - 1)), before], future: [] };
  }

  async function switchTo(m: Mission) {
    await get().flush();
    lastCoalesce = null;
    set({
      mission: m,
      past: [],
      future: [],
      selection: null,
      preview: { t: 0, playing: false, rate: get().preview.rate },
      missions: sortSummaries([summary(m), ...get().missions.filter((s) => s.id !== m.id)]),
      fitRequest: get().fitRequest + 1,
    });
    ls.set(LAST_KEY, m.id);
    clearTimeout(elevTimer);
    elevTimer = setTimeout(() => void get().refreshElevation(), 300);
  }

  return {
    ready: false,
    storageError: null,
    mission: newMission(),
    past: [],
    future: [],
    missions: [],
    selection: null,
    tool: 'select',
    tab: 'route',
    panelOpen: true,
    settings: loadSettings(),
    elevation: 'idle',
    toast: null,
    preview: { t: 0, playing: false, rate: 5 },
    fitRequest: 0,
    mapView: null,

    async init() {
      try {
        let all = await db.all();
        if (all.length === 0 && !ls.get(SEEDED_KEY)) {
          const sample = sampleMission();
          await db.put(sample);
          all = [sample];
        }
        ls.set(SEEDED_KEY, '1');
        let current = all.find((m) => m.id === ls.get(LAST_KEY));
        if (!current) current = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (!current) {
          current = newMission();
          await db.put(current);
          all = [current];
        }
        ls.set(LAST_KEY, current.id);
        set({
          ready: true,
          mission: current,
          missions: sortSummaries(all.map(summary)),
          fitRequest: get().fitRequest + 1,
        });
        void get().refreshElevation();
      } catch (e) {
        // Still usable without storage (for example a locked-down private window); say so plainly.
        set({
          ready: true,
          mission: sampleMission(),
          storageError:
            'This browser is not letting Waypath store data, so missions will not be saved. Export a mission file to keep your work.',
          fitRequest: get().fitRequest + 1,
        });
        console.error(e);
      }
    },

    edit(fn, coalesceKey) {
      const before = get().mission;
      const next = clone(before);
      fn(next);
      const now = Date.now();
      // Rapid changes to the same field (typing, stepper taps) collapse into one undo step.
      const merge = coalesceKey != null && lastCoalesce?.key === coalesceKey && now - lastCoalesce.at < 1500;
      lastCoalesce = coalesceKey != null ? { key: coalesceKey, at: now } : null;
      commit(next, merge ? { future: [] } : pushHistory(before));
    },

    beginGesture() {
      gestureSnapshot = get().mission;
    },
    liveEdit(fn) {
      const next = clone(get().mission);
      fn(next);
      commit(next);
    },
    endGesture() {
      if (gestureSnapshot && gestureSnapshot !== get().mission) {
        lastCoalesce = null;
        set(pushHistory(gestureSnapshot));
      }
      gestureSnapshot = null;
    },

    undo() {
      const { past, future, mission } = get();
      if (!past.length) return;
      lastCoalesce = null;
      commit(clone(past[past.length - 1]), { past: past.slice(0, -1), future: [mission, ...future] });
    },
    redo() {
      const { past, future, mission } = get();
      if (!future.length) return;
      lastCoalesce = null;
      commit(clone(future[0]), { past: [...past, mission], future: future.slice(1) });
    },

    addWaypoint(p, afterIndex) {
      const wp = newWaypoint(p);
      get().edit((m) => {
        if (afterIndex == null) m.waypoints.push(wp);
        else m.waypoints.splice(afterIndex + 1, 0, wp);
      });
      set({ selection: { kind: 'wp', id: wp.id } });
    },
    addPoi(p) {
      const poi: Poi = {
        id: newId(),
        name: `POI ${get().mission.pois.length + 1}`,
        lat: p.lat,
        lng: p.lng,
        heightM: 0,
        groundElevM: null,
      };
      get().edit((m) => void m.pois.push(poi));
      set({ selection: { kind: 'poi', id: poi.id } });
    },
    updateWaypoint(id, patch, coalesceKey) {
      get().edit((m) => {
        const w = m.waypoints.find((x) => x.id === id);
        if (!w) return;
        if (('lat' in patch && patch.lat !== w.lat) || ('lng' in patch && patch.lng !== w.lng)) w.groundElevM = null;
        Object.assign(w, patch);
      }, coalesceKey && `wp:${id}:${coalesceKey}`);
    },
    updatePoi(id, patch, coalesceKey) {
      get().edit((m) => {
        const p = m.pois.find((x) => x.id === id);
        if (!p) return;
        if (('lat' in patch && patch.lat !== p.lat) || ('lng' in patch && patch.lng !== p.lng)) p.groundElevM = null;
        Object.assign(p, patch);
      }, coalesceKey && `poi:${id}:${coalesceKey}`);
    },
    updateDefaults(patch, coalesceKey) {
      get().edit((m) => void Object.assign(m.defaults, patch), coalesceKey && `def:${coalesceKey}`);
    },
    moveWaypoint(id, delta) {
      const i = get().mission.waypoints.findIndex((w) => w.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= get().mission.waypoints.length) return;
      get().edit((m) => {
        const [w] = m.waypoints.splice(i, 1);
        m.waypoints.splice(j, 0, w);
      });
    },
    removeSelected() {
      const sel = get().selection;
      if (sel) get().removeItem(sel);
    },
    removeItem(sel) {
      get().edit((m) => {
        if (sel.kind === 'wp') {
          m.waypoints = m.waypoints.filter((w) => w.id !== sel.id);
          return;
        }
        m.pois = m.pois.filter((p) => p.id !== sel.id);
        // Anything that was aimed at the removed POI goes back to a safe setting.
        if (m.defaults.heading.mode === 'poi' && m.defaults.heading.poiId === sel.id) m.defaults.heading = { mode: 'route' };
        for (const w of m.waypoints) {
          if (w.heading?.mode === 'poi' && w.heading.poiId === sel.id) w.heading = null;
          if (w.gimbal.mode === 'poi' && w.gimbal.poiId === sel.id) w.gimbal = { mode: 'none' };
        }
      });
    },
    reverseRoute() {
      get().edit((m) => void m.waypoints.reverse());
    },

    addIdea(id, sizeM) {
      const { mission, selection, mapView } = get();
      // Build around the selected point of interest if there is one, otherwise the middle of the map.
      const chosen = selection?.kind === 'poi' ? mission.pois.find((p) => p.id === selection.id) : undefined;
      const center = chosen ?? mapView?.center;
      if (!center) return 0;
      const poi: Poi = chosen ?? { id: newId(), name: `Subject ${mission.pois.length + 1}`, lat: center.lat, lng: center.lng, heightM: 0, groundElevM: null };
      const waypoints = buildIdea(id, center, sizeM, poi.id, mission.defaults.altitudeM);
      get().edit((m) => {
        if (!chosen) m.pois.push(poi);
        m.waypoints.push(...waypoints);
      });
      set({ selection: null, fitRequest: get().fitRequest + 1 });
      return waypoints.length;
    },
    setMapView: (mapView) => set({ mapView }),

    select: (selection) => set({ selection }),
    setTool: (tool) => set({ tool }),
    setTab: (tab) => set({ tab, panelOpen: true }),
    setPanelOpen: (panelOpen) => set({ panelOpen }),
    setSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      ls.set(SETTINGS_KEY, JSON.stringify(settings));
    },
    setPreview: (patch) => set({ preview: { ...get().preview, ...patch } }),
    requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
    notify: (text, kind = 'info') => set({ toast: { id: ++toastId, text, kind } }),
    dismissToast: () => set({ toast: null }),

    async renameMission(id, nameIn, typing = false) {
      // While someone is typing, keep exactly what they typed (trimming here would eat the spaces between words).
      const name = typing ? nameIn.slice(0, 80) : nameIn.trim().slice(0, 80) || 'Untitled mission';
      if (id === get().mission.id) {
        if (name !== get().mission.name) get().edit((m) => void (m.name = name), 'rename');
        return;
      }
      const m = await db.get(id);
      if (!m) return;
      m.name = name;
      m.updatedAt = new Date().toISOString();
      await db.put(m);
      set({ missions: sortSummaries([summary(m), ...get().missions.filter((s) => s.id !== id)]) });
    },
    async createMission() {
      const m = newMission();
      await db.put(m).catch(() => undefined);
      await switchTo(m);
    },
    async openMission(id) {
      if (id === get().mission.id) return;
      await get().flush();
      const m = await db.get(id);
      if (m) await switchTo(m);
      else get().notify('That mission could not be found on this device.', 'error');
    },
    async duplicateMission(id) {
      await get().flush();
      const src = id === get().mission.id ? get().mission : await db.get(id);
      if (!src) return;
      const now = new Date().toISOString();
      const copy: Mission = { ...clone(src), id: newId(), name: `${src.name} copy`, createdAt: now, updatedAt: now };
      await db.put(copy).catch(() => undefined);
      await switchTo(copy);
    },
    async deleteMission(id) {
      await get().flush();
      await db.remove(id).catch(() => undefined);
      const rest = get().missions.filter((s) => s.id !== id);
      set({ missions: rest });
      if (id !== get().mission.id) return;
      dirty = false;
      const next = rest[0] && (await db.get(rest[0].id));
      if (next) await switchTo(next);
      else await get().createMission();
    },
    async importMission(incoming) {
      const m = clone(incoming);
      // Never overwrite a mission already on this device: a clashing file comes in as a separate copy.
      if (get().missions.some((s) => s.id === m.id)) {
        m.id = newId();
        m.name = `${m.name} (imported)`;
      }
      m.updatedAt = new Date().toISOString();
      await db.put(m).catch(() => undefined);
      await switchTo(m);
    },

    async flush() {
      clearTimeout(saveTimer);
      if (!dirty || get().storageError) return;
      dirty = false;
      try {
        await db.put(get().mission);
        ls.set(LAST_KEY, get().mission.id);
      } catch (e) {
        dirty = true;
        console.error(e);
        get().notify('Could not save to this device. Export a mission file to keep your work.', 'error');
      }
    },

    async refreshElevation() {
      const start = get().mission;
      const targets: { kind: 'wp' | 'poi'; id: string; p: LatLng }[] = [
        ...start.waypoints.filter((w) => w.groundElevM == null).map((w) => ({ kind: 'wp' as const, id: w.id, p: w })),
        ...start.pois.filter((p) => p.groundElevM == null).map((p) => ({ kind: 'poi' as const, id: p.id, p })),
      ];
      if (targets.length === 0) {
        set({ elevation: hasElevation(start) ? 'ok' : 'idle' });
        return;
      }
      set({ elevation: 'loading' });
      const heights = await lookupElevations(targets.map((t) => t.p));
      const cur = get().mission;
      if (cur.id !== start.id) return;
      // Terrain heights are filled in quietly: they are looked-up facts, not edits to undo.
      const next = clone(cur);
      let changed = false;
      targets.forEach((t, i) => {
        const h = heights[i];
        if (h == null) return;
        const item = t.kind === 'wp' ? next.waypoints.find((w) => w.id === t.id) : next.pois.find((p) => p.id === t.id);
        // Skip anything that moved while the lookup was in flight.
        if (!item || item.lat !== t.p.lat || item.lng !== t.p.lng || item.groundElevM != null) return;
        item.groundElevM = h;
        changed = true;
      });
      if (changed) {
        next.updatedAt = cur.updatedAt;
        set({ mission: next });
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void get().flush(), 250);
      }
      set({ elevation: hasElevation(get().mission) ? 'ok' : heights.some((h) => h == null) ? 'unavailable' : 'idle' });
    },
  };
});

if (typeof window !== 'undefined') {
  const flush = () => void useStore.getState().flush();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('online', () => void useStore.getState().refreshElevation());
}
