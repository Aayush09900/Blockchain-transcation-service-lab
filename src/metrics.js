const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

const DEFAULT_HISTOGRAM_BUCKETS = Object.freeze([
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10
]);

export class MetricsRegistry {
  constructor() {
    this.definitions = new Map();
  }

  counter(name, help, labelNames = []) {
    return this.define(name, "counter", help, labelNames);
  }

  gauge(name, help, labelNames = []) {
    return this.define(name, "gauge", help, labelNames);
  }

  histogram(
    name,
    help,
    labelNames = [],
    buckets = DEFAULT_HISTOGRAM_BUCKETS
  ) {
    const metric = this.define(name, "histogram", help, labelNames);
    metric.buckets = [...buckets].sort((a, b) => a - b);
    return metric;
  }

  define(name, type, help, labelNames) {
    if (!METRIC_NAME.test(name)) {
      throw new Error(`invalid metric name: ${name}`);
    }

    if (!["counter", "gauge", "histogram"].includes(type)) {
      throw new Error(`invalid metric type: ${type}`);
    }

    if (!Array.isArray(labelNames) || labelNames.some((label) => !LABEL_NAME.test(label))) {
      throw new Error(`invalid metric labels: ${name}`);
    }

    const normalizedLabels = [...new Set(labelNames)];

    const existing = this.definitions.get(name);

    if (existing) {
      if (
        existing.type !== type ||
        existing.help !== help ||
        existing.labelNames.join("|") !== normalizedLabels.join("|")
      ) {
        throw new Error(`metric definition conflict: ${name}`);
      }

      return existing;
    }

    const metric = {
      name,
      type,
      help,
      labelNames: normalizedLabels,
      buckets: DEFAULT_HISTOGRAM_BUCKETS,
      series: new Map()
    };

    this.definitions.set(name, metric);

    return metric;
  }

  increment(name, labels = {}, value = 1) {
    const metric = this.get(name, "counter");
    assertFinitePositive(value, "counter value");
    const series = getSeries(metric, labels);
    series.value += value;
  }

  setGauge(name, labels = {}, value) {
    const metric = this.get(name, "gauge");
    assertFiniteNumber(value, "gauge value");
    const series = getSeries(metric, labels);
    series.value = value;
  }

  addGauge(name, labels = {}, value) {
    const metric = this.get(name, "gauge");
    assertFiniteNumber(value, "gauge value");
    const series = getSeries(metric, labels);
    series.value += value;
  }

  observe(name, labels = {}, value) {
    const metric = this.get(name, "histogram");
    assertFiniteNumber(value, "histogram observation");

    const series = getHistogramSeries(metric, labels);
    series.count += 1;
    series.sum += value;

    for (const bucket of metric.buckets) {
      if (value <= bucket) {
        series.bucketCounts[bucket] += 1;
      }
    }
  }

  get(name, expectedType) {
    const metric = this.definitions.get(name);

    if (!metric || metric.type !== expectedType) {
      throw new Error(
        `metric ${name} is not defined as ${expectedType}`
      );
    }

    return metric;
  }

  renderPrometheus() {
    const lines = [];

    for (const metric of [...this.definitions.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      lines.push(`# HELP ${metric.name} ${escapeHelp(metric.help)}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      for (const series of [...metric.series.values()].sort((a, b) =>
        a.key.localeCompare(b.key)
      )) {
        const labels = renderLabels(series.labels);

        if (metric.type === "histogram") {
          for (const bucket of metric.buckets) {
            lines.push(
              `${metric.name}_bucket${renderLabels({
                ...series.labels,
                le: String(bucket)
              })} ${series.bucketCounts[bucket]}`
            );
          }

          lines.push(
            `${metric.name}_bucket${renderLabels({
              ...series.labels,
              le: "+Inf"
            })} ${series.count}`
          );
          lines.push(`${metric.name}_sum${labels} ${series.sum}`);
          lines.push(`${metric.name}_count${labels} ${series.count}`);
          continue;
        }

        lines.push(`${metric.name}${labels} ${series.value}`);
      }
    }

    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  }
}

export function routeTemplate(pathname) {
  const path = String(pathname ?? "").split("?")[0];

  if (path === "/health") return "/health";
  if (path === "/ready") return "/ready";
  if (path === "/metrics") return "/metrics";
  if (path === "/v1/transactions") return "/v1/transactions";

  if (/^\/v1\/transactions\/[^/]+\/submit$/.test(path)) {
    return "/v1/transactions/:id/submit";
  }

  if (/^\/v1\/transactions\/[^/]+\/confirm$/.test(path)) {
    return "/v1/transactions/:id/confirm";
  }

  if (/^\/v1\/transactions\/[^/]+\/fail$/.test(path)) {
    return "/v1/transactions/:id/fail";
  }

  if (/^\/v1\/transactions\/[^/]+\/anchor$/.test(path)) {
    return "/v1/transactions/:id/anchor";
  }

  if (/^\/v1\/transactions\/[^/]+\/events$/.test(path)) {
    return "/v1/transactions/:id/events";
  }

  if (/^\/v1\/transactions\/[^/]+$/.test(path)) {
    return "/v1/transactions/:id";
  }

  return "unmatched";
}

export function createApplicationMetrics() {
  const registry = new MetricsRegistry();

  registry.counter(
    "tx_service_http_requests_total",
    "Total HTTP requests handled by the transaction service.",
    ["method", "route", "status"]
  );
  registry.histogram(
    "tx_service_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ["method", "route"]
  );
  registry.counter(
    "tx_service_blockchain_broadcast_total",
    "Blockchain broadcast outcomes.",
    ["outcome"]
  );
  registry.counter(
    "tx_service_blockchain_verification_total",
    "Blockchain verification outcomes.",
    ["outcome"]
  );

  return registry;
}

function getSeries(metric, labels) {
  const normalized = normalizeLabels(metric, labels);
  const key = metric.labelNames.map((name) => normalized[name] ?? "").join("\u0000");
  let series = metric.series.get(key);

  if (!series) {
    series = {
      key,
      labels: normalized,
      value: 0
    };
    metric.series.set(key, series);
  }

  return series;
}

function getHistogramSeries(metric, labels) {
  const series = getSeries(metric, labels);

  if (!series.bucketCounts) {
    series.bucketCounts = Object.fromEntries(
      metric.buckets.map((bucket) => [bucket, 0])
    );
    series.count = 0;
    series.sum = 0;
  }

  return series;
}

function normalizeLabels(metric, labels) {
  const source = labels && typeof labels === "object" ? labels : {};
  const normalized = {};

  for (const name of metric.labelNames) {
    const value = String(source[name] ?? "");

    if (/[\r\n]/.test(value)) {
      throw new Error(`invalid metric label value for ${name}`);
    }

    normalized[name] = value;
  }

  return normalized;
}

function renderLabels(labels) {
  const entries = Object.entries(labels);

  if (entries.length === 0) return "";

  return `{${entries
    .map(([name, value]) => `${name}="${escapeLabel(value)}"`)
    .join(",")}}`;
}

function escapeLabel(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n");
}

function escapeHelp(value) {
  return String(value).replaceAll("\n", " ").trim();
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function assertFinitePositive(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
}
