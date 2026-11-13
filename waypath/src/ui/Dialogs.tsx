import { useEffect, useRef, useState, type ReactNode } from 'react';
import { missionToKml } from '../domain/kml';
import { MissionFileError, parseMissionFile, safeFileName, serializeMission } from '../domain/missionFile';
import { useStore } from '../store/store';
import { Icon } from './Icon';
import { MIME, canShareFile, saveFile, shareFile } from './files';

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export async function importFromFile(file: File): Promise<void> {
  const st = useStore.getState();
  try {
    if (file.size > 5_000_000) throw new MissionFileError('That file is too large to be a mission file.');
    const { mission, warnings } = parseMissionFile(await file.text());
    await st.importMission(mission);
    st.notify(
      warnings.length ? `Opened “${mission.name}” with changes: ${warnings.join(' ')}` : `Opened “${useStore.getState().mission.name}” from file.`,
      warnings.length ? 'error' : 'info',
    );
  } catch (e) {
    st.notify(e instanceof MissionFileError ? e.message : 'That file could not be opened.', 'error');
  }
}

export function ImportButton({ onDone, className = 'btn' }: { onDone?: () => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()}>
        <Icon name="folder" size={18} /> Open mission file…
      </button>
      {/* Extension and MIME type both listed: iOS Files matches on type, desktop pickers on extension. */}
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="Mission file to open"
        tabIndex={-1}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) {
            await importFromFile(f);
            onDone?.();
          }
        }}
      />
    </>
  );
}

export function MissionsDialog({ onClose }: { onClose: () => void }) {
  const missions = useStore((s) => s.missions);
  const currentId = useStore((s) => s.mission.id);
  const st = useStore.getState;
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <Dialog title="Missions" onClose={onClose}>
      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            await st().createMission();
            onClose();
          }}
        >
          <Icon name="plus" size={18} /> New mission
        </button>
        <ImportButton onDone={onClose} />
      </div>
      <ul className="mission-list" aria-label="Saved missions">
        {missions.map((m) => (
          <li key={m.id} className={m.id === currentId ? 'current' : ''}>
            {renaming?.id === m.id ? (
              <form
                className="rename"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await st().renameMission(m.id, renaming.name);
                  setRenaming(null);
                }}
              >
                <input
                  type="text"
                  aria-label="Mission name"
                  autoFocus
                  maxLength={80}
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: m.id, name: e.target.value })}
                />
                <button type="submit" className="btn primary">
                  Save
                </button>
                <button type="button" className="btn" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="row-main"
                  aria-label={`Open ${m.name}`}
                  onClick={async () => {
                    await st().openMission(m.id);
                    onClose();
                  }}
                >
                  <span className="row-text">
                    <span className="row-title">{m.name.trim() || 'Untitled mission'}</span>
                    <span className="row-sub">
                      {m.waypoints} waypoint{m.waypoints === 1 ? '' : 's'} · {new Date(m.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      {m.id === currentId ? ' · open now' : ''}
                    </span>
                  </span>
                </button>
                <button type="button" className="icon-btn" aria-label={`Rename ${m.name}`} onClick={() => setRenaming({ id: m.id, name: m.name })}>
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Duplicate ${m.name}`}
                  onClick={async () => {
                    await st().duplicateMission(m.id);
                    onClose();
                  }}
                >
                  <Icon name="copy" />
                </button>
                {confirmDelete === m.id ? (
                  <button type="button" className="btn danger" onClick={() => void st().deleteMission(m.id).then(() => setConfirmDelete(null))}>
                    Delete?
                  </button>
                ) : (
                  <button type="button" className="icon-btn" aria-label={`Delete ${m.name}`} onClick={() => setConfirmDelete(m.id)}>
                    <Icon name="trash" />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="hint small">Missions are stored in this browser on this device. To move one to another device, export a mission file and open it there.</p>
    </Dialog>
  );
}

function ExportRow({ title, noun, detail, fileName, mime, build }: { title: string; noun: string; detail: string; fileName: string; mime: string; build: () => string }) {
  const st = useStore.getState;
  const shareable = canShareFile(fileName, mime);
  return (
    <div className="export-row">
      <div>
        <strong>{title}</strong>
        <p className="hint">{detail}</p>
        <p className="hint small file-name">{fileName}</p>
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            saveFile(fileName, build(), mime);
            st().notify(`Saved ${fileName}. Look in your Downloads folder.`);
          }}
        >
          Save {noun}
        </button>
        {shareable && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              void shareFile(fileName, build(), mime).catch(() => st().notify('Sharing did not work here. Use Save instead.', 'error'))
            }
          >
            <Icon name="share" size={18} /> Share {noun}
          </button>
        )}
      </div>
    </div>
  );
}

export function FilesDialog({ onClose }: { onClose: () => void }) {
  const mission = useStore((s) => s.mission);
  const base = safeFileName(mission.name);
  return (
    <Dialog title="Export and import" onClose={onClose}>
      <ExportRow
        title="Mission file"
        noun="mission file"
        detail="Everything in this plan, for backing up or opening in Waypath on another device."
        fileName={`${base}.waypath.json`}
        mime={MIME.json}
        build={() => serializeMission(mission)}
      />
      <ExportRow
        title="KML for Google Earth"
        noun="KML"
        detail="The route, waypoints and points of interest, for viewing in Google Earth. Not a flight plan."
        fileName={`${base}.kml`}
        mime={MIME.kml}
        build={() => missionToKml(mission)}
      />
      <div className="export-row disabled">
        <div>
          <strong>DJI Fly KMZ</strong>
          <p className="hint">
            Not available yet. No drone model has been checked against a known-good DJI Fly file, and Waypath will not write a file for an aircraft it has not been verified with.
          </p>
        </div>
      </div>
      <div className="export-row">
        <div>
          <strong>Open a mission file</strong>
          <p className="hint">Adds the mission from a .waypath.json file to this device. Nothing already here is overwritten.</p>
        </div>
        <div className="btn-row">
          <ImportButton onDone={onClose} />
        </div>
      </div>
    </Dialog>
  );
}
