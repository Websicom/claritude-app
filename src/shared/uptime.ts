export type UptimeCheckEvidence = {
  success: boolean;
  response_ms?: number | null;
  suppressed_by_maintenance?: boolean;
};

export type IncidentInterval = {
  opened_at: string;
  resolved_at?: string | null;
};

export function medianMilliseconds(values: number[]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? Math.round(sorted[middle])
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function summarizeUptimeChecks(rows: UptimeCheckEvidence[]) {
  const eligible = rows.filter((row) => !row.suppressed_by_maintenance);
  const successful = eligible.filter((row) => row.success);
  const responseValues = successful
    .map((row) => row.response_ms)
    .filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
  return {
    total: eligible.length,
    successful: successful.length,
    suppressed: rows.length - eligible.length,
    availability: eligible.length ? (successful.length / eligible.length) * 100 : null,
    averageResponseMs: responseValues.length
      ? Math.round(responseValues.reduce((total, value) => total + value, 0) / responseValues.length)
      : null,
    medianResponseMs: medianMilliseconds(responseValues),
    highestResponseMs: responseValues.length ? Math.max(...responseValues) : null,
  };
}

export function estimateIncidentDowntime(
  incidents: IncidentInterval[],
  from: string,
  to: string,
  now = new Date().toISOString(),
) {
  const start = Date.parse(from);
  const end = Math.min(Date.parse(to), Date.parse(now));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return { milliseconds: 0, intervals: 0, resolved: 0, ongoing: 0 };
  const clipped = incidents
    .map((incident) => ({
      start: Math.max(start, Date.parse(incident.opened_at)),
      end: Math.min(end, Date.parse(incident.resolved_at || now)),
      resolved: Boolean(incident.resolved_at),
    }))
    .filter((interval) =>
      Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start,
    )
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of clipped) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end)
      previous.end = Math.max(previous.end, interval.end);
    else merged.push({ start: interval.start, end: interval.end });
  }
  return {
    milliseconds: merged.reduce((total, interval) => total + interval.end - interval.start, 0),
    intervals: merged.length,
    resolved: clipped.filter((interval) => interval.resolved).length,
    ongoing: clipped.filter((interval) => !interval.resolved).length,
  };
}
