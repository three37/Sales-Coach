/** KML export for viewing a plan in Google Earth. */
import { buildFlightPath, hasElevation, poiRelAlt, wpAltitude, wpSpeed } from './path';
import { lerp } from './geo';
import type { Mission } from './types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const c = (lng: number, lat: number, alt: number) => `${lng.toFixed(7)},${lat.toFixed(7)},${alt.toFixed(1)}`;

export function missionToKml(mission: Mission): string {
  const path = buildFlightPath(mission);
  const elev = hasElevation(mission);
  const agl = mission.defaults.altitudeRef === 'agl';
  // With terrain heights we can give Google Earth true heights above sea level. Without them the
  // best available is "relative to ground", which is exact for above-ground missions and an
  // approximation (flat ground assumed) for takeoff-relative ones.
  const absolute = elev && !agl;
  const mode = absolute ? 'absolute' : 'relativeToGround';
  const g0 = elev ? (mission.waypoints[0].groundElevM as number) : 0;
  const out = (relAlt: number, rawAlt: number) => (absolute ? relAlt + g0 : agl ? rawAlt : relAlt);

  const note = absolute
    ? 'Heights are above sea level, from each altitude above the takeoff point plus the terrain height at waypoint 1.'
    : agl
      ? 'Heights are above the ground at each waypoint.'
      : 'Heights are above the takeoff point and drawn relative to the ground, so they are approximate over uneven terrain.';

  const wpMarks = mission.waypoints
    .map((w, i) => {
      const alt = out(path.relAlt[i], wpAltitude(mission, w));
      const bits = [
        `Altitude ${wpAltitude(mission, w).toFixed(1)} m (${agl ? 'above ground' : 'above takeoff'})`,
        `Speed to next ${wpSpeed(mission, w).toFixed(1)} m/s`,
        w.holdSec > 0 ? `Hold ${w.holdSec} s` : '',
        w.action !== 'none' ? `Action ${w.action}` : '',
      ].filter(Boolean);
      return `    <Placemark>
      <name>WP ${i + 1}</name>
      <description>${esc(bits.join(' | '))}</description>
      <styleUrl>#wp</styleUrl>
      <Point><extrude>1</extrude><altitudeMode>${mode}</altitudeMode><coordinates>${c(w.lng, w.lat, alt)}</coordinates></Point>
    </Placemark>`;
    })
    .join('\n');

  const poiMarks = mission.pois
    .map(
      (p) => `    <Placemark>
      <name>${esc(p.name)}</name>
      <styleUrl>#poi</styleUrl>
      <Point><altitudeMode>${absolute ? 'absolute' : 'relativeToGround'}</altitudeMode><coordinates>${c(p.lng, p.lat, absolute ? poiRelAlt(mission, p) + g0 : p.heightM)}</coordinates></Point>
    </Placemark>`,
    )
    .join('\n');

  // The route line uses the same geometry as the planner, with altitude interpolated along each leg.
  const coords: string[] = [];
  const raw = mission.waypoints.map((w) => wpAltitude(mission, w));
  for (const leg of path.legs) {
    leg.points.forEach((p, k) => {
      const f = leg.lengthM > 0 ? leg.cum[k] / leg.lengthM : 0;
      coords.push(c(p.lng, p.lat, out(lerp(path.relAlt[leg.from], path.relAlt[leg.to], f), lerp(raw[leg.from], raw[leg.to], f))));
    });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(mission.name)}</name>
    <description>${esc(`Planned in Waypath. ${note} For viewing only: this file is not a flight plan for any aircraft.`)}</description>
    <Style id="route"><LineStyle><color>ffe6a000</color><width>4</width></LineStyle><PolyStyle><color>33e6a000</color></PolyStyle></Style>
    <Style id="wp"><IconStyle><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-circle.png</href></Icon></IconStyle></Style>
    <Style id="poi"><IconStyle><scale>1.0</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/orange-stars.png</href></Icon></IconStyle></Style>
    <Folder>
      <name>Route</name>
      <Placemark>
        <name>Flight path</name>
        <styleUrl>#route</styleUrl>
        <LineString><extrude>1</extrude><tessellate>0</tessellate><altitudeMode>${mode}</altitudeMode><coordinates>${coords.join(' ')}</coordinates></LineString>
      </Placemark>
    </Folder>
    <Folder>
      <name>Waypoints</name>
${wpMarks}
    </Folder>
    <Folder>
      <name>Points of interest</name>
${poiMarks}
    </Folder>
  </Document>
</kml>
`;
}
