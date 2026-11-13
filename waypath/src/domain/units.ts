export type Units = 'metric' | 'imperial';

const FT = 0.3048;
const MPH = 0.44704;

export const unitLabel = {
  alt: (u: Units) => (u === 'metric' ? 'm' : 'ft'),
  speed: (u: Units) => (u === 'metric' ? 'm/s' : 'mph'),
};

export const altToDisplay = (m: number, u: Units) => (u === 'metric' ? m : m / FT);
export const altFromDisplay = (v: number, u: Units) => (u === 'metric' ? v : v * FT);
export const speedToDisplay = (mps: number, u: Units) => (u === 'metric' ? mps : mps / MPH);
export const speedFromDisplay = (v: number, u: Units) => (u === 'metric' ? v : v * MPH);

export function round(v: number, dp: number): number {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
}

export function fmtAlt(m: number, u: Units): string {
  return `${Math.round(altToDisplay(m, u))} ${unitLabel.alt(u)}`;
}

export function fmtSpeed(mps: number, u: Units): string {
  return `${round(speedToDisplay(mps, u), 1)} ${unitLabel.speed(u)}`;
}

export function fmtDistance(m: number, u: Units): string {
  if (u === 'metric') return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
  const ft = m / FT;
  return ft < 1000 ? `${Math.round(ft)} ft` : `${(m / 1609.344).toFixed(2)} mi`;
}

export function fmtDuration(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
