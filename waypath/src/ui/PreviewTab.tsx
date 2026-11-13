import { sampleFlight, type FlightPath } from '../domain/path';
import { fmtAlt, fmtDistance, fmtDuration, fmtSpeed } from '../domain/units';
import { useStore } from '../store/store';
import { Icon } from './Icon';
import { altRefLabel } from './RouteTab';
import { Segmented } from './fields';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];
const RATES = [1, 2, 5, 10, 20];

export function PreviewTab({ path }: { path: FlightPath }) {
  const preview = useStore((s) => s.preview);
  const units = useStore((s) => s.settings.units);
  const st = useStore.getState;
  const total = path.totalDurationS;
  const s = sampleFlight(path, preview.t);

  if (!s || path.mission.waypoints.length < 2) {
    return (
      <div className="tab-body">
        <p className="empty">Add at least two waypoints to preview the flight.</p>
      </div>
    );
  }
  const atEnd = preview.t >= total;
  const n = path.mission.waypoints.length;
  const where =
    s.phase === 'move' ? `Flying ${s.wpIndex + 1} → ${s.nextWpIndex + 1}` : s.phase === 'hold' ? `Holding at ${s.wpIndex + 1}` : s.phase === 'done' ? `Finished at ${n}` : `At ${s.wpIndex + 1}`;

  return (
    <div className="tab-body">
      <div className="transport">
        <button
          type="button"
          className="btn primary play"
          aria-label={preview.playing ? 'Pause' : 'Play'}
          onClick={() => st().setPreview(preview.playing ? { playing: false } : { playing: true, t: atEnd ? 0 : preview.t })}
        >
          <Icon name={preview.playing ? 'pause' : 'play'} size={26} />
        </button>
        <button type="button" className="icon-btn" aria-label="Back to start" onClick={() => st().setPreview({ t: 0, playing: false })}>
          <Icon name="restart" />
        </button>
        <div className="clock" aria-live="off">
          <span data-testid="preview-time">{fmtDuration(preview.t)}</span> / {fmtDuration(total)}
        </div>
      </div>
      <input
        className="scrub"
        type="range"
        aria-label="Flight position"
        min={0}
        max={Math.max(total, 0.1)}
        step={0.1}
        value={Math.min(preview.t, total)}
        onChange={(e) => st().setPreview({ t: Number(e.target.value), playing: false })}
      />
      <Segmented
        label="Playback speed"
        value={String(preview.rate)}
        onChange={(v) => st().setPreview({ rate: Number(v) })}
        options={RATES.map((r) => ({ value: String(r), label: `${r}×` }))}
      />

      <dl className="telemetry" data-testid="telemetry">
        <div>
          <dt>Waypoint</dt>
          <dd data-testid="tm-waypoint">{where}</dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd data-testid="tm-altitude">
            {fmtAlt(s.altRelM, units)} <small>above takeoff</small>
            {s.altAglM != null && (
              <small>
                {' '}
                · ≈{fmtAlt(s.altAglM, units)} above ground
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>Heading</dt>
          <dd data-testid="tm-heading">
            {Math.round(s.headingDeg) % 360}° {compass(s.headingDeg)}
          </dd>
        </div>
        <div>
          <dt>Gimbal</dt>
          <dd>{Math.round(s.gimbalPitchDeg)}°</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{fmtSpeed(s.speedMps, units)}</dd>
        </div>
        <div>
          <dt>Flown</dt>
          <dd>
            {fmtDistance(s.distanceM, units)} <small>of {fmtDistance(path.totalDistanceM, units)}</small>
          </dd>
        </div>
        <div>
          <dt>Camera</dt>
          <dd>
            {s.recording ? <span className="rec">● REC</span> : 'Not recording'}
            {s.photos > 0 && <small> · {s.photos} photo{s.photos > 1 ? 's' : ''}</small>}
          </dd>
        </div>
      </dl>
      {!path.aglResolved && <p className="hint warn">Altitudes shown are {altRefLabel(path.mission)} values treated as above takeoff, because terrain data is missing.</p>}
      <p className="hint small">
        The preview flies the same path used for the distance and time totals. It does not model acceleration, wind, or the time the drone takes to rotate or climb.
      </p>
    </div>
  );
}
