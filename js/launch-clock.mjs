// The FLOP Testnet launch is an announced TARGET, not proof of live network status.
// Keep this timestamp in UTC to avoid DST or browser-timezone shifts.
export const LAUNCH_UTC = '2026-11-24T07:00:00Z';

export function getLaunchCountdown(nowMs = Date.now(), targetMs = Date.parse(LAUNCH_UTC)) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(targetMs)) {
    throw new RangeError('Countdown needs finite timestamps');
  }
  const totalSeconds = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  return {
    elapsed: nowMs >= targetMs,
    totalSeconds,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60
  };
}
