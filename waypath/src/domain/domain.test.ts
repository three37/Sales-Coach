import { describe, expect, it } from 'vitest';
import { bearing, haversine, lerpAngle } from './geo';
import { buildFlightPath, sampleFlight } from './path';
import { parseMissionFile, serializeMission, MissionFileError, FILE_FORMAT } from './missionFile';
import { missionToKml } from './kml';
import { decodeTerrarium, tilePixel } from './elevation';
import { sampleMission } from './sample';
import { buildIdea, IDEAS } from './ideas';
import { newMission, newWaypoint, type Mission } from './types';

function square(): Mission {
  const m = newMission('t');
  // Roughly 111.2 m per 0.001 degree of latitude.
  m.waypoints = [
    newWaypoint({ lat: 0, lng: 0 }),
    newWaypoint({ lat: 0.001, lng: 0 }),
    newWaypoint({ lat: 0.001, lng: 0.001 }),
  ];
  m.defaults.speedMps = 5;
  return m;
}

describe('geo', () => {
  it('measures known distances', () => {
    expect(haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111195, -1);
    // London to Paris is about 343.5 km.
    expect(haversine({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 }) / 1000).toBeCloseTo(343.5, 0);
  });
  it('gives compass bearings', () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0);
    expect(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90);
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0);
  });
});

describe('flight path', () => {
  it('sums leg distance and time from segment speeds', () => {
    const p = buildFlightPath(square());
    expect(p.legs).toHaveLength(2);
    expect(p.totalDistanceM).toBeCloseTo(222.39, 1);
    expect(p.totalDurationS).toBeCloseTo(222.39 / 5, 1);
  });
  it('uses per-waypoint speed for the leg leaving it, and adds holds', () => {
    const m = square();
    m.waypoints[0].speedMps = 10;
    m.waypoints[1].holdSec = 7;
    const p = buildFlightPath(m);
    expect(p.totalDurationS).toBeCloseTo(111.195 / 10 + 7 + 111.195 / 5, 1);
    expect(p.arrive[1]).toBeCloseTo(11.12, 1);
    expect(p.depart[1]).toBeCloseTo(18.12, 1);
  });
  it('preview position agrees with the route geometry at every step', () => {
    for (const turnMode of ['straight', 'curved'] as const) {
      const m = square();
      m.defaults.turnMode = turnMode;
      m.defaults.turnDistanceM = 30;
      const p = buildFlightPath(m);
      // Walking the preview in small steps must cover exactly the reported distance...
      let walked = 0;
      let prev = sampleFlight(p, 0)!;
      const steps = 4000;
      for (let i = 1; i <= steps; i++) {
        const s = sampleFlight(p, (p.totalDurationS * i) / steps)!;
        walked += haversine(prev, s);
        prev = s;
      }
      expect(walked).toBeCloseTo(p.totalDistanceM, 0);
      // ...and the reported distance flown must reach the total at the end.
      expect(sampleFlight(p, p.totalDurationS)!.distanceM).toBeCloseTo(p.totalDistanceM, 3);
    }
  });
  it('curved turns shorten the route and skip the corner', () => {
    const straight = buildFlightPath(square());
    const m = square();
    m.defaults.turnMode = 'curved';
    m.defaults.turnDistanceM = 30;
    const curved = buildFlightPath(m);
    expect(curved.curved).toEqual([false, true, false]);
    expect(curved.totalDistanceM).toBeLessThan(straight.totalDistanceM);
    expect(curved.totalDistanceM).toBeGreaterThan(straight.totalDistanceM - 30);
    expect(haversine(curved.anchors[1], m.waypoints[1])).toBeGreaterThan(5);
    // A hold forces a stop at the waypoint itself.
    m.waypoints[1].holdSec = 3;
    expect(buildFlightPath(m).curved[1]).toBe(false);
  });
  it('interpolates altitude and reports the current waypoint', () => {
    const m = square();
    m.waypoints[0].altitudeM = 20;
    m.waypoints[1].altitudeM = 60;
    const p = buildFlightPath(m);
    const mid = sampleFlight(p, p.legs[0].durationS / 2)!;
    expect(mid.altRelM).toBeCloseTo(40);
    expect(mid.wpIndex).toBe(0);
    expect(mid.nextWpIndex).toBe(1);
    expect(mid.headingDeg).toBeCloseTo(0, 0);
    expect(sampleFlight(p, p.totalDurationS)!.phase).toBe('done');
  });
  it('faces a point of interest and tilts the gimbal at it', () => {
    const m = square();
    m.pois = [{ id: 'p', name: 'P', lat: 0.0005, lng: 0.001, heightM: 0, groundElevM: null }];
    m.defaults.heading = { mode: 'poi', poiId: 'p' };
    m.waypoints[0].gimbal = { mode: 'poi', poiId: 'p' };
    const p = buildFlightPath(m);
    const s = sampleFlight(p, p.legs[0].durationS / 2)!;
    expect(s.headingDeg).toBeCloseTo(90, 0);
    // 40 m up, about 111 m away.
    expect(s.gimbalPitchDeg).toBeCloseTo(-(Math.atan2(40, 111.2) * 180) / Math.PI, 0);
  });
  it('tracks recording and photo actions', () => {
    const m = square();
    m.waypoints[0].action = 'recordStart';
    m.waypoints[1].action = 'photo';
    m.waypoints[2].action = 'recordStop';
    const p = buildFlightPath(m);
    expect(sampleFlight(p, 1)!.recording).toBe(true);
    expect(sampleFlight(p, p.arrive[1] + 0.01)!.photos).toBe(1);
    expect(sampleFlight(p, p.totalDurationS)!.recording).toBe(false);
  });
  it('resolves above-ground altitudes only when terrain is known', () => {
    const m = square();
    m.defaults.altitudeRef = 'agl';
    expect(buildFlightPath(m).aglResolved).toBe(false);
    m.waypoints[0].groundElevM = 100;
    m.waypoints[1].groundElevM = 130;
    m.waypoints[2].groundElevM = 90;
    const p = buildFlightPath(m);
    expect(p.aglResolved).toBe(true);
    expect(p.relAlt).toEqual([40, 70, 30]);
    expect(sampleFlight(p, 0)!.altAglM).toBeCloseTo(40);
  });
});

