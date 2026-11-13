import { ELEVATION_ATTRIBUTION } from '../domain/elevation';
import { hasElevation, type FlightPath } from '../domain/path';
import { LIMITS } from '../domain/types';
import { altFromDisplay, altToDisplay, speedFromDisplay, speedToDisplay, unitLabel } from '../domain/units';
import { useStore, type Basemap } from '../store/store';
import { decodeHeading, headingOptions } from './RouteTab';
import { NumberField, Section, Segmented, SelectField } from './fields';

export function MissionTab({ path }: { path: FlightPath }) {
  const mission = path.mission;
  const d = mission.defaults;
  const settings = useStore((s) => s.settings);
  const elevation = useStore((s) => s.elevation);
  const st = useStore.getState;
  const units = settings.units;
  const elev = hasElevation(mission);
  const headingValue = d.heading.mode === 'poi' ? `poi:${d.heading.poiId}` : d.heading.mode;

  return (
    <div className="tab-body">
      <div className="field">
        <label htmlFor="mission-name">Mission name</label>
        <input id="mission-name" type="text" value={mission.name} maxLength={80} onChange={(e) => void st().renameMission(mission.id, e.target.value, true)}
          onBlur={(e) => void st().renameMission(mission.id, e.target.value)}
        />
      </div>

      <Section title="Defaults for every waypoint">
        <NumberField
          label="Speed"
          value={speedToDisplay(d.speedMps, units)}
          unit={unitLabel.speed(units)}
          step={1}
          dp={1}
          min={speedToDisplay(LIMITS.speed.min, units)}
          max={speedToDisplay(LIMITS.speed.max, units)}
          onChange={(v) => st().updateDefaults({ speedMps: speedFromDisplay(v, units) }, 'speed')}
        />
        <NumberField
          label={`Altitude ${d.altitudeRef === 'agl' ? 'above ground (AGL)' : 'above takeoff point'}`}
          value={altToDisplay(d.altitudeM, units)}
          unit={unitLabel.alt(units)}
          step={units === 'metric' ? 5 : 10}
          dp={0}
          min={altToDisplay(LIMITS.altitude.min, units)}
          max={altToDisplay(LIMITS.altitude.max, units)}
          onChange={(v) => st().updateDefaults({ altitudeM: altFromDisplay(v, units) }, 'alt')}
        />
        <p className="hint">A waypoint can override either value. Speed applies to the leg leaving a waypoint.</p>
      </Section>

      <Section title="Altitude reference">
        <Segmented
          label="Altitude reference"
          value={d.altitudeRef}
          onChange={(v) => st().updateDefaults({ altitudeRef: v })}
          options={[
            { value: 'takeoff', label: 'Above takeoff point' },
            { value: 'agl', label: 'Above ground (AGL)', disabled: !elev && d.altitudeRef !== 'agl' },
          ]}
        />
        <p className={`hint ${d.altitudeRef === 'agl' && !path.aglResolved ? 'warn' : ''}`} role="status" data-testid="elevation-status">
          {d.altitudeRef === 'agl' && !path.aglResolved
            ? 'Terrain height is missing for some waypoints, so above-ground altitudes cannot be worked out right now. They are being treated as above takeoff until terrain data loads.'
            : elev
              ? d.altitudeRef === 'agl'
                ? 'Each altitude is measured from the ground directly under that waypoint. Terrain between waypoints is not checked.'
                : 'Every altitude is measured from where the drone takes off. Terrain data is loaded, so above-ground mode is available.'
              : mission.waypoints.length === 0
                ? 'Every altitude is measured from where the drone takes off. Above-ground mode becomes available once waypoints have terrain data.'
                : elevation === 'loading'
                  ? 'Looking up terrain heights…'
                  : 'Every altitude is measured from where the drone takes off. Above-ground mode is off because terrain data could not be loaded for every waypoint.'}
        </p>
        {!elev && mission.waypoints.length > 0 && elevation !== 'loading' && (
          <button type="button" className="btn" onClick={() => void st().refreshElevation()}>
            Try terrain lookup again
          </button>
        )}
        {elev && <p className="hint small">{ELEVATION_ATTRIBUTION}</p>}
      </Section>

      <Section title="Camera direction">
        <SelectField
          label="Drone heading"
          value={headingValue}
          options={headingOptions(mission, false)}
          onChange={(v) => st().updateDefaults({ heading: decodeHeading(v, d.heading) ?? { mode: 'route' } })}
        />
        {d.heading.mode === 'custom' && (
          <NumberField
            label="Heading (0° = north, 90° = east)"
            value={d.heading.deg}
            unit="°"
            step={15}
            dp={0}
            min={0}
            max={359}
            onChange={(v) => st().updateDefaults({ heading: { mode: 'custom', deg: v } }, 'hdg')}
          />
        )}
      </Section>

      <Section title="Turns">
        <Segmented
          label="Turns"
          value={d.turnMode}
          onChange={(v) => st().updateDefaults({ turnMode: v })}
          options={[
            { value: 'straight', label: 'Straight lines' },
            { value: 'curved', label: 'Smooth turns' },
          ]}
        />
        {d.turnMode === 'curved' && (
          <>
            <NumberField
              label="Start turning this far before a waypoint"
              value={altToDisplay(d.turnDistanceM, units)}
              unit={unitLabel.alt(units)}
              step={units === 'metric' ? 5 : 10}
              dp={0}
              min={0}
              max={altToDisplay(LIMITS.turnDistance.max, units)}
              onChange={(v) => st().updateDefaults({ turnDistanceM: altFromDisplay(v, units) }, 'turn')}
            />
            <p className="hint">The drone cuts inside each corner. Waypoints with a hold or camera action are still flown to exactly.</p>
          </>
        )}
      </Section>

      <Section title="Display">
        <Segmented
          label="Units"
          value={units}
          onChange={(v) => st().setSettings({ units: v })}
          options={[
            { value: 'metric', label: 'Metres' },
            { value: 'imperial', label: 'Feet' },
          ]}
        />
        <SelectField<Basemap>
          label="Map"
          value={settings.basemap}
          onChange={(v) => st().setSettings({ basemap: v })}
          options={[
            { value: 'streets', label: 'Streets (OpenStreetMap)' },
            { value: 'satellite', label: 'Satellite, low detail (Sentinel-2)' },
            { value: 'custom', label: 'Custom tile address' },
            { value: 'plain', label: 'No background' },
          ]}
        />
        {settings.basemap === 'custom' && (
          <div className="field">
            <label htmlFor="tile-url">Tile address</label>
            <input
              id="tile-url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/{z}/{x}/{y}.jpg"
              value={settings.customTileUrl}
              onChange={(e) => st().setSettings({ customTileUrl: e.target.value })}
            />
            <p className="hint">An https address with {'{z}'}, {'{x}'} and {'{y}'}, for example from a high-detail imagery provider you have a key for.</p>
          </div>
        )}
      </Section>
    </div>
  );
}
