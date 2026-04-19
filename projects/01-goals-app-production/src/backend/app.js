// Load OTel tracing FIRST — before any other require
// Must be first: auto-instrumentation patches Node.js internals at load time
require('./tracing');

const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const client = require('prom-client');
const Goal = require('./models/goal');

const app = express();

// ── Structured JSON logging ───────────────────────────────────────────────
// Morgan custom token produces one JSON object per request → stdout.
// Kubernetes captures stdout automatically.
// Fluent Bit or Vector ships it to Loki without any in-pod log agent.
morgan.token('json-log', (req, res) => JSON.stringify({
  level: 'info',
  msg: `${req.method} ${req.url} ${res.statusCode}`,
  timestamp: new Date().toISOString(),
  method: req.method,
  url: req.url,
  status: res.statusCode,
  user_agent: req.headers['user-agent'] || '',
}));
app.use(morgan(':json-log'));

// ── Prometheus metrics setup ──────────────────────────────────────────────
// prom-client auto-collects default Node.js metrics: CPU, memory, heap,
// event loop lag, GC. collectDefaultMetrics() is called once at startup.
const register = new client.Registry();

// Auto-collect Node.js runtime metrics: CPU, memory, heap, event loop lag, GC
client.collectDefaultMetrics({ register });

// http_requests_total — counter per method, route, status_code
// Used for: request rate, error rate (5xx / total), per-route traffic
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests by method, route, and status code',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// http_request_duration_seconds — histogram per method and route
// Used for: p50/p95/p99 latency SLOs
// Buckets: 5ms, 10ms, 50ms, 100ms, 500ms, 1s, 5s — covers fast APIs
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

// mongodb_connected — gauge: 1 when connected, 0 when disconnected
// Used for: alert on DB connection loss, readiness correlation
const mongodbConnected = new client.Gauge({
  name: 'mongodb_connected',
  help: 'MongoDB connection status: 1=connected, 0=disconnected',
  registers: [register],
});

// goals_total — current count in database
// Updated on startup (countDocuments), inc on POST, dec on DELETE
// NOT updated on GET — gauge stays accurate without querying DB on every read
const goalsTotal = new client.Gauge({
  name: 'goals_total',
  help: 'Current number of goals in the database',
  registers: [register],
});

// goals_created_total — monotonic counter, never decrements
// Use for: goal creation rate, throughput over time
const goalsCreatedTotal = new client.Counter({
  name: 'goals_created_total',
  help: 'Total number of goals ever created',
  registers: [register],
});

// goals_deleted_total — monotonic counter, never decrements
// Use for: deletion rate, churn analysis
const goalsDeletedTotal = new client.Counter({
  name: 'goals_deleted_total',
  help: 'Total number of goals ever deleted',
  registers: [register],
});

// Track every request: start timer on incoming, record on finish
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer({
    method: req.method,
    route: req.path,
  });
  res.on('finish', () => {
    end();
    httpRequestsTotal.inc({
      method: req.method,
      route: req.path,
      status_code: res.statusCode,
    });
  });
  next();
});

app.use(express.json());

// ── MongoDB connection ────────────────────────────────────────────────────
const mongoHost = process.env.MONGODB_HOST || 'mongodb';
const mongoDatabase = process.env.MONGODB_DATABASE || 'course-goals';
const mongoUser = process.env.MONGODB_USERNAME;
const mongoPassword = process.env.MONGODB_PASSWORD;

const mongoUri =
  `mongodb://${mongoUser}:${mongoPassword}` +
  `@${mongoHost}:27017/${mongoDatabase}?authSource=admin`;

let isMongoConnected = false;

// Connection event listeners update the flag and metric immediately
// isMongoConnected is checked by /ready — no polling required
mongoose.connection.on('connected', async () => {
  isMongoConnected = true;
  mongodbConnected.set(1);
  // Seed goals_total gauge from actual DB count on startup
  // Ensures metric is accurate from the very first Prometheus scrape
  try {
    const count = await Goal.countDocuments();
    goalsTotal.set(count);
    console.log(JSON.stringify({
      level: 'info', msg: 'MongoDB connected',
      host: mongoHost, database: mongoDatabase,
      initial_goals_count: count,
      timestamp: new Date().toISOString(),
    }));
  } catch (err) {
    console.log(JSON.stringify({
      level: 'warn', msg: 'Could not seed goals_total on startup',
      error: err.message, timestamp: new Date().toISOString(),
    }));
  }
});

mongoose.connection.on('disconnected', () => {
  isMongoConnected = false;
  mongodbConnected.set(0);
  console.log(JSON.stringify({
    level: 'warn', msg: 'MongoDB disconnected', timestamp: new Date().toISOString(),
  }));
});