describe('return to start', () => {
  it('adds a closing leg to the totals and the preview', () => {
    const m = square();
    const open = buildFlightPath(m);
    m.defaults.finish = 'returnToStart';
    m.waypoints[0].altitudeM = 20;
    m.waypoints[2].speedMps = 10;
    const p = buildFlightPath(m);
    const back = haversine(m.waypoints[2], m.waypoints[0]);
    expect(p.returns).toBe(true);
    expect(p.totalDistanceM).toBeCloseTo(open.totalDistanceM + back, 3);
    expect(p.totalDurationS).toBeCloseTo(open.totalDurationS + back / 10, 3);
    // Half way home: between the last and first waypoint, heading back, altitude half way between them.
    const mid = sampleFlight(p, p.totalDurationS - back / 10 / 2)!;
    expect(mid.wpIndex).toBe(2);
    expect(mid.nextWpIndex).toBe(0);
    expect(mid.altRelM).toBeCloseTo(30);
    const end = sampleFlight(p, p.totalDurationS)!;
    expect(end.phase).toBe('done');
    expect(haversine(end, m.waypoints[0])).toBeLessThan(0.01);
    expect(end.distanceM).toBeCloseTo(p.totalDistanceM, 3);
    expect(end.altRelM).toBe(20);
  });
  it('survives the mission file, and old files default to ending at the last waypoint', () => {
    const m = square();
    m.defaults.finish = 'returnToStart';
    expect(parseMissionFile(serializeMission(m)).mission.defaults.finish).toBe('returnToStart');
    const old = JSON.parse(serializeMission(m));
    delete old.mission.defaults.finish;
    expect(parseMissionFile(JSON.stringify(old)).mission.defaults.finish).toBe('stop');
  });
});

