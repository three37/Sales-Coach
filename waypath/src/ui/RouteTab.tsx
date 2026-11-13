import { hasElevation, isStop, wpAltitude, wpSpeed, type FlightPath } from '../domain/path';
import { LIMITS, type GimbalSpec, type HeadingSpec, type Mission, type Poi, type Waypoint, type WaypointAction } from '../domain/types';
import { altFromDisplay, altToDisplay, fmtAlt, fmtDistance, fmtSpeed, speedFromDisplay, speedToDisplay, unitLabel, type Units } from '../domain/units';
import { useStore } from '../store/store';
import { Icon } from './Icon';
import { NumberField, Section, SelectField, Toggle } from './fields';

export const ACTION_LABEL: Record<WaypointAction, string> = {
  none: 'No action',
  photo: 'Take photo',
  recordStart: 'Start recording',
  recordStop: 'Stop recording',
};

export function altRefLabel(m: Mission): string {
  return m.defaults.altitudeRef === 'agl' ? 'above ground' : 'above takeoff';
}

export function describeHeading(m: Mission, h: HeadingSpec): string {
  if (h.mode === 'route') return 'follow route';
  if (h.mode === 'custom') return `${Math.round(h.deg)}°`;
  return `face ${m.pois.find((p) => p.id === h.poiId)?.name ?? 'POI'}`;
}

const encodeHeading = (h: HeadingSpec | null) => (!h ? 'default' : h.mode === 'poi' ? `poi:${h.poiId}` : h.mode);
export function decodeHeading(v: string, previous: HeadingSpec | null): HeadingSpec | null {
  if (v === 'default') return null;
  if (v === 'route') return { mode: 'route' };
  if (v === 'custom') return { mode: 'custom', deg: previous?.mode === 'custom' ? previous.deg : 0 };
  return { mode: 'poi', poiId: v.slice(4) };
}
export function headingOptions(m: Mission, withDefault: boolean) {
  return [
    ...(withDefault ? [{ value: 'default', label: `Mission default (${describeHeading(m, m.defaults.heading)})` }] : []),
    { value: 'route', label: 'Follow the route' },
    { value: 'custom', label: 'Custom heading' },
    ...m.pois.map((p) => ({ value: `poi:${p.id}`, label: `Face ${p.name}` })),
    ...(m.pois.length === 0 ? [{ value: 'poi:', label: 'Face a point of interest (add one first)', disabled: true }] : []),
  ];
}

