import { useMemo } from 'react';
import { buildFlightPath, type FlightPath } from '../domain/path';
import { useStore } from '../store/store';

/** The one flight path every part of the UI reads. */
export function usePath(): FlightPath {
  const mission = useStore((s) => s.mission);
  return useMemo(() => buildFlightPath(mission), [mission]);
}
