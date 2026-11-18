// Draws simple bar and line charts as SVG files, for the make_chart tool.
// A pure function: numbers in, SVG text out. Every piece of text that came from
// a bot is XML-escaped, so a chart can't carry markup or scripts.

export interface ChartSpec {
  title: string;
  type: "bar" | "line";
  /** One label per point on the x-axis, e.g. months or segment names. */
  labels: string[];
  /** One or more series; each has one value per label. */
  series: { name: string; values: number[] }[];
  /** Optional unit shown next to the title, e.g. "₹" or "%". */
  unit?: string;
}

const WIDTH = 720;
const HEIGHT = 420;
const MARGIN = { top: 56, right: 24, bottom: 80, left: 72 };
/** Colours for up to 6 series, readable on light and dark backgrounds. */
const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#ef4444"];

/** Limits that keep a chart readable. */
export const CHART_LIMITS = { labels: 40, series: COLORS.length };

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Short number labels for the y-axis: 1250000 → "1.25M". */
function shortNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return `${+n.toFixed(2)}`;
}

/**
 * Check a chart request before drawing it.
 * @throws Error with a message the bot can act on
 */
export function validateChart(spec: ChartSpec): void {
  if (spec.labels.length === 0) throw new Error("A chart needs at least one label.");
  if (spec.labels.length > CHART_LIMITS.labels) throw new Error(`Keep charts to ${CHART_LIMITS.labels} labels or fewer; group the rest.`);
  if (spec.series.length === 0 || spec.series.length > CHART_LIMITS.series) throw new Error(`A chart needs 1 to ${CHART_LIMITS.series} series.`);
  for (const s of spec.series) {
    if (s.values.length !== spec.labels.length) {
      throw new Error(`Series "${s.name}" has ${s.values.length} values but there are ${spec.labels.length} labels; they must match.`);
    }
    if (!s.values.every(Number.isFinite)) throw new Error(`Series "${s.name}" contains a value that isn't a number.`);
  }
}

/**
 * Draw a chart.
 * @param spec - what to draw (call validateChart first, or let this throw)
 * @returns the SVG document as text
 */
export function renderChartSvg(spec: ChartSpec): string {
  validateChart(spec);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const all = spec.series.flatMap((s) => s.values);
  const maxValue = Math.max(0, ...all);
  const minValue = Math.min(0, ...all);
  const range = maxValue - minValue || 1;
  const y = (value: number) => MARGIN.top + plotHeight - ((value - minValue) / range) * plotHeight;
  const slot = plotWidth / spec.labels.length;
  const parts: string[] = [];

  // Title and gridlines with y-axis numbers.
  const title = spec.unit ? `${spec.title} (${spec.unit})` : spec.title;
  parts.push(`<text x="${MARGIN.left}" y="30" font-size="18" font-weight="600" fill="#111827">${escapeXml(title)}</text>`);
  for (let i = 0; i <= 4; i++) {
    const value = minValue + (range * i) / 4;
    const lineY = y(value);
    parts.push(`<line x1="${MARGIN.left}" x2="${WIDTH - MARGIN.right}" y1="${lineY}" y2="${lineY}" stroke="#e5e7eb"/>`);
    parts.push(`<text x="${MARGIN.left - 8}" y="${lineY + 4}" font-size="11" text-anchor="end" fill="#6b7280">${escapeXml(shortNumber(value))}</text>`);
  }

  // The data.
  if (spec.type === "bar") {
    const barWidth = (slot * 0.8) / spec.series.length;
    spec.series.forEach((s, seriesIndex) => {
      s.values.forEach((value, i) => {
        const x = MARGIN.left + i * slot + slot * 0.1 + seriesIndex * barWidth;
        const top = Math.min(y(value), y(0));
        const height = Math.abs(y(value) - y(0));
        parts.push(`<rect x="${x}" y="${top}" width="${barWidth}" height="${height}" fill="${COLORS[seriesIndex]}"><title>${escapeXml(`${s.name}: ${value}`)}</title></rect>`);
      });
    });
  } else {
    spec.series.forEach((s, seriesIndex) => {
      const points = s.values.map((value, i) => `${MARGIN.left + i * slot + slot / 2},${y(value)}`).join(" ");
      parts.push(`<polyline points="${points}" fill="none" stroke="${COLORS[seriesIndex]}" stroke-width="2.5"/>`);
      s.values.forEach((value, i) => {
        parts.push(`<circle cx="${MARGIN.left + i * slot + slot / 2}" cy="${y(value)}" r="3.5" fill="${COLORS[seriesIndex]}"><title>${escapeXml(`${s.name}: ${value}`)}</title></circle>`);
      });
    });
  }

  // X-axis labels, tilted so long names fit.
  spec.labels.forEach((label, i) => {
    const x = MARGIN.left + i * slot + slot / 2;
    const text = label.length > 18 ? `${label.slice(0, 17)}…` : label;
    parts.push(`<text x="${x}" y="${HEIGHT - MARGIN.bottom + 16}" font-size="11" text-anchor="end" fill="#374151" transform="rotate(-30 ${x} ${HEIGHT - MARGIN.bottom + 16})">${escapeXml(text)}</text>`);
  });

  // Legend, when there is more than one series.
  if (spec.series.length > 1) {
    spec.series.forEach((s, i) => {
      const x = MARGIN.left + i * 150;
      parts.push(`<rect x="${x}" y="40" width="10" height="10" fill="${COLORS[i]}"/>`);
      parts.push(`<text x="${x + 14}" y="49" font-size="11" fill="#374151">${escapeXml(s.name.slice(0, 20))}</text>`);
    });
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="system-ui, sans-serif">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
    ...parts,
    "</svg>",
  ].join("\n");
}