describe('route ideas', () => {
  const c = { lat: 40.76, lng: -113.9 };
  it('orbit keeps every waypoint on the circle, facing the subject, and closes', () => {
    const wps = buildIdea('orbit', c, 80, 'p', 40);
    expect(wps).toHaveLength(9);
    for (const w of wps) {
      expect(haversine(c, w)).toBeCloseTo(80, 0);
      expect(w.heading).toEqual({ mode: 'poi', poiId: 'p' });
    }
    expect(haversine(wps[0], wps[8])).toBeLessThan(0.01);
    expect(bearing(c, wps[0])).toBeCloseTo(180, 0);
  });
  it('every idea produces a flyable route of the requested size', () => {
    for (const idea of IDEAS) {
      const m = newMission('t');
      m.pois = [{ id: 'p', name: 'P', ...c, heightM: 0, groundElevM: null }];
      m.waypoints = buildIdea(idea.id, c, 100, 'p', 40);
      const p = buildFlightPath(m);
      expect(m.waypoints.length).toBeGreaterThanOrEqual(3);
      expect(p.totalDistanceM).toBeGreaterThan(150);
      expect(Math.max(...m.waypoints.map((w) => haversine(c, w)))).toBeLessThan(210);
      expect(parseMissionFile(serializeMission(m)).mission).toEqual(m);
    }
  });
});

describe('mission file', () => {
  it('round-trips every setting', () => {
    const m = sampleMission();
    m.defaults.turnMode = 'curved';
    m.defaults.turnDistanceM = 17;
    m.defaults.altitudeRef = 'agl';
    m.waypoints.forEach((w, i) => (w.groundElevM = 1280 + i));
    m.pois[0].groundElevM = 1281.5;
    const { mission, warnings } = parseMissionFile(serializeMission(m));
    expect(mission).toEqual(m);
    expect(warnings).toEqual([]);
  });
  it('rejects other files and newer versions with a clear message', () => {
    expect(() => parseMissionFile('nope')).toThrow(MissionFileError);
    expect(() => parseMissionFile('{"format":"x"}')).toThrow(/not a Waypath/);
    expect(() => parseMissionFile(JSON.stringify({ format: FILE_FORMAT, version: 99, mission: {} }))).toThrow(/newer version/);
  });
  it('repairs references to missing points of interest and says so', () => {
    const m = sampleMission();
    m.pois = [];
    const { mission, warnings } = parseMissionFile(serializeMission(m));
    expect(mission.defaults.heading).toEqual({ mode: 'route' });
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('kml', () => {
  it('writes waypoints, POIs and a route line', () => {
    const kml = missionToKml(sampleMission());
    expect(kml).toContain('<name>WP 5</name>');
    expect(kml).toContain('<name>Subject</name>');
    expect(kml).toContain('<LineString>');
    expect(kml).toContain('relativeToGround');
    expect(kml.match(/<Placemark>/g)).toHaveLength(7);
  });
  it('uses absolute heights when terrain is known', () => {
    const m = sampleMission();
    m.waypoints.forEach((w) => (w.groundElevM = 1280));
    const kml = missionToKml(m);
    expect(kml).toContain('<altitudeMode>absolute</altitudeMode>');
    expect(kml).toContain(',1295.0'); // WP1: 15 m above takeoff + 1280 m terrain
  });
});

describe('elevation decoding', () => {
  it('decodes terrarium pixels', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(134, 16, 128)).toBeCloseTo(1552.5);
  });
  it('maps coordinates to tile pixels', () => {
    expect(tilePixel({ lat: 0, lng: 0 }, 1)).toEqual({ x: 1, y: 1, px: 0, py: 0 });
  });
});
