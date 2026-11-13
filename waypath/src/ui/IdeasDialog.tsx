import { useState } from 'react';
import { IDEAS } from '../domain/ideas';
import { clamp } from '../domain/geo';
import { altFromDisplay, altToDisplay, fmtAlt, unitLabel } from '../domain/units';
import { useStore } from '../store/store';
import { Dialog } from './Dialogs';
import { NumberField } from './fields';

/** Ready-made route shapes, placed around the selected point of interest or the middle of the map. */
export function IdeasDialog({ onClose }: { onClose: () => void }) {
  const mission = useStore((s) => s.mission);
  const selection = useStore((s) => s.selection);
  const mapView = useStore((s) => s.mapView);
  const units = useStore((s) => s.settings.units);
  const st = useStore.getState;
  const poi = selection?.kind === 'poi' ? mission.pois.find((p) => p.id === selection.id) : undefined;
  // Start with a size that fits comfortably in what the map is showing.
  const [sizeM, setSizeM] = useState(() => Math.round(clamp((mapView?.spanM ?? 400) * 0.2, 20, 500) / 5) * 5);

  return (
    <Dialog title="Route ideas" onClose={onClose}>
      <p className="hint">
        {poi ? `Built around “${poi.name}”.` : 'Built around the middle of the map, where a new point of interest is added. To use a subject you have already placed, select it first.'}{' '}
        Waypoints use the mission altitude ({fmtAlt(mission.defaults.altitudeM, units)}) and are added after any you already have. Undo removes them.
      </p>
      <NumberField
        label="Size (orbit radius, or half the length of a pass)"
        value={altToDisplay(sizeM, units)}
        unit={unitLabel.alt(units)}
        step={units === 'metric' ? 10 : 25}
        dp={0}
        min={altToDisplay(10, units)}
        max={altToDisplay(2000, units)}
        onChange={(v) => setSizeM(altFromDisplay(v, units))}
      />
      {IDEAS.map((idea) => (
        <div className="export-row" key={idea.id}>
          <div>
            <strong>{idea.title}</strong>
            <p className="hint">{idea.detail}</p>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                const added = st().addIdea(idea.id, sizeM);
                if (added) st().notify(`Added ${idea.title.toLowerCase()}: ${added} waypoints. Check the area before you fly it.`);
                else st().notify('The map is not ready yet. Try again in a moment.', 'error');
                onClose();
              }}
            >
              Add {idea.title.toLowerCase()}
            </button>
          </div>
        </div>
      ))}
      <p className="hint small">
        These are shapes, not local knowledge. Waypath does not know about trees, buildings, power lines, people or airspace rules at this spot, so adjust the route to what is really there.
      </p>
    </Dialog>
  );
}
