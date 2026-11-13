import { defaultDefaults, type Mission } from './types';

/** A small orbit-and-reveal around a landmark on open public land, so there is something to explore on first launch. */
export function sampleMission(): Mission {
  const now = new Date().toISOString();
  const poiId = 'sample-poi-1';
  return {
    id: 'sample-mission',
    name: 'Sample: salt flats reveal',
    createdAt: now,
    updatedAt: now,
    defaults: { ...defaultDefaults(), speedMps: 6, altitudeM: 40, heading: { mode: 'poi', poiId } },
    pois: [{ id: poiId, name: 'Subject', lat: 40.76245, lng: -113.8958, heightM: 2, groundElevM: null }],
    waypoints: [
      { id: 'sample-wp-1', lat: 40.7606, lng: -113.8993, altitudeM: 15, speedMps: 4, heading: { mode: 'route' }, gimbal: { mode: 'pitch', deg: -10 }, holdSec: 0, action: 'recordStart', groundElevM: null },
      { id: 'sample-wp-2', lat: 40.7615, lng: -113.8972, altitudeM: 25, speedMps: null, heading: null, gimbal: { mode: 'poi', poiId }, holdSec: 0, action: 'none', groundElevM: null },
      { id: 'sample-wp-3', lat: 40.7634, lng: -113.8975, altitudeM: null, speedMps: null, heading: null, gimbal: { mode: 'none' }, holdSec: 0, action: 'none', groundElevM: null },
      { id: 'sample-wp-4', lat: 40.7637, lng: -113.8946, altitudeM: null, speedMps: null, heading: null, gimbal: { mode: 'none' }, holdSec: 5, action: 'photo', groundElevM: null },
      { id: 'sample-wp-5', lat: 40.7618, lng: -113.8938, altitudeM: 60, speedMps: 8, heading: { mode: 'custom', deg: 270 }, gimbal: { mode: 'pitch', deg: -45 }, holdSec: 0, action: 'recordStop', groundElevM: null },
    ],
  };
}