export function RouteTab({ path }: { path: FlightPath }) {
  const mission = path.mission;
  const selection = useStore((s) => s.selection);
  const units = useStore((s) => s.settings.units);
  const st = useStore.getState;

  if (selection?.kind === 'wp') {
    const i = mission.waypoints.findIndex((w) => w.id === selection.id);
    if (i >= 0) return <WaypointEditor path={path} index={i} units={units} />;
  }
  if (selection?.kind === 'poi') {
    const poi = mission.pois.find((p) => p.id === selection.id);
    if (poi) return <PoiEditor mission={mission} poi={poi} units={units} />;
  }

  return (
    <div className="tab-body">
      {mission.waypoints.length === 0 ? (
        <p className="empty">
          No waypoints yet. Choose <strong>Waypoint</strong> on the map, then tap or click where the drone should fly.
        </p>
      ) : (
        <ol className="wp-list" aria-label="Waypoints">
          {mission.waypoints.map((w, i) => {
            const leg = path.legs[i];
            return (
              <li key={w.id}>
                <button type="button" className="row-main" onClick={() => st().select({ kind: 'wp', id: w.id })} aria-label={`Edit waypoint ${i + 1}`}>
                  <span className="badge">{i + 1}</span>
                  <span className="row-text">
                    <span className="row-title">
                      {fmtAlt(wpAltitude(mission, w), units)}
                      {w.altitudeM != null && <em title="Overrides the mission default"> set</em>}
                      {leg && (
                        <>
                          {' · '}
                          {fmtSpeed(wpSpeed(mission, w), units)}
                          {w.speedMps != null && <em title="Overrides the mission default"> set</em>}
                        </>
                      )}
                    </span>
                    <span className="row-sub">
                      {[
                        leg ? `${fmtDistance(leg.lengthM, units)} to next` : 'End of route',
                        w.heading ? describeHeading(mission, w.heading) : '',
                        w.holdSec > 0 ? `hold ${w.holdSec}s` : '',
                        w.action !== 'none' ? ACTION_LABEL[w.action].toLowerCase() : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
                <button type="button" className="icon-btn" disabled={i === 0} onClick={() => st().moveWaypoint(w.id, -1)} aria-label={`Move waypoint ${i + 1} earlier`}>
                  <Icon name="up" />
                </button>
                <button type="button" className="icon-btn" disabled={i === mission.waypoints.length - 1} onClick={() => st().moveWaypoint(w.id, 1)} aria-label={`Move waypoint ${i + 1} later`}>
                  <Icon name="down" />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <Section title="Points of interest">
        {mission.pois.length === 0 ? (
          <p className="hint">None yet. Choose <strong>POI</strong> on the map and tap the subject you want the camera to look at.</p>
        ) : (
          <ul className="wp-list" aria-label="Points of interest">
            {mission.pois.map((p) => (
              <li key={p.id}>
                <button type="button" className="row-main" onClick={() => st().select({ kind: 'poi', id: p.id })} aria-label={`Edit point of interest ${p.name}`}>
                  <span className="badge poi">◆</span>
                  <span className="row-text">
                    <span className="row-title">{p.name}</span>
                    <span className="row-sub">
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {mission.waypoints.length > 1 && (
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => st().reverseRoute()}>
            <Icon name="swap" size={18} /> Reverse route
          </button>
        </div>
      )}
    </div>
  );
}

function EditorHeader({ title, onPrev, onNext }: { title: string; onPrev?: () => void; onNext?: () => void }) {
  return (
    <div className="editor-head">
      <button type="button" className="btn" onClick={() => useStore.getState().select(null)}>
        <Icon name="chevronLeft" size={18} /> Route
      </button>
      <h2>{title}</h2>
      {(onPrev || onNext) && (
        <span className="pager">
          <button type="button" className="icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="Previous waypoint">
            <Icon name="chevronLeft" />
          </button>
          <button type="button" className="icon-btn" onClick={onNext} disabled={!onNext} aria-label="Next waypoint">
            <Icon name="chevronRight" />
          </button>
        </span>
      )}
    </div>
  );
}

function PositionFields({ lat, lng, onChange }: { lat: number; lng: number; onChange: (p: { lat?: number; lng?: number }) => void }) {
  return (
    <div className="grid2">
      <NumberField label="Latitude" value={lat} dp={6} min={-85} max={85} noStepper onChange={(v) => onChange({ lat: v })} />
      <NumberField label="Longitude" value={lng} dp={6} min={-180} max={180} noStepper onChange={(v) => onChange({ lng: v })} />
    </div>
  );
}

function WaypointEditor({ path, index, units }: { path: FlightPath; index: number; units: Units }) {
  const mission = path.mission;
  const w = mission.waypoints[index];
  const st = useStore.getState;
  const set = (patch: Partial<Waypoint>, key?: string) => st().updateWaypoint(w.id, patch, key);
  const last = index === mission.waypoints.length - 1;
  const d = mission.defaults;
  const agl = d.altitudeRef === 'agl';
  const elev = hasElevation(mission);
  const go = (j: number) => () => st().select({ kind: 'wp', id: mission.waypoints[j].id });

  const gimbalValue = w.gimbal.mode === 'poi' ? `poi:${w.gimbal.poiId}` : w.gimbal.mode;
  const setGimbal = (v: string) => {
    const g: GimbalSpec =
      v === 'none' ? { mode: 'none' } : v === 'pitch' ? { mode: 'pitch', deg: w.gimbal.mode === 'pitch' ? w.gimbal.deg : -30 } : { mode: 'poi', poiId: v.slice(4) };
    set({ gimbal: g });
  };

  let terrain: string;
  if (w.groundElevM == null) terrain = 'Terrain height is not available for this point yet.';
  else if (!elev) terrain = `Ground here is ${fmtAlt(w.groundElevM, units)} above sea level.`;
  else {
    const g0 = mission.waypoints[0].groundElevM as number;
    const rel = path.relAlt[index];
    terrain = agl
      ? `Ground here is ${fmtAlt(w.groundElevM, units)} above sea level. That puts this waypoint ${fmtAlt(rel, units)} above the takeoff point (taken as waypoint 1).`
      : `Ground here is ${fmtAlt(w.groundElevM, units)} above sea level, so this waypoint is about ${fmtAlt(rel + g0 - w.groundElevM, units)} above the ground (if you take off at waypoint 1).`;
  }

  return (
    <div className="tab-body">
      <EditorHeader title={`Waypoint ${index + 1}`} onPrev={index > 0 ? go(index - 1) : undefined} onNext={!last ? go(index + 1) : undefined} />

      <Section title={`Altitude ${altRefLabel(mission)}${agl ? ' (AGL)' : ' point'}`}>
        <Toggle
          label={`Use mission default (${fmtAlt(d.altitudeM, units)})`}
          checked={w.altitudeM == null}
          onChange={(on) => set({ altitudeM: on ? null : d.altitudeM })}
        />
        {w.altitudeM != null && (
          <NumberField
            label="Altitude"
            compact
            value={altToDisplay(w.altitudeM, units)}
            unit={unitLabel.alt(units)}
            step={units === 'metric' ? 5 : 10}
            dp={0}
            min={altToDisplay(LIMITS.altitude.min, units)}
            max={altToDisplay(LIMITS.altitude.max, units)}
            onChange={(v) => set({ altitudeM: altFromDisplay(v, units) }, 'alt')}
          />
        )}
        <p className="hint">{terrain}</p>
      </Section>

      <Section title="Speed to next waypoint">
        {last ? (
          <p className="hint">This is the last waypoint, so no leg follows it.</p>
        ) : (
          <>
            <Toggle
              label={`Use mission default (${fmtSpeed(d.speedMps, units)})`}
              checked={w.speedMps == null}
              onChange={(on) => set({ speedMps: on ? null : d.speedMps })}
            />
            {w.speedMps != null && (
              <NumberField
                label="Speed"
                compact
                value={speedToDisplay(w.speedMps, units)}
                unit={unitLabel.speed(units)}
                step={1}
                dp={1}
                min={speedToDisplay(LIMITS.speed.min, units)}
                max={speedToDisplay(LIMITS.speed.max, units)}
                onChange={(v) => set({ speedMps: speedFromDisplay(v, units) }, 'speed')}
              />
            )}
          </>
        )}
      </Section>

      <Section title="Camera direction">
        <SelectField
          label="Drone heading from here"
          value={encodeHeading(w.heading)}
          options={headingOptions(mission, true)}
          onChange={(v) => set({ heading: decodeHeading(v, w.heading) })}
        />
        {w.heading?.mode === 'custom' && (
          <NumberField
            label="Heading (0° = north, 90° = east)"
            value={w.heading.deg}
            unit="°"
            step={15}
            dp={0}
            min={0}
            max={359}
            onChange={(v) => set({ heading: { mode: 'custom', deg: v } }, 'hdg')}
          />
        )}
        <SelectField
          label="Gimbal pitch"
          value={gimbalValue}
          options={[
            { value: 'none', label: 'Leave unchanged' },
            { value: 'pitch', label: 'Set a pitch angle' },
            ...mission.pois.map((p) => ({ value: `poi:${p.id}`, label: `Tilt at ${p.name}` })),
          ]}
          onChange={setGimbal}
        />
        {w.gimbal.mode === 'pitch' && (
          <NumberField
            label="Pitch (0° = level, −90° = straight down)"
            value={w.gimbal.deg}
            unit="°"
            step={5}
            dp={0}
            min={LIMITS.gimbal.min}
            max={LIMITS.gimbal.max}
            onChange={(v) => set({ gimbal: { mode: 'pitch', deg: v } }, 'gimbal')}
          />
        )}
      </Section>

      <Section title="At this waypoint">
        <NumberField label="Hold time" value={w.holdSec} unit="s" step={1} dp={0} min={LIMITS.hold.min} max={LIMITS.hold.max} onChange={(v) => set({ holdSec: v }, 'hold')} />
        <SelectField
          label="Camera action"
          value={w.action}
          options={(Object.keys(ACTION_LABEL) as WaypointAction[]).map((a) => ({ value: a, label: ACTION_LABEL[a] }))}
          onChange={(v) => set({ action: v })}
        />
        {d.turnMode === 'curved' && isStop(w) && !last && index > 0 && (
          <p className="hint">Because of the hold or action, the drone stops here instead of curving past.</p>
        )}
      </Section>

      <Section title="Position">
        <PositionFields lat={w.lat} lng={w.lng} onChange={(p) => set(p, 'pos')} />
        <p className="hint">Drag the marker on the map, or use the arrow keys to nudge it.</p>
      </Section>

      <div className="btn-row">
        {!last && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              const n = mission.waypoints[index + 1];
              st().addWaypoint({ lat: (w.lat + n.lat) / 2, lng: (w.lng + n.lng) / 2 }, index);
            }}
          >
            <Icon name="plus" size={18} /> Insert waypoint after
          </button>
        )}
        <button type="button" className="btn danger" onClick={() => st().removeItem({ kind: 'wp', id: w.id })}>
          <Icon name="trash" size={18} /> Delete waypoint
        </button>
      </div>
    </div>
  );
}

function PoiEditor({ mission, poi, units }: { mission: Mission; poi: Poi; units: Units }) {
  const st = useStore.getState;
  const set = (patch: Partial<Poi>, key?: string) => st().updatePoi(poi.id, patch, key);
  const users = mission.waypoints.filter((w) => {
    const h = w.heading ?? mission.defaults.heading;
    return (h.mode === 'poi' && h.poiId === poi.id) || (w.gimbal.mode === 'poi' && w.gimbal.poiId === poi.id);
  }).length;
  return (
    <div className="tab-body">
      <EditorHeader title="Point of interest" />
      <div className="field">
        <label htmlFor="poi-name">Name</label>
        <input id="poi-name" type="text" value={poi.name} maxLength={40} onChange={(e) => set({ name: e.target.value }, 'name')} />
      </div>
      <NumberField
        label={`Subject height ${altRefLabel(mission)}`}
        value={altToDisplay(poi.heightM, units)}
        unit={unitLabel.alt(units)}
        step={units === 'metric' ? 1 : 5}
        dp={0}
        min={altToDisplay(LIMITS.altitude.min, units)}
        max={altToDisplay(LIMITS.altitude.max, units)}
        onChange={(v) => set({ heightM: altFromDisplay(v, units) }, 'height')}
      />
      <p className="hint">Used when a waypoint tilts the gimbal at this point. {users} of {mission.waypoints.length} waypoints aim at it.</p>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => st().updateDefaults({ heading: { mode: 'poi', poiId: poi.id } })}>
          <Icon name="target" size={18} /> Face this for the whole mission
        </button>
      </div>
      <Section title="Position">
        <PositionFields lat={poi.lat} lng={poi.lng} onChange={(p) => set(p, 'pos')} />
      </Section>
      <div className="btn-row">
        <button type="button" className="btn danger" onClick={() => st().removeItem({ kind: 'poi', id: poi.id })}>
          <Icon name="trash" size={18} /> Delete point of interest
        </button>
      </div>
    </div>
  );
}
