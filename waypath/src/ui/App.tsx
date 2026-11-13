import { useEffect, useState } from 'react';
import { fmtDistance, fmtDuration } from '../domain/units';
import { useStore, type PanelTab, type Tool } from '../store/store';
import { FilesDialog, MissionsDialog, importFromFile } from './Dialogs';
import { Icon } from './Icon';
import { MapView } from './MapView';
import { MissionTab } from './MissionTab';
import { PreviewTab } from './PreviewTab';
import { RouteTab } from './RouteTab';
import { Segmented } from './fields';
import { usePath } from './usePath';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/** Advance the preview clock while it is playing. */
function usePlayback(total: number) {
  const playing = useStore((s) => s.preview.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const { preview, setPreview } = useStore.getState();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const t = preview.t + dt * preview.rate;
      if (t >= total) {
        setPreview({ t: total, playing: false });
        return;
      }
      setPreview({ t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (isTyping(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !isTyping(e.target)) {
        e.preventDefault();
        st.redo();
        return;
      }
      if (isTyping(e.target) || mod || e.altKey) return;
      if (document.querySelector('.dialog')) return;
      const onButton = e.target instanceof HTMLElement && e.target.tagName === 'BUTTON';
      switch (e.key) {
        case 'Escape':
          if (st.tool !== 'select') st.setTool('select');
          else st.select(null);
          break;
        case 'Delete':
        case 'Backspace':
          if (st.selection) {
            e.preventDefault();
            st.removeSelected();
          }
          break;
        case 'v':
          st.setTool('select');
          break;
        case 'w':
          st.setTool('waypoint');
          break;
        case 'p':
          st.setTool('poi');
          break;
        case 'f':
          st.requestFit();
          break;
        case ' ':
          if (st.tab === 'preview' && !onButton) {
            e.preventDefault();
            st.setPreview({ playing: !st.preview.playing });
          }
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          // Nudge the selected marker by about a metre (ten with Shift).
          const sel = st.selection;
          if (!sel || (e.target instanceof HTMLElement && e.target.closest('.maplibregl-canvas'))) break;
          e.preventDefault();
          const stepM = e.shiftKey ? 10 : 1;
          const item = sel.kind === 'wp' ? st.mission.waypoints.find((w) => w.id === sel.id) : st.mission.pois.find((p) => p.id === sel.id);
          if (!item) break;
          const dLat = (stepM / 111_320) * (e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0);
          const dLng = (stepM / (111_320 * Math.cos((item.lat * Math.PI) / 180))) * (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
          const patch = { lat: item.lat + dLat, lng: item.lng + dLng };
          if (sel.kind === 'wp') st.updateWaypoint(sel.id, patch, 'nudge');
          else st.updatePoi(sel.id, patch, 'nudge');
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'route', label: 'Route' },
  { id: 'preview', label: 'Preview' },
  { id: 'mission', label: 'Mission' },
];

export function App() {
  const ready = useStore((s) => s.ready);
  const name = useStore((s) => s.mission.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const tool = useStore((s) => s.tool);
  const tab = useStore((s) => s.tab);
  const panelOpen = useStore((s) => s.panelOpen);
  const units = useStore((s) => s.settings.units);
  const toast = useStore((s) => s.toast);
  const storageError = useStore((s) => s.storageError);
  const st = useStore.getState;
  const path = usePath();
  const [dialog, setDialog] = useState<'missions' | 'files' | null>(null);

  useEffect(() => void st().init(), []); // eslint-disable-line react-hooks/exhaustive-deps
  usePlayback(path.totalDurationS);
  useShortcuts();

  // Keep the preview clock inside the flight when the route gets shorter.
  useEffect(() => {
    if (st().preview.t > path.totalDurationS) st().setPreview({ t: path.totalDurationS });
  }, [path.totalDurationS]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    const timer = setTimeout(() => useStore.getState().toast?.id === id && st().dismissToast(), toast.kind === 'error' ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = path.mission.waypoints.length;

  return (
    <div
      className={`app ${panelOpen ? 'panel-open' : 'panel-closed'}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) void importFromFile(f);
      }}
    >
      <main className="stage">
        <MapView />

        <div className="topbar">
          <button type="button" className="mission-btn" onClick={() => setDialog('missions')} aria-label={`Missions. Current mission: ${name}`}>
            <Icon name="folder" size={20} />
            <span className="mission-name">{name.trim() || 'Untitled mission'}</span>
          </button>
          <button type="button" className="icon-btn solid" onClick={() => st().undo()} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl/⌘ Z)">
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn solid" onClick={() => st().redo()} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)">
            <Icon name="redo" />
          </button>
          <button type="button" className="icon-btn solid" onClick={() => setDialog('files')} aria-label="Export and import" title="Export and import">
            <Icon name="share" />
          </button>
        </div>

        <div className="map-tools">
          <button type="button" className="icon-btn solid" onClick={() => st().requestFit()} aria-label="Show whole route" title="Show whole route (F)">
            <Icon name="fit" />
          </button>
        </div>

        <div className="toolbar">
          <Segmented<Tool>
            label="Map tool"
            value={tool}
            onChange={(v) => st().setTool(v)}
            options={[
              { value: 'select', label: (<><Icon name="pointer" size={18} /> Select</>), title: 'Select and move (V)' },
              { value: 'waypoint', label: (<><Icon name="plus" size={18} /> Waypoint</>), title: 'Tap the map to add waypoints (W)' },
              { value: 'poi', label: (<><Icon name="target" size={18} /> POI</>), title: 'Tap the map to add a point of interest (P)' },
            ]}
          />
          {tool !== 'select' && (
            <p className="tool-hint" role="status">
              {tool === 'waypoint' ? 'Tap the map to add waypoints' : 'Tap the map to place a point of interest'}
            </p>
          )}
        </div>

        {(toast || storageError) && (
          <div className={`toast ${toast?.kind === 'error' || (!toast && storageError) ? 'error' : ''}`} role="status">
            <span>{toast?.text ?? storageError}</span>
            {toast && (
              <button type="button" className="icon-btn" onClick={() => st().dismissToast()} aria-label="Dismiss message">
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
        )}
      </main>

      <aside className="panel" aria-label="Mission panel">
        <button
          type="button"
          className="panel-head"
          onClick={() => st().setPanelOpen(!panelOpen)}
          aria-expanded={panelOpen}
          aria-label={panelOpen ? 'Collapse panel' : 'Expand panel'}
        >
          <span className="grip" aria-hidden="true" />
          <span className="stats" data-testid="stats">
            <span>
              <b data-testid="stat-waypoints">{n}</b> waypoint{n === 1 ? '' : 's'}
            </span>
            <span>
              <b data-testid="stat-distance">{fmtDistance(path.totalDistanceM, units)}</b>
            </span>
            <span>
              <b data-testid="stat-duration" title="Estimated flight time">{fmtDuration(path.totalDurationS)}</b>
            </span>
          </span>
          <span className="chev" aria-hidden="true">
            <Icon name={panelOpen ? 'chevronDown' : 'chevronUp'} />
          </span>
        </button>
        <div className="panel-main">
          <div className="tabs" role="tablist" aria-label="Panel sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => st().setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="panel-scroll" role="tabpanel">
            {!ready ? (
              <p className="empty">Loading…</p>
            ) : tab === 'route' ? (
              <RouteTab path={path} />
            ) : tab === 'preview' ? (
              <PreviewTab path={path} />
            ) : (
              <MissionTab path={path} />
            )}
          </div>
        </div>
      </aside>

      {dialog === 'missions' && <MissionsDialog onClose={() => setDialog(null)} />}
      {dialog === 'files' && <FilesDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
