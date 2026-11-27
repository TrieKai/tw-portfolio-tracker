export function nextRecordTime(previous: string, recordedAt = Date.now()): string {
  const timestamp = Date.parse(previous);
  return new Date(Math.max(recordedAt, Number.isFinite(timestamp) ? timestamp + 1 : 0)).toISOString();
}
