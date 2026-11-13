/** Saving and opening files with plain browser controls that work in Safari and Chrome. */

export const MIME = {
  json: 'application/json',
  kml: 'application/vnd.google-earth.kml+xml',
};

export function saveFile(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function asFile(name: string, text: string, mime: string): File {
  return new File([text], name, { type: mime });
}

/** True when the system share sheet will take this file (iOS "Save to Files", AirDrop, Android share). */
export function canShareFile(name: string, mime: string): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [asFile(name, 'x', mime)] });
  } catch {
    return false;
  }
}

/** Returns false if the person cancelled the share sheet. */
export async function shareFile(name: string, text: string, mime: string): Promise<boolean> {
  try {
    await navigator.share({ files: [asFile(name, text, mime)], title: name });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}