mongoose.connection.on('error', (err) => {
  isMongoConnected = false;
  mongodbConnected.set(0);
  console.log(JSON.stringify({
    level: 'error', msg: 'MongoDB error',
    error: err.message, timestamp: new Date().toISOString(),
  }));
});

mongoose.connect(mongoUri).catch((err) => {
  console.log(JSON.stringify({
    level: 'error', msg: 'MongoDB initial connection failed',
    error: err.message, timestamp: new Date().toISOString(),
  }));
});

// ── Health endpoints ──────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  // Liveness probe — returns 200 if Node.js process is alive.
  // Does NOT check MongoDB. Kubernetes: if this fails → restart container.
  // Restarting won't fix MongoDB — so we never include MongoDB here.
  res.status(200).json({
    status: 'ok',
    uptime_s: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', (req, res) => {
  // Readiness probe — returns 200 only when MongoDB is connected.
  // Kubernetes: if this fails → remove pod from Service endpoints.
  // Traefik stops routing to this pod until it passes again.
  if (isMongoConnected) {
    res.status(200).json({
      status: 'ready',
      mongodb: 'connected',
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(503).json({
      status: 'not_ready',
      mongodb: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/metrics', async (req, res) => {
  // Prometheus scrape endpoint — exposes all registered metrics.
  // Content-Type tells Prometheus which exposition format to parse.
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── Application routes ────────────────────────────────────────────────────

app.get('/goals', async (req, res) => {
  console.log(JSON.stringify({
    level: 'info', msg: 'fetching goals', timestamp: new Date().toISOString(),
  }));
  try {
    const goals = await Goal.find();
    // goals_total gauge is already accurate — do NOT update it here
    // Updating on GET would mask add/delete events between GETs
    res.status(200).json({
      goals: goals.map(g => ({ id: g.id, text: g.text })),
    });
  } catch (err) {
    console.log(JSON.stringify({
      level: 'error', msg: 'failed to fetch goals',
      error: err.message, timestamp: new Date().toISOString(),
    }));
    res.status(500).json({ message: 'Failed to fetch goals.' });
  }
});

app.post('/goals', async (req, res) => {
  const goalText = req.body.text;
  if (!goalText || goalText.trim().length === 0) {
    return res.status(422).json({ message: 'Invalid goal text.' });
  }
  try {
    const goal = new Goal({ text: goalText });
    await goal.save();
    goalsCreatedTotal.inc();                          // counter — never resets
    const count = await Goal.countDocuments();
    goalsTotal.set(count);                            // gauge — always accurate
    console.log(JSON.stringify({
      level: 'info', msg: 'goal created',
      text: goalText, timestamp: new Date().toISOString(),
    }));
    res.status(201).json({ message: 'Goal saved.', goal: { id: goal.id, text: goal.text } });
  } catch (err) {
    console.log(JSON.stringify({
      level: 'error', msg: 'failed to save goal',
      error: err.message, timestamp: new Date().toISOString(),
    }));
    res.status(500).json({ message: 'Failed to save goal.' });
  }
});

app.delete('/goals/:id', async (req, res) => {
  try {
    await Goal.deleteOne({ _id: req.params.id });
    goalsDeletedTotal.inc();                          // counter — never resets
    const count = await Goal.countDocuments();
    goalsTotal.set(count);                            // gauge — always accurate
    console.log(JSON.stringify({
      level: 'info', msg: 'goal deleted',
      id: req.params.id, timestamp: new Date().toISOString(),
    }));
    res.status(200).json({ message: 'Deleted goal.' });
  } catch (err) {
    console.log(JSON.stringify({
      level: 'error', msg: 'failed to delete goal',
      error: err.message, timestamp: new Date().toISOString(),
    }));
    res.status(500).json({ message: 'Failed to delete goal.' });
  }
});

// ── Graceful shutdown ─────────────────────────────────────────────────────
// SIGTERM is sent by Kubernetes when a pod is being terminated.
// We close the HTTP server (stop accepting new connections) and disconnect
// from MongoDB cleanly before the process exits.
// terminationGracePeriodSeconds (30s default) gives time for in-flight
// requests to complete before Kubernetes forcefully kills the process.
process.on('SIGTERM', async () => {
  console.log(JSON.stringify({
    level: 'info', msg: 'SIGTERM received — shutting down gracefully',
    timestamp: new Date().toISOString(),
  }));
  server.close(async () => {
    await mongoose.connection.close();
    console.log(JSON.stringify({
      level: 'info', msg: 'Shutdown complete',
      timestamp: new Date().toISOString(),
    }));
    process.exit(0);
  });
});

const server = app.listen(80, () => {
  console.log(JSON.stringify({
    level: 'info', msg: 'Backend listening', port: 80,
    timestamp: new Date().toISOString(),
  }));
});