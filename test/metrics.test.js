import test from "node:test";
import assert from "node:assert/strict";
import {
  MetricsRegistry,
  createApplicationMetrics,
  routeTemplate
} from "../src/metrics.js";

test("metrics registry renders counters, gauges, and histograms deterministically", () => {
  const metrics = new MetricsRegistry();

  metrics.counter("test_requests_total", "Total test requests.", ["method"]);
  metrics.gauge("test_inflight", "Current in-flight requests.", ["worker"]);
  metrics.histogram(
    "test_latency_seconds",
    "Test latency.",
    ["route"],
    [0.1, 0.5, 1]
  );

  metrics.increment("test_requests_total", { method: "GET" });
  metrics.increment("test_requests_total", { method: "GET" }, 2);
  metrics.setGauge("test_inflight", { worker: "api" }, 3);
  metrics.observe("test_latency_seconds", { route: "/health" }, 0.2);

  const output = metrics.renderPrometheus();

  assert.match(output, /# TYPE test_requests_total counter/);
  assert.match(output, /test_requests_total\{method="GET"\} 3/);
  assert.match(output, /test_inflight\{worker="api"\} 3/);
  assert.match(
    output,
    /test_latency_seconds_bucket\{route="\/health",le="0\.5"\} 1/
  );
  assert.match(
    output,
    /test_latency_seconds_bucket\{route="\/health",le="\+Inf"\} 1/
  );
  assert.match(output, /test_latency_seconds_sum\{route="\/health"\} 0.2/);
});

test("metrics rejects unsafe definitions and label values", () => {
  const metrics = new MetricsRegistry();

  assert.throws(
    () => metrics.counter("not valid", "invalid"),
    /invalid metric name/
  );

  metrics.counter("safe_total", "Safe metric.", ["route"]);

  assert.throws(
    () => metrics.increment("safe_total", { route: "bad\nroute" }),
    /invalid metric label value/
  );
});

test("application metrics remain low-cardinality", () => {
  const metrics = createApplicationMetrics();

  metrics.increment("tx_service_http_requests_total", {
    method: "GET",
    route: "/v1/transactions/:id",
    status: "200"
  });

  metrics.observe(
    "tx_service_http_request_duration_seconds",
    {
      method: "GET",
      route: "/v1/transactions/:id"
    },
    0.01
  );

  const output = metrics.renderPrometheus();

  assert.doesNotMatch(output, /550e8400/);
  assert.match(output, /route="\/v1\/transactions\/:id"/);
});

test("route template never exposes transaction identifiers", () => {
  assert.equal(
    routeTemplate(
      "/v1/transactions/550e8400-e29b-41d4-a716-446655440000/submit"
    ),
    "/v1/transactions/:id/submit"
  );
  assert.equal(
    routeTemplate(
      "/v1/transactions/550e8400-e29b-41d4-a716-446655440000/events"
    ),
    "/v1/transactions/:id/events"
  );
  assert.equal(routeTemplate("/unknown"), "unmatched");
});
