// tracing.js — OpenTelemetry SDK initialisation
// Must be required FIRST in app.js before any other require.
//
// Auto-instrumentation covers:
//   - Every HTTP/Express request → span with method, route, status, duration
//   - Every mongoose/MongoDB query → span with collection, operation, duration
//
// Current exporter: ConsoleSpanExporter (traces visible in kubectl logs)
// Future: swap ConsoleSpanExporter for OTLPTraceExporter — one line change,
// zero application code changes. Traces flow to Jaeger, Tempo, or Datadog.

// // Current: console exporter
// traceExporter: new ConsoleSpanExporter()

// // Future: OTel Collector
// const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
// traceExporter: new OTLPTraceExporter({ url: 'http://otel-collector:4318/v1/traces' })
// // Application code in app.js: ZERO changes

'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

// Filter out probe endpoints — they fire constantly and add noise
class FilteringExporter {
    constructor(exporter) { this._exporter = exporter; }
    export(spans, resultCallback) {
        const filtered = spans.filter(span => {
            const route = span.attributes['http.target'] || '';
            return !['/health', '/ready', '/metrics'].includes(route);
        });
        if (filtered.length > 0) {
            this._exporter.export(filtered, resultCallback);
        } else {
            resultCallback({ code: 0 });
        }
    }
    shutdown() { return this._exporter.shutdown(); }
}

const sdk = new NodeSDK({
    serviceName: 'goals-backend',
    traceExporter: new FilteringExporter(new ConsoleSpanExporter()),
    instrumentations: [
        getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-fs': { enabled: false },
            // Exclude probe and metrics endpoints from HTTP instrumentation
            '@opentelemetry/instrumentation-http': {
                ignoreIncomingRequestHook: (req) => {
                    return ['/health', '/ready', '/metrics'].includes(req.url);
                },
            },
        }),
    ],
});

sdk.start();

process.on('SIGTERM', () => {
    sdk.shutdown()
        .then(() => console.log(JSON.stringify({
            level: 'info', msg: 'OTel SDK shut down cleanly',
            timestamp: new Date().toISOString(),
        })))
        .catch((err) => console.log(JSON.stringify({
            level: 'error', msg: 'OTel shutdown error',
            error: err.message, timestamp: new Date().toISOString(),
        })));
});