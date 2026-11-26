import { formatTime } from "../format";

export function Sparkline({ values, times }: { values: number[]; times: number[] }) {
  const w = 480;
  const h = 90;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const t0 = times[0];
  const tSpan = times[times.length - 1] - t0 || 1;
  const pts = values.map((v, i) => {
    const x = pad + ((times[i] - t0) / tSpan) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastPt = pts[pts.length - 1].split(",");

  return (
    <div className="spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Value history">
        <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx={lastPt[0]} cy={lastPt[1]} r="3" fill="var(--accent)" />
      </svg>
      <div className="spark-legend muted small">
        <span>{formatTime(times[0])}</span>
        <span>
          min {min} · max {max} · latest <strong>{values[values.length - 1]}</strong>
        </span>
        <span>{formatTime(times[times.length - 1])}</span>
      </div>
    </div>
  );
}
