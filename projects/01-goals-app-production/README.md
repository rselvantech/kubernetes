# Production Goals App — Three-Tier Application on Kubernetes

## Project Overview

This project deploys a production-grade three-tier Goals application on
Kubernetes — a React frontend, Node.js/Express backend, and MongoDB database —
applying every pattern required in a real production environment.

The application itself is simple: users create, view, and delete text goals.
The simplicity is intentional. Every production pattern covered here — probes,
init containers, StatefulSets, NetworkPolicies, Sealed Secrets, Traefik ingress,
structured observability — is applied to a system simple enough to reason about
completely, so the pattern itself is the focus rather than the application logic.

This project deliberately avoids GitOps and ArgoCD. It is a pure Kubernetes
project — manifests applied with `kubectl`, infrastructure installed with Helm.

**What you'll build:**
- A three-tier application with all pods communicating through Kubernetes Services
- Traefik v3 as the ingress controller — routing external traffic to the frontend,
  accessible via hostname-based routing on `goals.local`
- MongoDB as a StatefulSet with persistent storage, probes, and a PodDisruptionBudget
- A Node.js backend with liveness and readiness probes, init container dependency
  management, structured JSON logging, Prometheus metrics, and OpenTelemetry traces
- An nginx frontend with stub_status metrics and proper health probing
- Sealed Secrets for MongoDB credentials — safe to commit to Git
- NetworkPolicies enforced by Calico CNI — zero-trust inter-tier communication
- ResourceQuota and LimitRange for namespace governance

**What you'll learn:**
- How StatefulSets differ from Deployments for stateful workloads
- How init containers solve startup ordering without external orchestration
- How liveness and readiness probes work together — and why they are different
- How Traefik IngressRoute CRDs provide cleaner routing than Kubernetes Ingress
- How Sealed Secrets bring application secrets into the GitOps loop safely
- How NetworkPolicy enforces that MongoDB is reachable only from the backend
- How to design for scalability without implementing every scaler — requests,
  limits, PDB, and multi-replica readiness
- How structured logs, Prometheus metrics, and OTel traces are instrumented so
  an observability stack can be added later with zero application changes

**What this project connects to:**
- Helm packaging — the manifests here become a Helm chart
- EKS deployment — Traefik → AWS ALB, StatefulSet on EBS, Sealed Secrets on EKS
- Observability — metrics scraped by Prometheus, logs shipped to Loki,
  traces sent to Tempo via OTel Collector
- Autoscaling — HPA/KEDA on backend/frontend, VPA for right-sizing, Cluster
  Autoscaler on EKS

---

## The Goals Application

### What It Does

The Goals App is a simple goal-tracking web application. Users can:
- **Add goals** — type text and click Add Goal → stored in MongoDB
- **View goals** — the list loads automatically on page open
- **Delete goals** — click any goal to remove it

There are no user accounts, no authentication, no categories — just a plain
CRUD interface for a list of text items. The simplicity is deliberate: the
application logic is trivial so every layer of the stack is easy to reason
about independently.

### Three-Tier Architecture

```
Browser (React SPA)
    │  renders the UI, makes API calls using relative URLs
    │  GET /goals     → load goals list
    │  POST /goals    → add a goal
    │  DELETE /goals/:id → remove a goal
    ▼
nginx (Frontend Pod)
    │  serves React static files (HTML, JS, CSS)
    │  proxies /goals/* to the backend via proxy_pass
    │  acts as the bridge: browser talks to nginx, nginx talks to backend
    ▼
Node.js / Express (Backend Pod)
    │  REST API: GET /goals, POST /goals, DELETE /goals/:id
    │  health endpoints: /health, /ready
    │  observability: /metrics (Prometheus), JSON logs, OTel traces
    ▼
MongoDB (StatefulSet Pod)
    persistent storage via PVC
    course-goals database, goals collection
```

### Why nginx Is the Key Piece

The React app runs in the browser — outside Kubernetes, outside any network.
When the browser calls `/goals`, it sends that request to the same host and
port the page loaded from (`goals.local:80`). nginx intercepts it and proxies
it internally to `goals-backend-svc:80` using Kubernetes DNS.

This is why there is only one hostname (`goals.local`) and one ingress — the
browser only talks to nginx. The backend is invisible to the browser.

### Application Versions

| Component | Image | Version | Changes from v1 |
|---|---|---|---|
| Frontend | `rselvantech/goals-frontend` | `v2.0.0` | `/health`, `/nginx_status` endpoints added |
| Backend | `rselvantech/goals-backend` | `v2.0.0` | `/health`, `/ready`, `/metrics`, OTel traces, structured logs |
| MongoDB | `mongo` | `6.0` | Unchanged — official image |

---

## Prerequisites

**Required software:**
- Minikube v1.37.x
- kubectl configured
- Helm v3.19.x
- kubeseal CLI v0.36.x
- Docker (for building v2.0.0 images)

**Knowledge requirements:**
- Kubernetes Demos series through Demo-06 (Deployments, Services, resource requests/limits)
- Demo-04 (Pod Deep Dive — health probes)
- Familiarity with Docker multi-stage builds
- Completion of [Demo-14 Goals App Production](https://github.com/rselvantech/docker/blob/main/docker-practical-guide-2025/14-goals-app-production/README.md)

---

## Project Objectives

By the end of this project, you will be able to:

1. ✅ Explain why MongoDB uses a StatefulSet and what headless Services provide
2. ✅ Design init containers that solve startup ordering without PreSync hooks
3. ✅ Configure liveness and readiness probes for all three tiers correctly
4. ✅ Install Traefik v3 via Helm and route traffic using IngressRoute CRDs
5. ✅ Explain how IngressRoute differs from standard Kubernetes Ingress
6. ✅ Seal a Kubernetes Secret with kubeseal and verify decryption in the cluster
7. ✅ Write NetworkPolicies enforced by Calico CNI — verify blocking works
8. ✅ Instrument Node.js with prom-client for Prometheus metrics
9. ✅ Instrument Node.js with OpenTelemetry for distributed traces
10. ✅ Emit structured JSON logs from Node.js and nginx
11. ✅ Verify every component through targeted kubectl commands
12. ✅ Explain what changes when this application runs on EKS in production

---

## Directory Structure

```
projects/01-goals-app-production/
├── README.md
└── src/
    ├── backend/
    │   ├── app.js              ← updated: /health, /ready, /metrics, OTel, logs
    │   ├── tracing.js          ← new: OpenTelemetry SDK initialisation
    │   ├── Dockerfile          ← multi-stage, node:18-alpine, non-root user
    │   ├── package.json        ← prom-client, @opentelemetry/* dependencies
    │   └── models/
    │       └── goal.js         ← Mongoose schema (unchanged)
    ├── frontend/
    │   ├── nginx.conf          ← updated: /nginx_status, /health
    │   ├── Dockerfile          ← node:18-alpine builder + nginx:1.25-alpine
    │   └── src/                ← React source (unchanged from Demo-14)
    └── manifests/
        ├── 00-namespace/
        │   ├── namespace.yaml
        │   ├── resourcequota.yaml
        │   └── limitrange.yaml
        ├── 01-traefik/
        │   ├── helm/
        │   │   └── values.yaml ← Helm values (not a K8s manifest)
        │   ├── ingressroute.yaml
        │   └── middleware.yaml
        ├── 02-mongodb/
        │   ├── statefulset.yaml
        │   ├── service-headless.yaml
        │   ├── service.yaml
        │   └── pdb.yaml
        ├── 03-backend/
        │   ├── deployment.yaml
        │   ├── service.yaml
        │   ├── pdb.yaml
        │   └── networkpolicy.yaml
        ├── 04-frontend/
        │   ├── deployment.yaml
        │   ├── service.yaml
        │   ├── pdb.yaml
        │   └── networkpolicy.yaml
        └── 05-config/
            ├── configmap.yaml
            └── sealed-mongodb-secret.yaml
```

> **`manifests/01-traefik/helm/`** — `values.yaml` is a Helm configuration file,
> not a Kubernetes manifest. It lives in a `helm/` subdirectory so that
> `kubectl apply -f manifests/01-traefik/` only processes IngressRoute and
> Middleware — not the values file, which would cause a validation error.

---

## Architecture Overview

```
Windows Browser
    │  http://goals.local:8080
    │  hostname resolved by Windows hosts file → WSL2 IP
    ▼
kubectl port-forward (WSL2, --address=0.0.0.0)
    │  binds WSL2 ethernet interface — reachable from Windows
    ▼
Traefik Pod (traefik namespace)
    │  IngressRoute: Host(goals.local) → goals-frontend-svc:3000
    │  Middleware: RateLimit, SecurityHeaders
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Namespace: goals-production  (Calico CNI — NetworkPolicy enforced)     │
│                                                                         │
│  ┌────────────────────────┐   NetworkPolicy:                            │
│  │  goals-frontend (×2)   │   ingress: traefik namespace → :3000 only   │
│  │  nginx:1.25-alpine     │   egress:  → backend :80, kube-dns :53      │
│  │  port: 3000            │                                             │
│  │  liveness:  GET /health│                                             │
│  │  readiness: GET /health│                                             │
│  └──────────┬─────────────┘                                             │
│             │ proxy_pass http://goals-backend-svc:80                    │
│             ▼                                                           │
│  ┌────────────────────────┐   NetworkPolicy:                            │
│  │  goals-backend (×2)    │   ingress: frontend pods → :80 only         │
│  │  node:18-alpine        │   egress:  → mongodb :27017, kube-dns :53   │
│  │  port: 80              │                                             │
│  │  init: wait-for-mongo  │                                             │
│  │  liveness:  GET /health│                                             │
│  │  readiness: GET /ready │                                             │
│  └──────────┬─────────────┘                                             │
│             │ mongodb://...@mongodb:27017/course-goals                  │
│             ▼                                                           │
│  ┌───────────────────────┐   NetworkPolicy:                             │
│  │  mongodb-0            │   ingress: backend pods → :27017 only        │
│  │  mongo:6.0            │   egress:  none                              │
│  │  StatefulSet          │                                              │
│  │  init: sysctl tune    │                                              │
│  │  liveness:  tcp :27017│                                              │
│  │  readiness: mongosh   │                                              │
│  │  PVC: 2Gi (standard)  │                                              │
│  └───────────────────────┘                                              │
│                                                                         │
│  ConfigMap: MONGODB_HOST, MONGODB_DATABASE, BACKEND_HOST                │
│  SealedSecret → mongodb-secret (Sealed Secrets controller decrypts)     │
│  ResourceQuota: namespace resource ceiling                              │
│  LimitRange: default requests/limits for any unspecified container      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Production equivalent on EKS:**
```
Internet → Route53 DNS → AWS ALB (provisioned by AWS LB Controller)
  → Target Group: Traefik pods via NodePort
  → Traefik (same IngressRoute CRDs — zero changes)
  → goals-production namespace (same manifests — zero changes)
    MongoDB: EBS gp3 StorageClass, StatefulSet unchanged
    Sealed Secrets: same kubeseal workflow, different cluster key
    NetworkPolicy: enforced by VPC CNI + Calico, same YAML
    Traefik: type LoadBalancer (not NodePort), IngressRoute identical
```

---

## Understanding the Production Patterns

### Pattern 1 — StatefulSet vs Deployment for MongoDB

```
Deployment                        StatefulSet
──────────                        ───────────
Pod name: mongodb-7f8d9-xyz       Pod name: mongodb-0 (always)
PVC: created separately           PVC: volumeClaimTemplate (managed)
Pod restart: new random name      Pod restart: same name, same PVC
Pod delete: PVC stays orphaned    Pod delete: PVC preserved, reattached
Scale down: pods deleted in any   Scale down: pods deleted in reverse
           order                             order (N, N-1, N-2...)
Scale up: pods created in any     Scale up: pods created in order
          order                             (0, 1, 2...)
DNS: random pod IPs               DNS: mongodb-0.mongodb-headless.
                                       goals-production.svc.cluster.local
                                       (stable, predictable)
```

MongoDB requires stable storage identity — the same pod must reattach to
the same data volume after restart. A Deployment provides no such guarantee.
If MongoDB were a Deployment and the pod restarted, Kubernetes might schedule
it to a different node where the PVC cannot attach (especially on multi-node
clusters), or create a new PVC entirely and start with an empty database.

StatefulSets provide three guarantees that MongoDB needs:
1. **Stable pod name** — `mongodb-0` always, even after restart
2. **Stable DNS** — `mongodb-0.mongodb-headless` resolves to the same pod
3. **Stable storage** — `volumeClaimTemplate` creates a PVC per pod, persists
   across pod deletion, and is reattached when the pod restarts

```
StatefulSet with volumeClaimTemplate:

  StatefulSet: mongodb
    └── Pod: mongodb-0
          └── PVC: data-mongodb-0   ← created automatically, named predictably
                └── PV (bound)
                      └── /data/db  ← MongoDB data directory

  kubectl delete pod mongodb-0
    → Pod terminated
    → StatefulSet controller creates new mongodb-0
    → New pod binds to SAME PVC: data-mongodb-0
    → MongoDB starts with existing data ✅

  Compare with Deployment:
  kubectl delete pod mongodb-7f8d9-xyz
    → Pod terminated
    → Deployment controller creates mongodb-7f9a1-abc (new name)
    → No guaranteed PVC reattachment ❌
```

**Headless Service** (`clusterIP: None`) for MongoDB:
A regular Service provides a stable VIP that load-balances across pods.
For MongoDB, we need direct pod addressing — the application must connect
to a specific pod (the primary in a replica set), and init containers need
to resolve the pod IP for readiness polling. A headless Service creates DNS
records that resolve directly to pod IPs:

```
Regular Service (ClusterIP: 10.96.0.1):
  mongodb → 10.96.0.1 (VIP) → load-balanced → any pod
  Clients cannot target individual pods

Headless Service (ClusterIP: None):
  mongodb-0.mongodb-headless.goals-production.svc.cluster.local
    → directly to mongodb-0 pod IP
  Used by: init containers (for reliable readiness detection)
           MongoDB replica set internal communication (future)
           DNS-based service discovery
```

---

### Pattern 2 — Init Containers for Startup Ordering

Init containers run to completion before any regular container in the pod
starts. They share the pod network and storage but run sequentially, not
in parallel with the main container.

```
Backend Pod startup sequence:

  init container: wait-for-mongodb
    → runs mongosh ping against mongodb-0.mongodb-headless
    → retries every 5s until MongoDB accepts connections
    → exits 0 when MongoDB is ready
    → ONLY THEN does the main container start
    ↓
  main container: goals-backend (Node.js)
    → starts with guaranteed MongoDB availability
    → mongoose.connect() succeeds on first attempt
    → never sees "connection refused" on startup
```

**Why init containers, not just a retry loop in app.js?**

```
Retry loop in app.js:
  → App starts, tries to connect, fails
  → App retries (often with backoff)
  → App may serve HTTP requests BEFORE DB is ready
    → /goals returns 500
    → readiness probe may pass before DB is connected
  → Race condition between startup and readiness

Init container:
  → Pod is NOT Ready until init container exits 0
  → Main container NEVER starts until DB is confirmed ready
  → No retry logic needed in app.js
  → Readiness probe only runs after DB is confirmed available
  → Clean separation: infrastructure (init) vs application (main)
```

**Production note:** Init containers are also used for:
- Copying configuration files into shared volumes
- Waiting for secrets to be populated (Vault agent init)
- Running database migrations (instead of PreSync hooks — covered in
  the ArgoCD course)
- Fetching certificates before the main app starts

---

### Pattern 3 — Liveness vs Readiness Probes for a Three-Tier App

```
                   Liveness Probe              Readiness Probe
                   ──────────────              ───────────────
MongoDB:           tcpSocket :27017            exec: mongosh ping
                   "Is the process             "Is MongoDB accepting
                   listening?"                  authenticated queries?"

Backend:           httpGet GET /health         httpGet GET /ready
                   "Is Node.js alive?"         "Is Node.js alive AND
                   (pure process check)         connected to MongoDB?"

Frontend:          httpGet GET /               httpGet GET /
                   "Is nginx serving           "Is nginx serving
                   any response?"               any response?"
```

**Why `/health` and `/ready` are different endpoints:**

```
GET /health  →  200 if process is alive
               Returns: {"status":"ok","uptime":123.4}
               Fails only if: Node.js event loop is deadlocked,
                              process is in fatal error state

GET /ready   →  200 if process is alive AND MongoDB is connected
               Returns: {"status":"ready","mongodb":"connected"}
               Fails if: MongoDB connection is down, reconnecting,
                         timed out
               Returns 503 if: {"status":"not_ready","mongodb":"disconnected"}
```

**Why the distinction matters:**
```
Scenario: MongoDB goes down temporarily

  Liveness probe (/health): PASSES (Node.js process is fine)
    → pod is NOT restarted (correct — restarting won't fix MongoDB)

  Readiness probe (/ready): FAILS (MongoDB disconnected)
    → pod removed from Service endpoints
    → Traefik stops routing requests to this pod
    → users get 502 from healthy pods, not 503 from this degraded one
    → when MongoDB recovers, readiness passes, pod rejoins endpoints

  Without separate endpoints:
    → liveness probe hits /health (always passes)
    → no readiness probe
    → Traefik continues routing to backend that cannot serve requests
    → every request returns 500
```

**MongoDB probe design:**

```
tcpSocket for liveness:
  → checks if mongod is listening on :27017
  → fast, no auth required
  → correct: if mongod is not listening, restart the pod

exec mongosh for readiness:
  → checks if MongoDB accepts authenticated queries
  → slower but complete
  → correct: pod is only Ready if MongoDB actually works, not just running
```

---

### Pattern 4 — Traefik v3 — Deep Dive

Traefik is a modern reverse proxy and ingress controller designed for
cloud-native environments. It auto-discovers routing configuration from
Kubernetes resources and provides a real-time dashboard.

```
Traefik Architecture:

  EntryPoints (listeners)
    web:       port 8000 internally → :80 externally (HTTP)
    websecure: port 8443 internally → :443 externally (HTTPS)
    traefik:   port 9000 internally (dashboard/API)

  Providers (where routing config comes from)
    kubernetesCRD:     reads IngressRoute, Middleware, TraefikService CRDs
    kubernetesIngress: reads standard Ingress objects

  Routers (match rules → service)
    goals-frontend-route:
      match: Host(`goals.local`)
      entrypoints: [web]
      middlewares: [rate-limit, security-headers]
      service: goals-frontend-svc:3000

  Middlewares (transform requests/responses)
    rate-limit: limits req/s per IP
    security-headers: adds X-Frame-Options, X-Content-Type-Options etc.

  Services (backend targets)
    goals-frontend-svc (load balances across frontend pods)
```

**IngressRoute vs standard Kubernetes Ingress:**
```
Standard Ingress:                       Traefik IngressRoute:
  metadata:                               spec:
    annotations:                            entryPoints:
      traefik.io/middlewares:                 - web
        "ns-name@crd"   ← string!           routes:
      nginx.io/proxy-size:                  - match: Host(`goals.local`)
        "10m"   ← silently ignored            middlewares:
  spec:                                       - name: rate-limit
    rules:                                    services:
    - host: goals.local                       - name: svc
      http:                                     port: 3000
        paths:
        - path: /
          pathType: Prefix

  Problems:                               Advantages:
  → annotations are strings              → typed CRD — kubectl validates
  → wrong annotation silently ignored    → middleware is a named object ref
  → controller-specific, not portable    → dashboard shows live state
  → cannot compose complex rules         → richer matching: headers, paths
```

**Traefik on minikube vs production:**
```
minikube (this project):               Production (EKS):
  Service type: NodePort                 Service type: LoadBalancer
  Access: port-forward → localhost       Cloud provisions: NLB with public IP
  IngressRoute: identical ✅             IngressRoute: identical ✅
  Middleware: identical ✅               Middleware: identical ✅
  Add TLS: self-signed cert              Add TLS: cert-manager + Let's Encrypt
```

---

### Pattern 5 — nginx — Deep Dive

nginx inside `goals-frontend` has distinct role, it does below key functions 
- routing based on URL path 
- provide health endpoint for liveness and readiness probes
- generate plain-text stats


```
Incoming request → nginx (port 3000)
    │
    ├── path: /goals or /goals/*  ─────────► API Proxy
    │                                         proxy_pass → backend
    │
    └── path: everything else  ──────────────► Static File Server
                                               /usr/share/nginx/html/
```

**`nginx.conf` — every directive explained:**

```nginx
server {
    listen 3000;
    # Port nginx listens on inside the container.
    # Matches containerPort in the Deployment and Service port.
    # Frontend is on 3000 (not 80) to distinguish it from the backend.

    location / {
        # Matches all requests not caught by more specific location blocks.
        # /goals is more specific — it takes priority over / for API calls.

        root /usr/share/nginx/html;
        # Directory where nginx looks for files to serve.
        # React build output is copied here during docker build:
        #   COPY --from=builder /app/build /usr/share/nginx/html

        index index.html;
        # Serve index.html when a directory is requested (GET /).

        try_files $uri $uri/ /index.html;
        # Three-step fallback for React Router support:
        #   1. $uri       → look for exact file: GET /logo.png → logo.png ✅
        #   2. $uri/      → look for directory with index
        #   3. /index.html → fallback: GET /dashboard → no file → index.html
        #                    React Router reads the URL and renders /dashboard
        # Without this: refreshing any React route returns 404.
    }

    location /goals {
        # Matches /goals and /goals/* — all API calls from the React app.
        # React uses relative URL fetch('/goals') — browser sends to same host.
        # nginx intercepts and proxies to the backend service.

        proxy_pass http://${BACKEND_HOST}:80;
        # ${BACKEND_HOST} is substituted by envsubst at container start.
        # envsubst reads BACKEND_HOST env var and replaces the placeholder
        # before nginx reads the config.
        #
        # Docker Compose: BACKEND_HOST=backend   → proxy_pass http://backend:80
        # Kubernetes:     BACKEND_HOST=goals-backend-svc → proxy_pass http://goals-backend-svc:80
        #
        # nginx resolves the hostname using /etc/resolv.conf — same DNS
        # resolver every other process in the pod uses.
        # In Kubernetes: CoreDNS resolves goals-backend-svc → ClusterIP
        # No resolver directive needed — system DNS handles it automatically.

        proxy_set_header Host $host;
        # Pass the original Host header to the backend.
        # Without: backend sees Host: localhost (nginx's hostname)
        # With:    backend sees Host: goals.local (what browser sent)

        proxy_set_header X-Real-IP $remote_addr;
        # Pass the client's actual IP to the backend.
        # Without: backend sees all requests from 127.0.0.1 (nginx's IP)
        # With:    backend sees the real client IP for logging/security

        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # Standard header for proxy chains.
        # Accumulates IPs: client → proxy1 → proxy2 → backend
        # Backend reads first IP for original client.
    }

    location /nginx_status {
        # nginx built-in stub_status module — zero external libraries.
        # Exposes 4 metrics:
        #   Active connections: currently open connections
        #   Reading:  connections reading request headers
        #   Writing:  connections sending response
        #   Waiting:  keep-alive connections waiting for next request
        #   Requests: total requests handled since nginx start

        stub_status on;
        access_log off;
        # Suppress access log entries for health scrapes — reduces noise.

        allow 127.0.0.1;
        allow 10.0.0.0/8;
        # Allow scraping from localhost (sidecar) and cluster CIDR.
        # 10.0.0.0/8 covers most Kubernetes pod CIDRs.

        deny all;
        # Block all other access — stub_status should not be public.
    }

    location /health {
        # Nginx health endpoint for liveness and readiness probes.
        # Returns 200 immediately if nginx is serving — no backend check.
        # Probe timeout is 5s — this returns in < 1ms.

        access_log off;
        return 200 '{"status":"ok"}';
        add_header Content-Type application/json;
    }
}
```

**How `${BACKEND_HOST}` substitution works at container start:**
```
1. Dockerfile copies nginx.conf to /etc/nginx/templates/default.conf.template
2. nginx:1.25-alpine entrypoint runs envsubst automatically on all templates
3. envsubst reads BACKEND_HOST from environment
4. Replaces ${BACKEND_HOST} in the template
5. Writes result to /etc/nginx/conf.d/default.conf
6. nginx starts and reads the resolved config

Result in Kubernetes:
  /etc/nginx/conf.d/default.conf contains:
    proxy_pass http://goals-backend-svc:80;
  nginx resolves goals-backend-svc via CoreDNS → ClusterIP → backend pod
```

**What stub_status is?**

The stub_status NGINX module provides a simple HTTP endpoint (commonly /nginx_status) that returns plain-text stats about the NGINX worker:

```
Active connections
Accepted connections
Handled connections
Total requests
Reading / Writing / Waiting connection states
```

---

### Pattern 6 — NetworkPolicy Zero-Trust

NetworkPolicy objects are created by Kubernetes but enforcement requires a CNI plugin that supports NetworkPolicy. Creating a NetworkPolicy resource without a controller that implements it will have no effect.

This project uses Calico CNI (`minikube start --cni=calico`) which enforces NetworkPolicy rules at the kernel level via iptables.

```
Without NetworkPolicy:
  frontend pods → backend pods     ✅ (correct)
  frontend pods → mongodb pods     ✅ (WRONG — frontend should never touch DB)
  backend pods  → mongodb pods     ✅ (correct)
  any pod       → any other pod    ✅ (WRONG — open cluster)

With NetworkPolicy (this project):
  Traefik pods  → frontend pods port 3000   ✅ (external ingress)
  frontend pods → backend pods  port 80     ✅ (API proxy)
  backend pods  → mongodb pods  port 27017  ✅ (database)
  frontend pods → mongodb pods              ❌ BLOCKED
  backend pods  → frontend pods             ❌ BLOCKED
  external pods → mongodb pods              ❌ BLOCKED
```

**CNI requirement:** NetworkPolicy objects are created by Kubernetes but
enforcement requires a CNI plugin that supports NetworkPolicy. Minikube's
default CNI (kindnet) does NOT enforce NetworkPolicy. For enforcement on
minikube, enable the Calico CNI addon:

```bash
minikube start --cni=calico
```

For this project, NetworkPolicy objects are created and committed — they
document the intended security posture and will be enforced on any cluster
with a compliant CNI (Calico, Cilium, AWS VPC CNI with Calico). On minikube
without Calico, they are created but unenforced — traffic flows as if they
do not exist. The verification section shows how to confirm whether
enforcement is active.

**On EKS:** VPC CNI with Calico enforces the same NetworkPolicy YAML.
Zero manifest changes needed for production.

---

### Pattern 7 — Observability: Metrics, Logs, Traces

The three pillars of observability, all instrumented with zero-dependency
on a specific backend — any Prometheus, Loki, or Jaeger-compatible system
can collect them without application changes.

```
┌─────────────────────────────────────────────────────────────┐
│                    Observability Stack                      │
│                                                             │
│  Application    │  Emits              │  Collected by       │
│  ─────────────  │  ────────────────── │  ─────────────────  │
│  Backend        │  Prometheus metrics │  Prometheus scrape  │
│    /metrics     │  (prom-client)      │  → Grafana          │
│                 │                     │                     │
│  Backend        │  JSON logs stdout   │  Fluent Bit/Loki    │
│    console.log  │  {level, msg, ...}  │  → Grafana/Loki     │
│                 │                     │                     │
│  Backend        │  OTel traces OTLP   │  OTel Collector     │
│    tracing.js   │  (console now)      │  → Jaeger/Tempo     │
│                 │                     │  → Grafana          │
│                 │                     │                     │
│  Frontend       │  nginx stub_status  │  nginx-prometheus-  │
│    /nginx_status│  (built-in module)  │  exporter sidecar   │
│                 │                     │  → Grafana          │
└─────────────────────────────────────────────────────────────┘
```

**Why this design:**
- `prom-client` is the standard Node.js Prometheus library — used in 90%
  of Node.js production clusters
- JSON logs to stdout — Kubernetes captures stdout/stderr; Fluent Bit ships
  them to Loki without any application involvement
- OTel SDK console exporter now — change one line to point at OTel Collector
  later, zero code changes in the application logic
- nginx stub_status — built into nginx, zero extra packages

```
Signal    │ Emitted by      │ Format              │ Collected by (later)
──────────┼─────────────────┼─────────────────────┼──────────────────────
Metrics   │ /metrics        │ Prometheus text      │ Prometheus → Grafana
Logs      │ stdout (JSON)   │ Structured JSON      │ Fluent Bit → Loki
Traces    │ OTel console    │ OTLP (stdout now)    │ OTel Collector → Tempo
nginx     │ /nginx_status   │ stub_status text     │ nginx-exporter sidecar
```

**Backend metrics — full list:**
```
Default Node.js metrics (auto-collected by prom-client):
  process_cpu_seconds_total             CPU usage
  process_resident_memory_bytes         RSS memory
  nodejs_heap_size_total_bytes          V8 heap total
  nodejs_heap_size_used_bytes           V8 heap used
  nodejs_event_loop_lag_seconds         Event loop lag histogram
                                        ← most important Node.js health signal
  nodejs_gc_duration_seconds            Garbage collection duration

Custom application metrics:
  http_requests_total{method,route,status_code}
    → request counter per endpoint and status
    → error_rate = rate(http_requests_total{status_code=~"5.."}[5m])
                 / rate(http_requests_total[5m])

  http_request_duration_seconds{method,route}
    histogram — latency per endpoint with buckets [5ms..5s]
    use: p95 = histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

  goals_created_total
    counter — total goals ever created (never decrements)
    use: throughput over time, rate of goal creation

  goals_deleted_total
    counter — total goals ever deleted (never decrements)
    use: deletion rate, churn analysis

  mongodb_connected
    gauge — 1=connected, 0=disconnected
    use: alert immediately on DB loss

  goals_total
    gauge — current count in database
    updated on startup (countDocuments), incremented on POST, decremented on DELETE
    use: current state, business dashboard counter
```

**Frontend metrics:**

nginx has built-in stub_status module exposing below metrics.Enable via a /nginx_status location block. Simple, zero additional libraries.

```
nginx_connections_active     — active connections
nginx_connections_reading    — connections reading request
nginx_connections_writing    — connections writing response
nginx_requests_total         — total requests handled
```

---

### Pattern 8 — Sealed Secrets

```
kubeseal workflow:

  kubectl create secret ... --dry-run=client -o yaml   ← not applied
    │ plaintext Secret YAML on stdout
    ▼
  kubeseal --format yaml                               ← encrypts
    │ fetches controller public key from cluster
    │ encrypts each value with that key
    ▼
  sealed-mongodb-secret.yaml                           ← safe to commit
    encryptedData:
      MONGODB_PASSWORD: AgBy3i4OJSWK...               ← ciphertext

  kubectl apply sealed-mongodb-secret.yaml
    │
    ▼
  Sealed Secrets controller watches for SealedSecret CRDs
    │ decrypts using controller private key
    ▼
  native Kubernetes Secret: mongodb-secret             ← pods read this
```

**Trade-off to know:** A SealedSecret is encrypted with the specific cluster's
controller key. On cluster recreation, either re-seal with `kubeseal` (easiest)
or restore the controller's private key backup (production practice).

---

### Pattern 9 — ResourceQuota and LimitRange

```
ResourceQuota — hard ceiling for entire namespace:
  Kubernetes rejects pods that would exceed quota.
  Prevents one app from consuming all cluster resources.

LimitRange — defaults for individual containers:
  Any container without explicit requests/limits gets LimitRange defaults.
  Prevents unbounded containers running without constraints.

Together:
  Namespace cannot exceed: 15 pods, 4 CPU, 8Gi memory
  Any unspecified container gets: 100m CPU request, 128Mi memory request
```

---

## Source Code Overview

### `backend/app.js` — Structure and Sections

```
app.js sections (in order):

1. require('./tracing')              ← OTel must be first — patches Node.js internals
2. require(express, mongoose, ...)   ← application imports
3. Morgan logging setup              ← custom JSON token for structured logs
4. Prometheus registry + metrics     ← register all counters, histograms, gauges
5. Request middleware                 ← timer starts on every request, records on finish
6. MongoDB connection                 ← connection string from env vars, event listeners
7. GET /health                        ← liveness: returns 200 if process alive
8. GET /ready                         ← readiness: returns 200/503 based on MongoDB state
9. GET /metrics                       ← Prometheus scrape endpoint
10. GET /goals                        ← fetch all goals, update goals_total gauge
11. POST /goals                       ← save goal, increment goals_total + goals_created_total
12. DELETE /goals/:id                 ← delete goal, decrement goals_total, increment goals_deleted_total
13. SIGTERM handler                   ← graceful shutdown: close server → close MongoDB → exit
14. app.listen(80)                    ← start server
```

**Key design decisions in `app.js`:**

**Metrics are updated on every write, not just on read:**
```javascript
// On startup — seed gauge from actual DB count
mongoose.connection.once('connected', async () => {
  const count = await Goal.countDocuments();
  goalsTotal.set(count);    // accurate from first scrape
});

// On POST /goals — increment without querying DB
await goal.save();
goalsTotal.inc();            // gauge stays accurate
goalsCreatedTotal.inc();     // monotonic counter for throughput

// On DELETE /goals/:id — decrement without querying DB
await Goal.deleteOne({ _id: req.params.id });
goalsTotal.dec();            // gauge stays accurate
goalsDeletedTotal.inc();     // monotonic counter for churn

// On GET /goals — DO NOT update gauge (it is already accurate)
```

**Liveness and readiness are independent:**
```javascript
// /health — never checks MongoDB
// If MongoDB is down: /health still returns 200
// Kubernetes: pod NOT restarted (restart won't fix MongoDB)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime_s: Math.floor(process.uptime()) });
});

// /ready — checks isMongoConnected flag
// Flag set by mongoose connection event listeners (not by polling)
// If MongoDB is down: /ready returns 503
// Kubernetes: pod removed from Service endpoints
app.get('/ready', (req, res) => {
  if (isMongoConnected) {
    res.status(200).json({ status: 'ready', mongodb: 'connected' });
  } else {
    res.status(503).json({ status: 'not_ready', mongodb: 'disconnected' });
  }
});
```

**Structured JSON logging with Morgan:**
```javascript
// Morgan token produces one JSON object per request line
// Kubernetes captures stdout — no log agent needed in pod
// Fluent Bit picks up container stdout and ships to Loki
morgan.token('json-log', (req, res) => JSON.stringify({
  level: 'info',
  msg: `${req.method} ${req.url} ${res.statusCode}`,
  timestamp: new Date().toISOString(),
  method: req.method,
  url: req.url,
  status: res.statusCode,
}));
app.use(morgan(':json-log'));
```

**Graceful shutdown — why it matters:**
```javascript
// Kubernetes sends SIGTERM before killing the pod
// Without handler: process exits immediately — in-flight requests lost
// With handler:
//   1. stop accepting new connections (server.close)
//   2. wait for in-flight requests to complete
//   3. close MongoDB connection cleanly
//   4. exit 0
// terminationGracePeriodSeconds: 30 gives 30s for this to complete
process.on('SIGTERM', async () => {
  server.close(async () => {
    await mongoose.connection.close();
    process.exit(0);
  });
});
```

---

### `backend/tracing.js` — OpenTelemetry Setup

```javascript
// tracing.js must be required first in app.js
// It patches Node.js internals before any other module loads
// This is how auto-instrumentation intercepts HTTP and MongoDB calls

const sdk = new NodeSDK({
  serviceName: 'goals-backend',      // appears in every span
  traceExporter: new ConsoleSpanExporter(),  // stdout now
  // Future: replace with OTLPTraceExporter pointing at OTel Collector
  // One line change — zero application code changes
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      // fs instrumentation creates a span for every file read
      // extremely noisy — hundreds of spans for node_modules loading
    }),
  ],
});

sdk.start();
// Auto-instrumentation now active:
//   Every Express route → span: {method, url, status, duration}
//   Every mongoose query → span: {operation, collection, filter, duration}
```

**What a trace looks like in stdout:**
```json
{
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "name": "POST /goals",
  "kind": "SERVER",
  "duration": 45000,
  "attributes": {
    "http.method": "POST",
    "http.url": "/goals",
    "http.status_code": 201
  },
  "events": [],
  "links": []
}
```

**Future migration to full tracing stack — one line change:**
```javascript
// Current: console exporter
traceExporter: new ConsoleSpanExporter()

// Future: OTel Collector
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
traceExporter: new OTLPTraceExporter({ url: 'http://otel-collector:4318/v1/traces' })
// Application code in app.js: ZERO changes
```

---

### `backend/package.json` — Dependency Explanation

```json
{
  "dependencies": {
    "express":    "^4.18.0",   // HTTP framework — routing, middleware
    "mongoose":   "^7.0.0",   // MongoDB ODM — schema, connection, queries
    "morgan":     "^1.10.0",  // HTTP request logger middleware

    "prom-client": "^15.0.0", // Prometheus client — counters, gauges, histograms
                               // collectDefaultMetrics() → Node.js runtime metrics

    "@opentelemetry/api":      "^1.9.0",   // OTel API — stable, semantic conventions
    "@opentelemetry/sdk-node": "^0.214.x", // Meta-package — wires all OTel components
                                            // experimental track (0.2xx)
    "@opentelemetry/sdk-trace-node": "^2.6.0", // Tracer — stable track (2.x)
    "@opentelemetry/auto-instrumentations-node": "^0.60.0"
    // Auto-instruments: http, express, mongoose, dns, net, etc.
    // No manual span creation needed for standard operations
  }
}
```

**OTel versioning — why two version tracks:**
```
Stable packages (1.x / 2.x):    @opentelemetry/api, sdk-trace-node, sdk-metrics
Experimental packages (0.2xx):  @opentelemetry/sdk-node, auto-instrumentations-node

They co-exist — sdk-node@0.214 depends on sdk-trace-node@2.x internally.
Install both — npm resolves the correct peer dependency tree automatically.
The split exists because the OTel spec stabilised faster than the Node.js SDK.
```

## Part 0 — Minikube Setup

### Step 0a: Create a Fresh Minikube Cluster

> **Why a fresh cluster instead of the existing `3node` profile?**
> The `3node` profile complicates this project in two ways:
> - Storage: the minikube hostpath provisioner on a multi-node cluster
>   cannot decide which node to provision on — PVCs get stuck Pending
> - Traefik access: port-forwarding on a multi-node cluster requires
>   specifying node IPs; a single-node cluster simplifies this significantly
>
> Create a dedicated single-node cluster for this project. The existing
> `3node` profile is unaffected — minikube supports multiple profiles.

**Delete any existing cluster for this project (if needed):**
```bash
minikube delete -p goals-prod 2>/dev/null || true
```

**Create the cluster with all required configuration:**
```bash
minikube start \
  -p goals-prod \
  --driver=docker \
  --cpus=4 \
  --memory=6144 \
  --cni=calico \
  --ports=127.0.0.1:8080:30080 \
  --ports=127.0.0.1:9000:30900
```

**What each flag does:**

```
-p goals-prod           Named profile — separate from default/3node profiles.
                        Allows running alongside other clusters.

--driver=docker         Uses Docker as the VM driver (WSL2 standard).

--cpus=4                Allocate 4 CPUs to minikube.
--memory=6144           6GB RAM — MongoDB + 2 backend + 2 frontend + Traefik
                        needs headroom. Adjust if your machine has less RAM.

--cni=calico            Install Calico as the CNI plugin.
                        REQUIRED for NetworkPolicy enforcement.
                        Default kindnet CNI creates NetworkPolicy objects
                        but does not enforce them — traffic flows through
                        as if no policy exists.

--ports=127.0.0.1:8080:30080
                        Publish minikube NodePort 30080 (Traefik web) to
                        WSL2 localhost:8080.
                        WSL2 auto-forwards localhost to Windows localhost.
                        Windows browser can reach http://localhost:8080.

--ports=127.0.0.1:9000:30900
                        Publish minikube NodePort 30900 (Traefik dashboard)
                        to WSL2 localhost:9000.
```

> **How `--ports` solves the WSL2 Traefik access problem:**
> Without `--ports`, minikube NodePorts are only reachable at the Docker
> network IP (`192.168.58.x`) which Windows cannot reach directly.
> The `--ports` flag tells Docker to publish those ports to WSL2 localhost
> at cluster creation time. WSL2 automatically bridges WSL2 localhost to
> Windows localhost. No `kubectl port-forward`, no `minikube tunnel`.
>
> Windows hosts file entry: `127.0.0.1 goals.local traefik.local`
> Windows browser: `http://goals.local:8080` and `http://traefik.local:8080`

**Set `goals-prod` as the active profile:**
```bash
minikube profile goals-prod
```

**Wait for the cluster to be ready:**
```bash
kubectl wait --for=condition=Ready node/goals-prod \
  --timeout=180s
```

**Verify the cluster is running:**
```bash
kubectl get nodes
```

**Expected:**
```text
NAME        STATUS   ROLES           AGE   VERSION
goals-prod  Ready    control-plane   90s   v1.33.x
```

**Verify Calico pods are running (takes 60-90s):**
```bash
kubectl get pods -n kube-system | grep calico
```

**Expected — all calico pods Running:**
```text
calico-kube-controllers-xxxxxxxxx-xxxxx   1/1   Running   0   60s
calico-node-xxxxx                         1/1   Running   0   60s
```

> **If Calico pods are not Running after 2 minutes:**
> ```bash
> kubectl describe pod -n kube-system -l k8s-app=calico-node | grep -A10 Events
> ```
> On WSL2 with Docker driver, Calico sometimes needs the loose RPF check
> disabled:
> ```bash
> kubectl -n kube-system set env daemonset/calico-node FELIX_IGNORELOOSERPF=true
> ```

**Enable the storage provisioner addon:**
```bash
minikube addons enable storage-provisioner -p goals-prod
minikube addons enable default-storageclass -p goals-prod
```

**Verify storage provisioner is running:**
```bash
kubectl get pods -n kube-system | grep storage
```

**Expected:**
```text
storage-provisioner   1/1   Running   0   10s
```

**Verify default StorageClass exists:**
```bash
kubectl get storageclass
```

**Expected:**
```text
NAME                 PROVISIONER                RECLAIMPOLICY   VOLUMEBINDINGMODE
standard (default)   k8s.io/minikube-hostpath   Delete          Immediate
```

**Add Windows hosts file entry (one-time, permanent):**

Open Notepad as Administrator on Windows. Open:
```
C:\Windows\System32\drivers\etc\hosts
```

Add:
```
127.0.0.1  goals.local
127.0.0.1  traefik.local
```

> **Why Windows hosts file:**
> The browser runs on Windows. Windows DNS resolves `goals.local` using
> the Windows hosts file — WSL `/etc/hosts` is invisible to the browser.
> The `--ports` mapping at cluster creation means `127.0.0.1:8080` on
> Windows reaches Traefik's NodePort 30080 on the minikube node.

---

### Step 0b: Install and Verify Required Tools

**kubeseal CLI:**
```bash
# Get latest version
KUBESEAL_VERSION=$(curl -s \
  https://api.github.com/repos/bitnami-labs/sealed-secrets/releases/latest \
  | grep '"tag_name"' | cut -d'"' -f4 | sed 's/v//')

echo "Installing kubeseal v${KUBESEAL_VERSION}"

curl -OL "https://github.com/bitnami-labs/sealed-secrets/releases/download/v${KUBESEAL_VERSION}/kubeseal-${KUBESEAL_VERSION}-linux-amd64.tar.gz"

tar -xvzf kubeseal-${KUBESEAL_VERSION}-linux-amd64.tar.gz kubeseal

sudo install -m 755 kubeseal /usr/local/bin/kubeseal

rm kubeseal kubeseal-${KUBESEAL_VERSION}-linux-amd64.tar.gz
```

**Verify kubeseal:**
```bash
kubeseal --version
```

**Expected:**
```text
kubeseal version: 0.36.x
```

**Install Sealed Secrets controller:**
```bash
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm repo update

helm install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system \
  --version 2.18.5 \
  --set fullnameOverride=sealed-secrets
```

> **`fullnameOverride=sealed-secrets`** — sets a predictable service name.
> `kubeseal` looks for this service to fetch the controller's public key.
> Without it, the auto-generated name varies and `kubeseal` needs
> `--controller-name` on every command.

**Wait for controller to be ready:**
```bash
kubectl rollout status deployment/sealed-secrets -n kube-system
```

**Expected:**
```text
deployment "sealed-secrets" successfully rolled out
```

**Verify kubeseal can reach the controller:**
```bash
kubeseal --fetch-cert \
  --controller-name=sealed-secrets \
  --controller-namespace=kube-system
```

**Expected — PEM certificate printed:**
```text
-----BEGIN CERTIFICATE-----
MIIEzTCCArWgAwIBAgIRAIO3EC...
-----END CERTIFICATE-----
```


**Verify all tools in one block:**
```bash
echo "kubectl:  $(kubectl version --client --short 2>/dev/null | head -1)"
echo "helm:     $(helm version --short)"
echo "kubeseal: $(kubeseal --version)"
echo "docker:   $(docker --version)"
```

```text
kubectl:  Client Version: v1.34.1
helm:     v3.19.0+g3d8990f
kubeseal: kubeseal version: 0.36.6
docker:   Docker version 28.4.0, build d8eb465
```

---

## Part 0c — Project Setup

### Step 0c: Create Project Directory and Copy Base Source Files

```bash
cd projects/01-goals-app-production
mkdir -p src/manifests
```

**Copy the base source files from Docker Demo-14:**

```bash
# Copy backend source
cp -r ../../docker/docker-practical-guide-2025/14-goals-app-production/src/backend src/backend

# Copy frontend source
cp -r ../../docker/docker-practical-guide-2025/14-goals-app-production/src/frontend src/frontend
```

> Adjust the path above to match where your Docker course repo lives locally.
> The source directory in the Docker repo is:
> `14-goals-app-production/src/backend/` and `14-goals-app-production/src/frontend/`

**Verify the copied structure:**

```bash
find src/backend src/frontend -type f | grep -v "node_modules" | sort 
```

**Expected — base files from Docker Demo-14:**
```text
src/backend/.dockerignore
src/backend/Dockerfile
src/backend/app.js
src/backend/logs/access.log
src/backend/models/goal.js
src/backend/package-lock.json
src/backend/package.json
src/frontend/.dockerignore
src/frontend/Dockerfile
src/frontend/README.md
src/frontend/nginx.conf
src/frontend/package-lock.json
src/frontend/package.json
src/frontend/public/favicon.ico
src/frontend/public/index.html
src/frontend/public/logo192.png
src/frontend/public/logo512.png
src/frontend/public/manifest.json
src/frontend/public/robots.txt
src/frontend/src/App.js
src/frontend/src/components/UI/Card.css
src/frontend/src/components/UI/Card.js
src/frontend/src/components/UI/ErrorAlert.css
src/frontend/src/components/UI/ErrorAlert.js
src/frontend/src/components/UI/LoadingSpinner.css
src/frontend/src/components/UI/LoadingSpinner.js
src/frontend/src/components/goals/CourseGoals.css
src/frontend/src/components/goals/CourseGoals.js
src/frontend/src/components/goals/GoalInput.css
src/frontend/src/components/goals/GoalInput.js
src/frontend/src/components/goals/GoalItem.css
src/frontend/src/components/goals/GoalItem.js
src/frontend/src/index.css
src/frontend/src/index.js
```

**What carries forward unchanged from Docker Demo-14:**

| File | Status | Reason |
|---|---|---|
| `frontend/src/App.js` | ✅ No change | Already uses relative URL `/goals` — correct for Kubernetes |
| `frontend/src/components/` | ✅ No change | React UI components — unchanged |
| `frontend/public/` | ✅ No change | Static HTML/icons — unchanged |
| `frontend/package.json` | ✅ No change | React dependencies unchanged |
| `frontend/package-lock.json` | ✅ No change | Lock file carries forward |
| `backend/models/goal.js` | ✅ No change | Mongoose schema unchanged |

**What gets replaced or added in Part 1:**

| File | Action | What changes |
|---|---|---|
| `backend/app.js` | **Replace** | Add `/health`, `/ready`, `/metrics`, structured JSON logs, OTel, graceful shutdown |
| `backend/tracing.js` | **Add new** | OTel SDK initialisation |
| `backend/package.json` | **Replace** | Add `prom-client`, `@opentelemetry/*` dependencies |
| `backend/package-lock.json` | **Regenerate** | Regenerated after new deps added |
| `backend/Dockerfile` | **Replace** | Add non-root user, same node:18-alpine base |
| `frontend/nginx.conf` | **Replace** | Add `/nginx_status`, `/health` locations |
| `frontend/Dockerfile` | ✅ No change | Already uses node:18-alpine builder + nginx:1.25-alpine |

**Create the manifests subdirectories:**

```bash
mkdir -p src/manifests/00-namespace
mkdir -p src/manifests/01-traefik/helm
mkdir -p src/manifests/02-mongodb
mkdir -p src/manifests/03-backend
mkdir -p src/manifests/04-frontend
mkdir -p src/manifests/05-config
```
**Verify the project structure is ready before proceeding:**

```bash
ls src/backend/
ls src/frontend/
ls src/manifests/
```

**Expected:**
```text
src/backend/:
Dockerfile  app.js  logs  models  node_modules  package-lock.json  package.json

src/frontend/:
Dockerfile  nginx.conf  package.json  package-lock.json  public/  src/

src/manifests/:
00-namespace/  01-traefik/  02-mongodb/  03-backend/  04-frontend/  05-config/
```

You now have the base source files in place. Part 1 makes the targeted
changes on top of these files to add production observability and health
endpoints. Part 2 onwards creates all manifest files.

---

## Part 1 — Update Backend Source Code

### Step 1: Update `backend/app.js`

The backend requires three new endpoints and observability instrumentation.

```bash
cd projects/01-goals-app-production/src/backend

#Create new file backend/tracing.js
touch tracing.js
```

**Full updated `app.js`:**

```javascript
// Load OTel tracing FIRST — before any other require
// Must be first: auto-instrumentation patches Node.js internals at load time
require('./tracing');

const express  = require('express');
const mongoose = require('mongoose');
const morgan   = require('morgan');
const client   = require('prom-client');
const Goal     = require('./models/goal');

const app = express();

// ── Structured JSON logging ───────────────────────────────────────────────
// Morgan custom token produces one JSON object per request → stdout.
// Kubernetes captures stdout automatically.
// Fluent Bit or Vector ships it to Loki without any in-pod log agent.
morgan.token('json-log', (req, res) => JSON.stringify({
  level:      'info',
  msg:        `${req.method} ${req.url} ${res.statusCode}`,
  timestamp:  new Date().toISOString(),
  method:     req.method,
  url:        req.url,
  status:     res.statusCode,
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
  name:       'http_requests_total',
  help:       'Total HTTP requests by method, route, and status code',
  labelNames: ['method', 'route', 'status_code'],
  registers:  [register],
});

// http_request_duration_seconds — histogram per method and route
// Used for: p50/p95/p99 latency SLOs
// Buckets: 5ms, 10ms, 50ms, 100ms, 500ms, 1s, 5s — covers fast APIs
const httpRequestDuration = new client.Histogram({
  name:       'http_request_duration_seconds',
  help:       'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets:    [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers:  [register],
});

// mongodb_connected — gauge: 1 when connected, 0 when disconnected
// Used for: alert on DB connection loss, readiness correlation
const mongodbConnected = new client.Gauge({
  name:      'mongodb_connected',
  help:      'MongoDB connection status: 1=connected, 0=disconnected',
  registers: [register],
});

// goals_total — current count in database
// Updated on startup (countDocuments), inc on POST, dec on DELETE
// NOT updated on GET — gauge stays accurate without querying DB on every read
const goalsTotal = new client.Gauge({
  name:      'goals_total',
  help:      'Current number of goals in the database',
  registers: [register],
});

// goals_created_total — monotonic counter, never decrements
// Use for: goal creation rate, throughput over time
const goalsCreatedTotal = new client.Counter({
  name:      'goals_created_total',
  help:      'Total number of goals ever created',
  registers: [register],
});

// goals_deleted_total — monotonic counter, never decrements
// Use for: deletion rate, churn analysis
const goalsDeletedTotal = new client.Counter({
  name:      'goals_deleted_total',
  help:      'Total number of goals ever deleted',
  registers: [register],
});

// Track every request: start timer on incoming, record on finish
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer({
    method: req.method,
    route:  req.path,
  });
  res.on('finish', () => {
    end();
    httpRequestsTotal.inc({
      method:      req.method,
      route:       req.path,
      status_code: res.statusCode,
    });
  });
  next();
});

app.use(express.json());

// ── MongoDB connection ────────────────────────────────────────────────────
const mongoHost     = process.env.MONGODB_HOST     || 'mongodb';
const mongoDatabase = process.env.MONGODB_DATABASE || 'course-goals';
const mongoUser     = process.env.MONGODB_USERNAME;
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
    status:    'ok',
    uptime_s:  Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', (req, res) => {
  // Readiness probe — returns 200 only when MongoDB is connected.
  // Kubernetes: if this fails → remove pod from Service endpoints.
  // Traefik stops routing to this pod until it passes again.
  if (isMongoConnected) {
    res.status(200).json({
      status:    'ready',
      mongodb:   'connected',
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(503).json({
      status:    'not_ready',
      mongodb:   'disconnected',
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
    goalsTotal.inc();         // gauge: current count +1
    goalsCreatedTotal.inc();  // counter: total ever created +1
    console.log(JSON.stringify({
      level: 'info', msg: 'goal created',
      text: goalText, timestamp: new Date().toISOString(),
    }));
    res.status(201).json({
      message: 'Goal saved.',
      goal: { id: goal.id, text: goal.text },
    });
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
    goalsTotal.dec();         // gauge: current count -1
    goalsDeletedTotal.inc();  // counter: total ever deleted +1
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
```

### Step 2: Create `backend/tracing.js`

```javascript
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

'use strict';

const { NodeSDK }             = require('@opentelemetry/sdk-node');
const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  serviceName:    'goals-backend',
  traceExporter:  new ConsoleSpanExporter(),
  // To switch to a real tracing backend — one line change:
  // const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  // traceExporter: new OTLPTraceExporter({ url: 'http://otel-collector:4318/v1/traces' })
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }, // very noisy
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
```

### Step 3a: Update `backend/package.json`

```json
{
  "name": "goals-backend",
  "version": "2.0.0",
  "description": "Goals App backend — production-grade Node.js/Express",
  "main": "app.js",
  "scripts": {
    "start": "node app.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "mongoose": "^7.0.0",
    "morgan": "^1.10.0",
    "prom-client": "^15.0.0",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-node": "^0.214.0",
    "@opentelemetry/sdk-trace-node": "^2.6.0",
    "@opentelemetry/auto-instrumentations-node": "^0.60.0"
  }
}
```

### Step 3b: Generate `package-lock.json`** & Verify

No local npm required fo rthis

```bash
# Remove old lock file if it exists
rm -f package-lock.json


# Generate fresh lock file using Docker (no local npm needed)
docker run --rm \
  -v $(pwd):/app \
  -w /app \
  node:18-alpine \
  npm install
```

**Verify install succeeded:**
```bash
# Verify file generated locally 
ls package-lock.json

docker run --rm -v $(pwd):/app -w /app node:18-alpine node -e "
  require('@opentelemetry/sdk-node');
  require('@opentelemetry/sdk-trace-node');
  require('@opentelemetry/auto-instrumentations-node');
  console.log('OTel packages OK');"
```

**Expected:**
```text
OTel packages OK
```

### Step 3c: Verify end-to-end before building the image

Run the backend locally in Docker to confirm all packages load correctly:

```bash
cd src/backend

docker run --rm \
  -v $(pwd):/app \
  -w /app \
  -e MONGODB_USERNAME=test \
  -e MONGODB_PASSWORD=test \
  -e MONGODB_HOST=localhost \
  -e MONGODB_DATABASE=test \
  node:18-alpine \
  node -e "require('./tracing'); console.log('tracing.js loaded OK');"
```

**Expected:**
```text
tracing.js loaded OK
```

> The backend will not fully start without MongoDB — but the tracing
> module loading independently confirms all OTel imports resolve correctly.

### Step 4: Update `backend/Dockerfile`

```dockerfile
# ── Stage 1: install production dependencies ─────────────────────────────
FROM node:18-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: production image ────────────────────────────────────────────
FROM node:18-alpine
WORKDIR /app

# Non-root user: security best practice — no root process in container
RUN addgroup -g 1001 nodejs && adduser -D -u 1001 -G nodejs nodejs

RUN mkdir -p logs && chown nodejs:nodejs logs

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

USER nodejs
EXPOSE 80

CMD ["node", "app.js"]
```

### Step 5: Update `frontend/nginx.conf`

```nginx
server {
    listen 3000;

    # Serve React build — static files from /usr/share/nginx/html
    location / {
        root   /usr/share/nginx/html;
        index  index.html;
        try_files $uri $uri/ /index.html;
        # try_files: tries exact file, then directory index, then falls back
        # to index.html — required for React Router client-side routing
    }

    # Proxy API calls to backend
    # /goals and /goals/* are proxied — browser uses relative URL /goals
    location /goals {
        proxy_pass http://${BACKEND_HOST}:80;
        # ${BACKEND_HOST} is substituted by envsubst at container start.
        # Uses system /etc/resolv.conf — works in both Docker and K8s.
        # No resolver directive needed — nginx uses pod DNS automatically.

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }

    # nginx stub_status — built-in metrics endpoint
    # Exposes: active connections, reading/writing/waiting, total requests
    # Scraped by nginx-prometheus-exporter sidecar or Prometheus directly
    location /nginx_status {
        stub_status on;
        access_log  off;          # do not log health scrapes
        allow       127.0.0.1;   # allow from localhost (sidecar scraper)
        allow       10.0.0.0/8;  # allow from cluster CIDR (Prometheus)
        deny        all;          # deny everything else
    }

    # Health endpoint for liveness/readiness probes
    # Returns 200 immediately — nginx is alive and serving
    location /health {
        access_log off;
        return 200 '{"status":"ok"}';
        add_header Content-Type application/json;
    }
}
```

### Step 6: Build and Push v2.0.0 Images

```bash
cd projects/01-goals-app-production/src

# Build backend
docker build --no-cache -t rselvantech/goals-backend:v2.0.0 ./backend
docker push rselvantech/goals-backend:v2.0.0

# Build frontend
docker build --no-cache -t rselvantech/goals-frontend:v2.0.0 ./frontend
docker push rselvantech/goals-frontend:v2.0.0
```

**Verify images exist:**
```bash
docker pull rselvantech/goals-backend:v2.0.0
docker pull rselvantech/goals-frontend:v2.0.0
```

**Expected:** Both pull successfully.

---

## Part 2 — Install Traefik

### Step 7: Add Traefik Helm Repository

```bash
helm repo add traefik https://traefik.github.io/charts
helm repo update

# Verify available version
helm search repo traefik/traefik --versions | head -5
```

**Expected — latest stable v39.x:**
```text
NAME             CHART VERSION   APP VERSION   DESCRIPTION
traefik/traefik  39.x.x          v3.6.x        A Traefik based Kubernetes ...
```

### Step 8: Create Traefik Helm Values

**Create `manifests/01-traefik/helm/values.yaml`:**

```yaml
# Traefik v3 Helm values for minikube NodePort deployment
# Chart version: 39.x (Traefik proxy v3.6.x)

# ── Deployment ────────────────────────────────────────────────────────────
deployment:
  replicas: 1          # single replica sufficient for minikube
                       # production: 2+ with PodDisruptionBudget

# ── EntryPoints ───────────────────────────────────────────────────────────
# EntryPoints are Traefik's network listeners.
# Each defines a port and protocol.
ports:
  web:
    port: 8000          # Traefik listens on 8000 internally
    expose:
      default: true
    exposedPort: 80     # NodePort service maps :80 externally
    nodePort: 30080     # fixed NodePort — access via $(minikube ip):30080
                        # production: type LoadBalancer — cloud provides IP
  traefik:              # Traefik dashboard port
    port: 9000
    expose:
      default: true
    nodePort: 30900     # dashboard at $(minikube ip):30900

# ── Service ───────────────────────────────────────────────────────────────
service:
  type: NodePort        # minikube: NodePort + /etc/hosts entry
                        # production: LoadBalancer (cloud provisioned)

# ── Providers ─────────────────────────────────────────────────────────────
# Traefik reads routing configuration from two providers:
#   kubernetesIngress: watches standard Ingress objects
#   kubernetesCRD:     watches IngressRoute, Middleware, etc. (enabled by default)
providers:
  kubernetesIngress:
    enabled: true
  kubernetesCRD:
    enabled: true       # enables IngressRoute, Middleware CRDs

# ── Dashboard ─────────────────────────────────────────────────────────────
ingressRoute:
  dashboard:
    enabled: true
    matchRule: Host(`traefik.local`)   # dashboard at http://traefik.local:30080
    entryPoints:
      - web

# ── Logging ───────────────────────────────────────────────────────────────
logs:
  general:
    level: INFO          # DEBUG for troubleshooting, INFO for normal ops
  access:
    enabled: true        # log every proxied request
    format: json         # structured JSON — compatible with Loki

# ── Resources ─────────────────────────────────────────────────────────────
resources:
  requests:
    cpu:    100m
    memory: 128Mi
  limits:
    cpu:    300m
    memory: 256Mi
```

### Step 9: Install Traefik

```bash
kubectl create namespace traefik

helm install traefik traefik/traefik \
  --namespace traefik \
  --version 39.0.4 \
  -f manifests/01-traefik/helm/values.yaml
```

**Verify Traefik is running:**
```bash
kubectl get pods -n traefik
```

**Expected:**
```text
NAME                       READY   STATUS    RESTARTS   AGE
traefik-xxxxxxxxxx-xxxxx   1/1     Running   0          30s
```

**Verify NodePort is assigned:**
```bash
kubectl get svc -n traefik
```

**Expected:**
```text
NAME      TYPE       CLUSTER-IP     EXTERNAL-IP  PORT(S)                      AGE
traefik   NodePort   10.96.x.x      <none>       80:30080/TCP,9000:30900/TCP  30s
```

**Verify Traefik Dashboard from Windows browser:**

Because the `--ports` mapping was set at cluster creation, no port-forward
is needed. Open directly in Windows browser:

```
http://traefik.local:8080/dashboard/
```

> **Why port 8080 not 30080?**
> `--ports=127.0.0.1:8080:30080` maps Windows/WSL localhost:8080 → NodePort 30080.
> The browser accesses `goals.local:8080` → Windows routes to `127.0.0.1:8080`
> → port mapping → minikube NodePort 30080 → Traefik web entrypoint.

***Expected — Traefik dashboard loads with:**
- HTTP Routers section (empty until IngressRoutes are applied)
- HTTP Services section
- Middlewares section
- Version shown in top right: `v3.x.x`

> **Note the trailing slash** — `http://traefik.local:8080/dashboard/`
> (with slash) is required. Without it, Traefik redirects to
> `/dashboard/` which may not work correctly in all browsers.

**Access Summary — All Environments:**

| Environment | Access method | Browser URL |
|---|---|---|
| **WSL2 + `--ports` mapping** | Direct (no port-forward) | `http://goals.local:8080` |
| **Native Linux** | NodePort directly | `http://$(minikube ip):30080` |
| **EKS production** | LoadBalancer + DNS | `https://goals.yourdomain.com` |

---

## Part 3 — Deploy the Application

### Step 10: Create All Manifest Files

```bash
cd projects/01-goals-app-production/src

mkdir -p manifests/{00-namespace,01-traefik,02-mongodb,03-backend,04-frontend,05-config}

touch manifests/00-namespace/namespace.yaml
touch manifests/00-namespace/resourcequota.yaml
touch manifests/00-namespace/limitrange.yaml
touch manifests/05-config/configmap.yaml
touch manifests/02-mongodb/service-headless.yaml
touch manifests/02-mongodb/service.yaml
touch manifests/02-mongodb/statefulset.yaml
touch manifests/02-mongodb/pdb.yaml
touch manifests/02-mongodb/networkpolicy.yaml
touch manifests/03-backend/deployment.yaml
touch manifests/03-backend/service.yaml
touch manifests/03-backend/pdb.yaml
touch manifests/03-backend/networkpolicy.yaml
touch manifests/04-frontend/deployment.yaml
touch manifests/04-frontend/service.yaml
touch manifests/04-frontend/pdb.yaml
touch manifests/04-frontend/networkpolicy.yaml
touch manifests/01-traefik/middleware.yaml
touch manifests/01-traefik/ingressroute.yaml
```

### Step 11: Namespace and Governance

**`manifests/00-namespace/namespace.yaml`:**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: goals-production
  labels:
    # Label used by NetworkPolicy to allow Traefik namespace ingress
    # NetworkPolicy selects namespaces by label, not by name
    kubernetes.io/metadata.name: goals-production
```

**`manifests/00-namespace/resourcequota.yaml`:**
```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: goals-production-quota
  namespace: goals-production
spec:
  hard:
    # Pod count ceiling — prevents runaway deployments
    pods:              "15"
    # CPU: sum of all container requests must not exceed this
    requests.cpu:      "2"
    # Memory: sum of all container requests must not exceed this
    requests.memory:   "4Gi"
    # CPU: sum of all container limits must not exceed this
    limits.cpu:        "4"
    # Memory: sum of all container limits must not exceed this
    limits.memory:     "8Gi"
    # PVC count — prevents accidental PVC proliferation
    persistentvolumeclaims: "5"
```

**`manifests/00-namespace/limitrange.yaml`:**
```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: goals-production-limits
  namespace: goals-production
spec:
  limits:
    - type: Container
      # default: applied to containers with no limits specified
      default:
        cpu:    "200m"
        memory: "256Mi"
      # defaultRequest: applied to containers with no requests specified
      defaultRequest:
        cpu:    "100m"
        memory: "128Mi"
      # max: no single container can exceed these
      max:
        cpu:    "1"
        memory: "2Gi"
      # min: no single container can go below these
      min:
        cpu:    "10m"
        memory: "16Mi"
```

**Apply namespace and governance:**
```bash
kubectl apply -f manifests/00-namespace/namespace.yaml
kubectl apply -f manifests/00-namespace/resourcequota.yaml
kubectl apply -f manifests/00-namespace/limitrange.yaml
```

**Verify:**
```bash
kubectl get namespace goals-production
kubectl describe resourcequota -n goals-production
kubectl describe limitrange -n goals-production
```

**Expected:**
```text
NAME               STATUS   AGE
goals-production   Active   5s

Name: goals-production-quota
Resource                    Used   Hard
--------                    ----   ----
limits.cpu                  0      4
limits.memory               0      8Gi
persistentvolumeclaims      0      5
pods                        0      15
requests.cpu                0      2
requests.memory             0      4Gi

Name: goals-production-limits
Type        Resource  Min   Max   Default Request  Default Limit
----        --------  ---   ---   ---------------  -------------
Container   cpu       10m   1     100m             200m
Container   memory    16Mi  2Gi   128Mi            256Mi
```

### Step 12: ConfigMap

**`manifests/05-config/configmap.yaml`:**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: goals-app-config
  namespace: goals-production
data:
  # MongoDB Service name — matches mongodb-service.yaml metadata.name
  # Used by: backend (connection string host), init container (readiness check)
  MONGODB_HOST:     "mongodb"

  # MongoDB database name — must match what app.js uses
  MONGODB_DATABASE: "course-goals"

  # Backend Service name — used by nginx frontend proxy_pass
  # Must match backend-service.yaml metadata.name
  BACKEND_HOST:     "goals-backend-svc"
```

**Apply:**
```bash
kubectl apply -f manifests/05-config/configmap.yaml
```

### Step 13: Sealed MongoDB Secret

```bash
# Create the secret locally and seal it
kubectl create secret generic mongodb-secret \
  --namespace goals-production \
  --from-literal=MONGODB_USERNAME=rselvantech \
  --from-literal=MONGODB_PASSWORD=passWD \
  --from-literal=MONGO_INITDB_ROOT_USERNAME=rselvantech \
  --from-literal=MONGO_INITDB_ROOT_PASSWORD=passWD \
  --dry-run=client \
  --output yaml \
  | kubeseal \
    --controller-name=sealed-secrets \
    --controller-namespace=kube-system \
    --format yaml \
  > manifests/05-config/sealed-mongodb-secret.yaml
```

**Verify the sealed file contains encrypted values:**
```bash
grep -A 5 encryptedData manifests/05-config/sealed-mongodb-secret.yaml
```

**Expected — encrypted ciphertext, not plaintext:**
```text
  encryptedData:
    MONGO_INITDB_ROOT_PASSWORD: AgBy3i4OJSWK...
    MONGO_INITDB_ROOT_USERNAME: AgBy3i4OJSWK...
    MONGODB_PASSWORD: AgBy3i4OJSWK...
    MONGODB_USERNAME: AgBy3i4OJSWK...
```

**Apply the SealedSecret:**
```bash
kubectl apply -f manifests/05-config/sealed-mongodb-secret.yaml
```

**Verify the controller decrypted it:**
```bash
kubectl get sealedsecret mongodb-secret -n goals-production -w
# Wait until the controller creates the native Secret(i.e) Synced=True
```

**Expected:**
```text
NAME             STATUS   SYNCED   AGE
mongodb-secret            True     61s
```

```bash
kubectl get secret mongodb-secret -n goals-production
```

**Expected:**
```text
NAME             TYPE     DATA   AGE
mongodb-secret   Opaque   4      10s
```

### Step 14: MongoDB StatefulSet

**`manifests/02-mongodb/service-headless.yaml`:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: mongodb-headless
  namespace: goals-production
spec:
  # clusterIP: None creates a headless Service.
  # Instead of a stable VIP, DNS returns individual pod IPs directly.
  # mongodb-0.mongodb-headless.goals-production.svc.cluster.local
  #   → resolves to mongodb-0 pod IP
  # Required by: init containers (direct pod readiness check)
  #              StatefulSet (stable pod DNS identity)
  clusterIP: None
  selector:
    app: mongodb
  ports:
    - port: 27017
      targetPort: 27017
```

**`manifests/02-mongodb/service.yaml`:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: mongodb
  namespace: goals-production
spec:
  # Regular ClusterIP Service for application connections.
  # Provides a stable VIP that survives pod restarts.
  # backend connects to: mongodb:27017 (resolves to this ClusterIP)
  selector:
    app: mongodb
  ports:
    - port: 27017
      targetPort: 27017
```

**`manifests/02-mongodb/statefulset.yaml`:**
```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mongodb
  namespace: goals-production
spec:
  serviceName: mongodb-headless    # must match headless Service name
                                   # used for pod DNS: mongodb-0.mongodb-headless
  replicas: 1                      # single instance — no replica set complexity
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      # terminationGracePeriodSeconds: time Kubernetes waits for graceful
      # shutdown before SIGKILL. MongoDB needs time to flush journal.
      terminationGracePeriodSeconds: 60

      # ── Init containers ─────────────────────────────────────────────
      # Init containers run to completion before any regular container starts.
      # This init container tunes the Linux kernel for MongoDB performance.
      initContainers:
        - name: init-mongodb-sysctl
          image: busybox:1.36
          # vm.max_map_count: MongoDB requires at least 262144 for mmapv1
          # and WiredTiger. Default Linux value is 65536 — too low.
          # Must be set in the host kernel (requires privileged access).
          command:
            - sh
            - -c
            - |
              echo "Setting vm.max_map_count for MongoDB..."
              sysctl -w vm.max_map_count=262144
              echo "Done."
          securityContext:
            privileged: true       # required for sysctl
            runAsUser: 0

      containers:
        - name: mongodb
          image: mongo:6.0
          ports:
            - containerPort: 27017

          env:
            - name: MONGO_INITDB_ROOT_USERNAME
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGO_INITDB_ROOT_USERNAME
            - name: MONGO_INITDB_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGO_INITDB_ROOT_PASSWORD

          # ── Liveness probe ───────────────────────────────────────────
          # tcpSocket: checks if mongod is listening on :27017.
          # Fast, no auth required. Restarts pod if mongod stops listening.
          # Does NOT validate authenticated query capability — that is readiness.
          livenessProbe:
            tcpSocket:
              port: 27017
            initialDelaySeconds: 30   # MongoDB takes time to start
            periodSeconds:       10
            failureThreshold:    3
            timeoutSeconds:      5

          # ── Readiness probe ──────────────────────────────────────────
          # exec mongosh ping: validates MongoDB accepts authenticated queries.
          # Pod not Ready until this passes — init container in backend will
          # wait for this before starting the Node.js process.
          readinessProbe:
            exec:
              command:
                - mongosh
                - --eval
                - "db.adminCommand('ping')"
                - --username
                - $(MONGO_INITDB_ROOT_USERNAME)
                - --password
                - $(MONGO_INITDB_ROOT_PASSWORD)
                - --authenticationDatabase
                - admin
                - --quiet
            initialDelaySeconds: 30
            periodSeconds:       10
            failureThreshold:    3
            timeoutSeconds:      10   # mongosh can be slow on first run

          volumeMounts:
            - name: mongodb-data
              mountPath: /data/db

          resources:
            requests:
              cpu:    "250m"
              memory: "512Mi"
            limits:
              cpu:    "500m"
              memory: "1Gi"

  # ── volumeClaimTemplate ───────────────────────────────────────────────
  # StatefulSet creates a PVC per pod, named: data-mongodb-0
  # PVC persists across pod deletion and is reattached on pod recreation.
  # Unlike a standalone PVC, StatefulSet manages the PVC lifecycle.
  volumeClaimTemplates:
    - metadata:
        name: mongodb-data
      spec:
        accessModes:
          - ReadWriteOnce           # single node read/write — correct for MongoDB
        storageClassName: standard # ← add this explicitly
        resources:
          requests:
            storage: 2Gi
```

**`manifests/02-mongodb/pdb.yaml`:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: mongodb-pdb
  namespace: goals-production
spec:
  # maxUnavailable: 0 — MongoDB must NEVER be voluntarily disrupted.
  # This prevents: node drains, cluster upgrades, kubectl drain
  # from evicting the MongoDB pod.
  # If MongoDB must be taken down, it requires manual intervention.
  # Production: use a MongoDB replica set — then maxUnavailable: 1 is safe.
  maxUnavailable: 0
  selector:
    matchLabels:
      app: mongodb
```

**`manifests/02-mongodb/networkpolicy.yaml`:**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: mongodb-network-policy
  namespace: goals-production
spec:
  podSelector:
    matchLabels:
      app: mongodb
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow ONLY backend pods in goals-production namespace → port 27017
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: goals-production
          podSelector:
            matchLabels:
              app: goals-backend
      ports:
        - port: 27017
  egress: []
  # MongoDB has no outbound connections — deny all egress
```

**Apply MongoDB:**
```bash
kubectl apply -f manifests/02-mongodb/
```

**Watch MongoDB start:**
```bash
kubectl get pods -n goals-production -w
```

**Expected — StatefulSet creates mongodb-0 (not a random name):**
```text
NAME        READY   STATUS    RESTARTS   AGE
mongodb-0   0/1     Pending   0          0s
mongodb-0   0/1     Init:0/1  0          2s
mongodb-0   0/1     PodInitializing 0    5s
mongodb-0   0/1     Running   0          10s
mongodb-0   1/1     Running   0          45s   ← readiness passed
```

**Verify readiness via containerStatus:**
```bash
kubectl get pod mongodb-0 -n goals-production \
  -o jsonpath='{.status.containerStatuses[0]}' \
  | python3 -m json.tool
```

**Expected:**
```json
{
    "image": "mongo:6.0",
    "name": "mongodb",
    "ready": true,            <-------- shoud be true
    "restartCount": 0,
    "started": true,
    "state": {
        "running": {
            "startedAt": "2026-04-13T10:00:45Z"
        }
    }
}
```

**Verify PVC was created by StatefulSet:**
```bash
kubectl get pvc -n goals-production
```

**Expected — named `mongodb-data-mongodb-0` (StatefulSet convention):**
```text
NAME                    STATUS   VOLUME         CAPACITY   STORAGECLASS
mongodb-data-mongodb-0  Bound    pvc-xxxxxxxx   2Gi        standard
```

### Step 15: Backend Deployment

**`manifests/03-backend/deployment.yaml`:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: goals-backend
  namespace: goals-production
spec:
  replicas: 2          # 2 replicas for HA — backend is stateless
  selector:
    matchLabels:
      app: goals-backend
  template:
    metadata:
      labels:
        app: goals-backend
    spec:
      terminationGracePeriodSeconds: 30   # matches SIGTERM handler in app.js

      # ── Init container ───────────────────────────────────────────────
      # Runs before Node.js starts. Polls MongoDB headless DNS until
      # mongosh ping returns exit 0 (MongoDB accepting authenticated queries).
      # Node.js NEVER starts until MongoDB is confirmed ready.
      # This eliminates the startup race condition entirely.
      initContainers:
        - name: wait-for-mongodb
          image: mongo:6.0
          command:
            - sh
            - -c
            - |
              echo "Waiting for MongoDB to be ready..."
              until mongosh \
                --host mongodb-0.mongodb-headless.goals-production.svc.cluster.local \
                --username "$MONGODB_USERNAME" \
                --password "$MONGODB_PASSWORD" \
                --authenticationDatabase admin \
                --eval "db.adminCommand('ping')" \
                --quiet > /dev/null 2>&1; do
                echo "MongoDB not ready, retrying in 5s..."
                sleep 5
              done
              echo "MongoDB is ready. Starting backend."
          env:
            - name: MONGODB_USERNAME
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGODB_USERNAME
            - name: MONGODB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGODB_PASSWORD

      containers:
        - name: goals-backend
          image: rselvantech/goals-backend:v2.0.0
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 80
            - name: metrics
              containerPort: 80   # metrics served on same port, /metrics path

          env:
            - name: MONGODB_USERNAME
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGODB_USERNAME
            - name: MONGODB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: MONGODB_PASSWORD
            # ConfigMap values — not sensitive, plain env vars
            - name: MONGODB_HOST
              valueFrom:
                configMapKeyRef:
                  name: goals-app-config
                  key: MONGODB_HOST
            - name: MONGODB_DATABASE
              valueFrom:
                configMapKeyRef:
                  name: goals-app-config
                  key: MONGODB_DATABASE

          # ── Liveness probe ─────────────────────────────────────────
          # GET /health — returns 200 if Node.js process is alive.
          # Does NOT check MongoDB. A DB outage should not restart the pod
          # (restarting will not fix MongoDB).
          # failureThreshold 3 × periodSeconds 10 = 30s before restart
          livenessProbe:
            httpGet:
              path: /health
              port: 80
            initialDelaySeconds: 15   # wait for Node.js to start + OTel init
            periodSeconds:       10
            failureThreshold:    3
            timeoutSeconds:      5

          # ── Readiness probe ────────────────────────────────────────
          # GET /ready — returns 200 only if Node.js AND MongoDB are connected.
          # Returns 503 if MongoDB disconnected → pod removed from endpoints.
          # Traffic stops flowing to this pod until MongoDB reconnects.
          readinessProbe:
            httpGet:
              path: /ready
              port: 80
            initialDelaySeconds: 15
            periodSeconds:       10
            failureThreshold:    3
            timeoutSeconds:      5

          resources:
            requests:
              cpu:    "100m"
              memory: "128Mi"
            limits:
              cpu:    "300m"
              memory: "256Mi"
```

**`manifests/03-backend/service.yaml`:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: goals-backend-svc
  namespace: goals-production
spec:
  selector:
    app: goals-backend
  ports:
    - name: http
      port: 80
      targetPort: 80
```

**`manifests/03-backend/pdb.yaml`:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: backend-pdb
  namespace: goals-production
spec:
  # minAvailable: 1 — at least 1 backend pod must be available during
  # voluntary disruptions (node drain, cluster upgrade).
  # With replicas: 2, this allows draining one node at a time.
  minAvailable: 1
  selector:
    matchLabels:
      app: goals-backend
```

**`manifests/03-backend/networkpolicy.yaml`:**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-network-policy
  namespace: goals-production
spec:
  podSelector:
    matchLabels:
      app: goals-backend
  policyTypes:
    - Ingress
    - Egress

  ingress:
    # Allow: frontend pods → backend port 80 (API calls via nginx proxy)
    - from:
        - podSelector:
            matchLabels:
              app: goals-frontend
      ports:
        - port: 80

  egress:
    # Allow: backend → mongodb port 27017 (database queries)
    - to:
        - podSelector:
            matchLabels:
              app: mongodb
      ports:
        - port: 27017
    # Allow: backend → kube-dns port 53 (DNS resolution)
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
```

**Apply backend:**
```bash
kubectl apply -f manifests/03-backend/
```

**Watch backend start — init container first:**
```bash
kubectl get pods -n goals-production -w
```

**Expected — init container runs first:**
```text
NAME                             READY   STATUS      RESTARTS   AGE
goals-backend-xxxxxxxxx-aaaaa   0/1     Init:0/1    0          2s
goals-backend-xxxxxxxxx-bbbbb   0/1     Init:0/1    0          2s
goals-backend-xxxxxxxxx-aaaaa   0/1     PodInitializing 0      15s
goals-backend-xxxxxxxxx-aaaaa   0/1     Running     0          16s
goals-backend-xxxxxxxxx-aaaaa   1/1     Running     0          31s   ← ready
goals-backend-xxxxxxxxx-bbbbb   0/1     PodInitializing 0      17s
goals-backend-xxxxxxxxx-bbbbb   1/1     Running     0          32s   ← ready
```

**Verify init container logs:**
```bash
kubectl logs -l app=goals-backend -n goals-production -c wait-for-mongodb
```

**Expected:**
```text
Waiting for MongoDB to be ready...
MongoDB is ready. Starting backend.
```


### Step 16: Frontend Deployment

**`manifests/04-frontend/deployment.yaml`:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: goals-frontend
  namespace: goals-production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: goals-frontend
  template:
    metadata:
      labels:
        app: goals-frontend
    spec:
      terminationGracePeriodSeconds: 10   # nginx drains quickly

      containers:
        - name: goals-frontend
          image: rselvantech/goals-frontend:v2.0.0
          imagePullPolicy: Always
          ports:
            - containerPort: 3000

          env:
            - name: BACKEND_HOST
              valueFrom:
                configMapKeyRef:
                  name: goals-app-config
                  key: BACKEND_HOST

          # ── Liveness probe ────────────────────────────────────────
          # GET /health — nginx returns 200 immediately if serving.
          # Restarts if nginx stops responding entirely.
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds:       10
            failureThreshold:    3
            timeoutSeconds:      5

          # ── Readiness probe ───────────────────────────────────────
          # GET /health — same endpoint.
          # Pod removed from Service if nginx stops serving.
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds:       10
            failureThreshold:    3
            timeoutSeconds:      5

          resources:
            requests:
              cpu:    "50m"
              memory: "64Mi"
            limits:
              cpu:    "100m"
              memory: "128Mi"
```

**`manifests/04-frontend/service.yaml`:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: goals-frontend-svc
  namespace: goals-production
spec:
  selector:
    app: goals-frontend
  ports:
    - port: 3000
      targetPort: 3000
```

**`manifests/04-frontend/pdb.yaml`:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: frontend-pdb
  namespace: goals-production
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: goals-frontend
```

**`manifests/04-frontend/networkpolicy.yaml`:**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-network-policy
  namespace: goals-production
spec:
  podSelector:
    matchLabels:
      app: goals-frontend
  policyTypes:
    - Ingress
    - Egress

  ingress:
    # Allow: Traefik namespace → frontend port 3000
    # Traefik pods are in the traefik namespace — selected by namespaceSelector
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: traefik
      ports:
        - port: 3000

  egress:
    # Allow: frontend → backend port 80 (nginx proxy_pass for /goals)
    - to:
        - podSelector:
            matchLabels:
              app: goals-backend
      ports:
        - port: 80
    # Allow: frontend → kube-dns port 53
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
```

**Apply frontend:**
```bash
kubectl apply -f manifests/04-frontend/
```

**Watch frontend start:**
```bash
kubectl get pods -n goals-production -w
```

**Expected:**
```text
NAME                              READY   STATUS    RESTARTS   AGE
goals-frontend-xxxxxxxxx-ccccc    0/1     Running   0          5s
goals-frontend-xxxxxxxxx-dddddd   0/1     Running   0          5s
goals-frontend-xxxxxxxxx-ccccc    1/1     Running   0          15s
goals-frontend-xxxxxxxxx-dddddd   1/1     Running   0          15s
```

### Step 17: Traefik IngressRoute and Middleware

**`manifests/01-traefik/middleware.yaml`:**
```yaml
# RateLimit middleware — limits requests per IP per second
# Protects backend from traffic spikes and simple DDoS
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: rate-limit
  namespace: goals-production
spec:
  rateLimit:
    average: 100     # average req/s per source IP
    burst:   50      # burst allowance above average

---
# SecurityHeaders middleware — adds security HTTP headers to all responses
# Prevents common web vulnerabilities: clickjacking, MIME sniffing, XSS
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: security-headers
  namespace: goals-production
spec:
  headers:
    frameDeny:            true   # X-Frame-Options: DENY — prevent clickjacking
    contentTypeNosniff:   true   # X-Content-Type-Options: nosniff — MIME sniffing
    browserXssFilter:     true   # X-XSS-Protection: 1; mode=block
    forceSTSHeader:       true   # Strict-Transport-Security (for HTTPS)
    stsSeconds:           15552000
    stsIncludeSubdomains: true
```

**`manifests/01-traefik/ingressroute.yaml`:**
```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: goals-frontend-route
  namespace: goals-production
spec:
  # entryPoints: which Traefik listeners handle this route
  # "web" is the HTTP listener (port 80/NodePort 30080)
  entryPoints:
    - web

  routes:
    - match: Host(`goals.local`)   # matches Host header: goals.local
      kind: Rule
      middlewares:
        - name: rate-limit         # apply rate limiting
          namespace: goals-production
        - name: security-headers   # apply security headers
          namespace: goals-production
      services:
        - name: goals-frontend-svc
          port: 3000
          # weight: 1 — single service. Multiple services enable canary deployments.
```

**Apply — only manifests, not helm/values.yaml:**
```bash
kubectl apply -f manifests/01-traefik/ingressroute.yaml
kubectl apply -f manifests/01-traefik/middleware.yaml
```

**Verify:**
```bash
kubectl get ingressroute -n goals-production
kubectl get middleware -n goals-production
```

**Expected:**
```text
NAME                    AGE
goals-frontend-route    5s

NAME               AGE
rate-limit         5s
security-headers   5s
```

---

## Part 4 — Verify Final State

### Step 18: Verify All Pods Running

```bash
kubectl get pods -n goals-production
```

**Expected — all pods Running and Ready:**
```text
NAME                              READY   STATUS    RESTARTS   AGE
goals-backend-xxxxxxxxx-aaaaa    1/1     Running   0          3m
goals-backend-xxxxxxxxx-bbbbb    1/1     Running   0          3m
goals-frontend-xxxxxxxxx-ccccc   1/1     Running   0          2m
goals-frontend-xxxxxxxxx-dddddd  1/1     Running   0          2m
mongodb-0                         1/1     Running   0          5m
```

### Step 19: Verify All Services and PVC

```bash
kubectl get svc,pvc -n goals-production
```

**Expected:**
```text
NAME                           TYPE        CLUSTER-IP    PORT(S)
service/goals-backend-svc      ClusterIP   10.96.x.x     80/TCP
service/goals-frontend-svc     ClusterIP   10.96.x.x     3000/TCP
service/mongodb                ClusterIP   10.96.x.x     27017/TCP
service/mongodb-headless       ClusterIP   None          27017/TCP

NAME                                   STATUS   CAPACITY   STORAGECLASS
persistentvolumeclaim/mongodb-data-mongodb-0   Bound    2Gi        standard
```

### Step 20: Verify Probes, Endpoints and Readiness  for Each Tier

#### MongoDB

```bash
kubectl describe pod mongodb-0 -n goals-production \
  | grep -A 8 "Liveness\|Readiness"
```

**Expected:**
```text
Liveness:   tcp-socket :27017 delay=30s timeout=5s period=10s #success=1 #failure=3
Readiness:  exec [mongosh --eval db.adminCommand('ping') ...] delay=30s timeout=10s period=10s #success=1 #failure=3
```

**Verify readiness has passed (mongodb-0 must be 1/1 Ready):**
```bash
kubectl get pod mongodb-0 -n goals-production \
  -o jsonpath='{.status.containerStatuses[0].ready}'
```

**Expected:**
```text
true
```

---

#### Backend

**Verify both pods are ready:**
```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-backend -o name); do
  READY=$(kubectl get $pod -n goals-production \
    -o jsonpath='{.status.containerStatuses[0].ready}')
  echo "$pod → ready=$READY"
done
```

**Expected:**
```text
pod/goals-backend-xxxxxxxxx-aaaaa → ready=true
pod/goals-backend-xxxxxxxxx-bbbbb → ready=true
```

**Verify liveness endpoint on each pod:**
```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-backend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- wget -qO- http://localhost:80/health
done
```

**Expected — both pods return 200:**
```json
{"status":"ok","uptime_s":120,"timestamp":"2026-04-18T10:01:30.000Z"}
{"status":"ok","uptime_s":119,"timestamp":"2026-04-18T10:01:30.000Z"}
```

**Verify readiness endpoint on each pod:**
```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-backend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- wget -qO- http://localhost:80/ready
done
```

**Expected — both pods return 200 with MongoDB connected:**
```json
{"status":"ready","mongodb":"connected","timestamp":"2026-04-18T10:01:30.000Z"}
{"status":"ready","mongodb":"connected","timestamp":"2026-04-18T10:01:30.000Z"}
```

> **Why check both pods individually?**
> `kubectl exec deployment/goals-backend` picks one pod arbitrarily.
> With 2 replicas, checking both pods independently confirms both are
> healthy — not just the one kubectl happened to select.

---

#### Frontend

**Verify both pods are ready:**
```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-frontend -o name); do
  READY=$(kubectl get $pod -n goals-production \
    -o jsonpath='{.status.containerStatuses[0].ready}')
  echo "$pod → ready=$READY"
done
```

**Expected:**
```text
pod/goals-frontend-xxxxxxxxx-ccccc → ready=true
pod/goals-frontend-xxxxxxxxx-dddddd → ready=true
```

**Verify liveness/readiness endpoint on each pod:**
```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-frontend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- wget -qO- http://127.0.0.1:3000/health
done
```

**Expected — both pods return 200:**
```text
{"status":"ok"}
{"status":"ok"}
```

> **Frontend uses the same endpoint for both liveness and readiness.**
> nginx `/health` returns 200 immediately if the server is accepting
> connections — no backend dependency. If nginx stops responding entirely,
> both probes fail and the pod is restarted. The frontend has no concept
> of "ready but degraded" — it either serves files or it does not.

**Verify nginx is serving the React app:**
```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-frontend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- wget -qO- http://127.0.0.1:3000/ | head -3
done
```

**Expected — React app HTML from both pods:**
```text
=== pod/goals-frontend-xxxxxxxxx-ccccc ===
<!DOCTYPE html>
<html lang="en">
  <head>
=== pod/goals-frontend-xxxxxxxxx-dddddd ===
<!DOCTYPE html>
<html lang="en">
  <head>
```

**Verify nginx proxy config — `BACKEND_HOST` was substituted correctly:**
```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-frontend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- cat /etc/nginx/conf.d/default.conf | grep proxy_pass
done
```

**Expected — `goals-backend-svc` substituted from ConfigMap:**
```text
=== pod/goals-frontend-xxxxxxxxx-ccccc ===
        proxy_pass http://goals-backend-svc:80;
=== pod/goals-frontend-xxxxxxxxx-dddddd ===
        proxy_pass http://goals-backend-svc:80;
```


**Verify frontend can reach the backend (nginx proxy test):**
```bash
# This calls /goals through the nginx proxy from inside the frontend pod
# Tests the full nginx proxy_pass → backend chain without going through Traefik
kubectl exec -n goals-production \
  $(kubectl get pods -n goals-production -l app=goals-frontend -o name | head -1) \
  -- wget -qO- http://127.0.0.1:3000/goals
```

**Expected — empty goals list (no goals added yet at this point):**
```json
{"goals":[]}
```

> **This test proves nginx `proxy_pass` is working**, not that goals exist.
> The response `{"goals":[]}` confirms:
> - nginx received the request on port 3000
> - nginx resolved `goals-backend-svc` via CoreDNS
> - nginx forwarded the request to the backend via `proxy_pass`
> - the backend queried MongoDB and returned a valid response
> - the full frontend → backend → MongoDB chain is intact
>
> If this returns a connection error or 502 — nginx proxy config or
> NetworkPolicy is the problem, not pod startup.
> If this returns `{"goals":[...]}` — goals were already added before
> this step ran, which is also correct.

---

#### Probe Summary

```bash
# One command — all pods, all tiers, ready status
kubectl get pods -n goals-production \
  -o custom-columns=\
"NAME:.metadata.name,READY:.status.containerStatuses[0].ready,RESTARTS:.status.containerStatuses[0].restartCount"
```

**Expected — all ready=true, restarts=0:**
```text
NAME                              READY   RESTARTS
goals-backend-xxxxxxxxx-aaaaa    true    0
goals-backend-xxxxxxxxx-bbbbb    true    0
goals-frontend-xxxxxxxxx-ccccc   true    0
goals-frontend-xxxxxxxxx-dddddd  true    0
mongodb-0                         true    0
```

> **If any pod shows `RESTARTS > 0`:**
> The liveness probe has failed at least once. Check logs:
> ```bash
> kubectl logs <pod-name> -n goals-production --previous
> ```
> `--previous` shows logs from the last crashed container — useful when
> the current container has already restarted and its logs are fresh.


### Step 21: Verify Metrics Endpoint

**Check metrics endpoint in all the backend pods:**

```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-backend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- wget -qO- http://localhost:80/metrics \
 | grep -E "^(goals|http_requests|mongodb|nodejs_event)"
done
```

**Expected:**
```text
=== pod/goals-backend-8497b7f69b-brxz6 ===
Defaulted container "goals-backend" out of: goals-backend, wait-for-mongodb (init)
nodejs_eventloop_lag_seconds 0.002539775
nodejs_eventloop_lag_min_seconds 0.005353472
nodejs_eventloop_lag_max_seconds 0.199884799
nodejs_eventloop_lag_mean_seconds 0.010235693880295898
nodejs_eventloop_lag_stddev_seconds 0.001791204930984677
nodejs_eventloop_lag_p50_seconds 0.010174463
nodejs_eventloop_lag_p90_seconds 0.010313727
nodejs_eventloop_lag_p99_seconds 0.010895359
http_requests_total{method="GET",route="/health",status_code="200"} 334
http_requests_total{method="GET",route="/ready",status_code="200"} 332
http_requests_total{method="GET",route="/metrics",status_code="200"} 6
mongodb_connected 1
goals_total 0
goals_created_total 0
goals_deleted_total 0
=== pod/goals-backend-8497b7f69b-twbmz ===
Defaulted container "goals-backend" out of: goals-backend, wait-for-mongodb (init)
nodejs_eventloop_lag_seconds 0
nodejs_eventloop_lag_min_seconds 0.006762496
nodejs_eventloop_lag_max_seconds 0.106823679
nodejs_eventloop_lag_mean_seconds 0.010149915414143524
nodejs_eventloop_lag_stddev_seconds 0.0004508585142656619
nodejs_eventloop_lag_p50_seconds 0.010141695
nodejs_eventloop_lag_p90_seconds 0.010215423
nodejs_eventloop_lag_p99_seconds 0.010420223
http_requests_total{method="GET",route="/health",status_code="200"} 333
http_requests_total{method="GET",route="/ready",status_code="200"} 330
http_requests_total{method="GET",route="/goals",status_code="200"} 2
mongodb_connected 1
goals_total 0
goals_created_total 0
goals_deleted_total 0
```

**Goals App specific Metrics to:**
```
# HELP goals_total Current number of goals in the database
# TYPE goals_total gauge
goals_total 0

# HELP goals_created_total Total number of goals ever created
# TYPE goals_created_total counter
goals_created_total 0

# HELP goals_deleted_total Total number of goals ever deleted
# TYPE goals_deleted_total counter
goals_deleted_total 0

# HELP mongodb_connected MongoDB connection status
# TYPE mongodb_connected gauge
mongodb_connected 1

# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/health",status_code="200"} 3

# HELP nodejs_event_loop_lag_seconds Event loop lag
nodejs_event_loop_lag_seconds_p99 0.001234
```

**After GET /goals — verify metrics update:**
```bash
# Trigger GET /goals to exercise that endpoint (does not change gauge)
kubectl exec -n goals-production \
  $(kubectl get pod -n goals-production -l app=goals-backend -o name | head -1) \
  -- wget -qO- http://localhost:80/goals > /dev/null

# Check gauge still reflects DB state, Check in all the backend  pods
for pod in $(kubectl get pods -n goals-production -l app=goals-backend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- wget -qO- http://localhost:80/metrics \
 | grep -E "^goals"
done
```


**Check metrics endpoint in all the backend pods:**

Verify nginx stub_status on each pod:

```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-frontend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- wget -qO- http://127.0.0.1:3000/nginx_status
done
```

**Expected:**
```text
=== pod/goals-frontend-xxxxxxxxx-ccccc ===
Active connections: 1
server accepts handled requests
 42 42 55
Reading: 0 Writing: 1 Waiting: 0
=== pod/goals-frontend-xxxxxxxxx-dddddd ===
Active connections: 1
server accepts handled requests
 38 38 51
Reading: 0 Writing: 1 Waiting: 0
```

> **Why `127.0.0.1` not `localhost`?** The nginx.conf `allow 127.0.0.1`
> permits requests from the loopback interface. `wget` without an explicit
> IP resolves `localhost` via DNS which may return the pod's eth0 IP
> instead of the loopback — blocked by the `deny all` rule.
> Using `127.0.0.1` directly bypasses DNS and hits the loopback.


### Step 22: Verify Structured Logs

Application logs (morgan) are single-line JSON. OTel span output is
multi-line JavaScript object notation — they are mixed in stdout.
Filter by lines containing `"level"` to isolate morgan output.

```bash
kubectl logs -l app=goals-backend -n goals-production --tail=5 | grep '"level"'
```

**Expected — valid JSON on every line:**
```text
{"level":"info","msg":"GET /health 200","timestamp":"2026-04-18T20:54:06.852Z","method":"GET","url":"/health","status":200,"user_agent":"kube-probe/1.34"}
{"level":"info","msg":"GET /ready 200","timestamp":"2026-04-18T20:54:07.455Z","method":"GET","url":"/ready","status":200,"user_agent":"kube-probe/1.34"}
{"level":"info","msg":"GET /health 200","timestamp":"2026-04-18T20:54:16.852Z","method":"GET","url":"/health","status":200,"user_agent":"kube-probe/1.34"}
{"level":"info","msg":"GET /ready 200","timestamp":"2026-04-18T20:54:17.454Z","method":"GET","url":"/ready","status":200,"user_agent":"kube-probe/1.34"}
```

**Parse logs with jq to verify JSON structure:**

```bash
kubectl logs -l app=goals-backend -n goals-production --tail=5 \
  | grep '"level"' \
  | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        json.loads(line)
        print('OK:', line[:100])
    except:
        print('FAIL:', line[:100])
"
```

**Expected — all morgan lines valid JSON:**
```text
OK: {"level":"info","msg":"GET /health 200","timestamp":"2026-04-18T20:54:46.851Z","method":"GET","url":
OK: {"level":"info","msg":"GET /ready 200","timestamp":"2026-04-18T20:54:47.456Z","method":"GET","url":"
OK: {"level":"info","msg":"GET /health 200","timestamp":"2026-04-18T20:54:56.852Z","method":"GET","url":
OK: {"level":"info","msg":"GET /ready 200","timestamp":"2026-04-18T20:54:57.455Z","method":"GET","url":"
```

### Step 23: Verify OTel Traces

Only application requests (`/goals` POST, GET, DELETE) generate spans.


```bash
# Trigger a /goals request to generate a traceable span
kubectl exec -n goals-production \
  $(kubectl get pod -n goals-production -l app=goals-backend -o name | head -1) \
  -- wget -qO- http://localhost:80/goals > /dev/null

# Check trace output — probe endpoints filtered out
kubectl logs -l app=goals-backend -n goals-production --tail=50 \
  | grep -E "^\s+traceId:|^\s+name:|http\.target"
```

**Expected:**
```text
    name: '@opentelemetry/instrumentation-http',
  traceId: '1942b0e603f0b9a5a701549e7b056194',
  name: 'GET /goals',
    'http.target': '/goals',
```

**What this confirms:**
- `traceId` — a unique trace ID generated per request
- `name: 'GET /goals'` — the HTTP span with the correct route
- `http.target: '/goals'` — the exact path matched
- No `/health` or `/ready` spans — probe filter working correctly

> **OTel `ConsoleSpanExporter` output is not JSON** — it uses Node.js
> `util.inspect()` for human-readable output. When `OTLPTraceExporter`
> is configured later (one line change in `tracing.js`), spans are sent
> as binary OTLP to Jaeger or Tempo and no longer appear in stdout.


> **Trace correlation:** The `traceId` in the span matches across the
> HTTP span and the MongoDB span — both share the same trace. When Tempo
> is added later, these are visualised as a waterfall showing HTTP request
> → MongoDB query duration.


**About Spans Persistance:**
ConsoleSpanExporter writes spans to stdout — they appear in kubectl logs but only for as long as the log buffer retains them (Kubernetes keeps the last ~10MB of logs per container). They are not persisted anywhere.

This is fundamentally different from application logs:
```
Logs (morgan → stdout):
  Kubernetes captures → retained in container log buffer
  Fluent Bit ships to Loki → stored permanently → queryable anytime

OTel traces (ConsoleSpanExporter → stdout):
  Written to stdout → same container log buffer → lost on pod restart
  No persistence, no search, no timeline view
  Only useful for confirming instrumentation works during development

OTel traces (OTLPTraceExporter → Tempo):
  Sent over HTTP to OTel Collector → forwarded to Tempo
  Stored in object storage (S3/GCS) → queryable by traceId anytime
  Visualised as waterfall in Grafana → permanent trace history
```
The console exporter is a development/verification tool only. It proves the SDK is working. In production with Tempo, traces are stored and searchable just like logs in Loki.


### Step 25: Verify Traefik Routes

```bash
kubectl get ingressroute -n goals-production -o yaml | grep "match:"
```

**Expected:**
```text
match: Host(`goals.local`)
```

Open `http://traefik.local:8080/dashboard/` → HTTP → Routers.

You should see `goals-frontend-route` with:
- Rule: `Host(goals.local)`
- Middlewares: `rate-limit@kubernetescrd`, `security-headers@kubernetescrd`
- Status: Enabled ✅

### Step 26: End-to-End Browser Test

Open `http://goals.local:8080` in Windows browser.

**Test 1 — UI loads:**
Goals Tracker page appears with empty list. ✅

**Test 2 — Add a goal:**
Type `"Production Kubernetes test"` → Add Goal → appears. ✅

**Test 3 — Verify metrics updated after add:**
```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-backend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- wget -qO- http://localhost:80/metrics \
 | grep -E "^goals"
done
```

**Expected:**
```text
=== pod/goals-backend-8497b7f69b-brxz6 ===
Defaulted container "goals-backend" out of: goals-backend, wait-for-mongodb (init)
goals_total 1
goals_created_total 1
goals_deleted_total 0
=== pod/goals-backend-8497b7f69b-twbmz ===
Defaulted container "goals-backend" out of: goals-backend, wait-for-mongodb (init)
goals_total 2
goals_created_total 1
goals_deleted_total 0
```

**Test 4 — Verify in MongoDB:**
```bash
kubectl exec -n goals-production mongodb-0 \
  -- mongosh \
  --username rselvantech \
  --password passWD \
  --authenticationDatabase admin \
  course-goals \
  --eval "db.goals.find().pretty()" \
  --quiet
```

**Expected:**
```text
[{ _id: ObjectId('...'), text: 'Production Kubernetes test', __v: 0 }]
```

**Test 5 — Delete the goal, verify metrics:**
Click the goal in the browser → it disappears.

```bash
for pod in $(kubectl get pods -n goals-production -l app=goals-backend -o name); do
  echo "=== $pod ==="
  kubectl exec -n goals-production $pod \
    -- wget -qO- http://localhost:80/metrics \
 | grep -E "^goals"
done
```

**Expected — gauge decremented, both counters incremented:**
```text
=== pod/goals-backend-8497b7f69b-brxz6 ===
Defaulted container "goals-backend" out of: goals-backend, wait-for-mongodb (init)
goals_total 1
goals_created_total 1
goals_deleted_total 0
=== pod/goals-backend-8497b7f69b-twbmz ===
Defaulted container "goals-backend" out of: goals-backend, wait-for-mongodb (init)
goals_total 1
goals_created_total 1
goals_deleted_total 1
```

> **`goals_total` in a multi-replica deployment — verified behaviour:**
> Each pod updates `goals_total` only when it handles a write operation.
> After each POST or DELETE, the pod calls `countDocuments()` and sets
> its gauge to the actual database count. This means:
>
> - The pod that handled the write always shows the correct current count
> - The other pod shows the count from the last write it handled
> - Both converge to the correct value as load is distributed
>
> **Correct Prometheus queries:**
> ```
> max(goals_total)                          # current goal count
> sum(goals_created_total)                  # total ever created (all pods)
> sum(goals_deleted_total)                  # total ever deleted (all pods)
> sum(rate(goals_created_total[5m]))        # creation rate across all pods
> ```
>
> Never use `sum(goals_total)` — it double-counts since both pods hold
> the same database count when both have handled a recent write.

**Test 6 — Reload (persistence):**
After adding a new goal, refresh — still appears. ✅

### Step 27: Verify PodDisruptionBudgets

```bash
kubectl get pdb -n goals-production
```

**Expected:**
```text
NAME           MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS
backend-pdb    1               N/A               1
frontend-pdb   1               N/A               1
mongodb-pdb    N/A             0                 0
```

### Step 28: Verify ResourceQuota Usage

```bash
kubectl describe resourcequota goals-production-quota -n goals-production
```

**Expected — used values reflect running pods:**
```text
Resource              Used    Hard
--------              ----    ----
limits.cpu            1700m   4
limits.memory         1792Mi  8Gi
pods                  5       15
requests.cpu          600m    2
requests.memory       832Mi   4Gi
persistentvolumeclaims 1      5
```

### Step 29: Verify NetworkPolicy Enforcement (Calico)

**Verify Calico is enforcing policies:**
```bash
kubectl get pods -n kube-system | grep calico
```

**Expected — calico-node Running:**
```text
calico-node-xxxxx   1/1   Running   0   1h
```

**Test 1 — Verify frontend CANNOT reach MongoDB directly:**
```bash
kubectl exec -n goals-production \
  $(kubectl get pod -n goals-production -l app=goals-frontend -o name | head -1) \
  -- sh -c "wget -qO- --timeout=5 http://mongodb:27017 2>&1 || echo 'BLOCKED as expected'"
```

**Expected — connection blocked by Calico:**
```text
wget: can't connect to remote host (10.x.x.x): Connection timed out
BLOCKED as expected
```

**Test 2 — Verify backend CAN reach MongoDB:**
```bash
kubectl exec -n goals-production \
  $(kubectl get pod -n goals-production -l app=goals-backend -o name | head -1) \
  -- wget -qO- http://localhost:80/ready
```

**Expected:**
```json
{"status":"ready","mongodb":"connected"}
```

**Test 3 — Verify an external pod CANNOT reach MongoDB:**
```bash
# Create a test pod outside goals-production
kubectl run test-pod \
  --image=busybox:1.36 \
  --restart=Never \
  --rm \
  -it \
  -- sh -c "nc -zv mongodb.goals-production.svc.cluster.local 27017 || echo 'BLOCKED'"
```

**Expected:**
```text
nc: mongodb.goals-production.svc.cluster.local: Connection timed out
BLOCKED
```

> **If connections are NOT blocked after applying all NetworkPolicies:**
>
> **Step 1 — Verify Calico is running:**
> ```bash
> kubectl get pods -n kube-system | grep calico
> ```
> Both `calico-kube-controllers` and `calico-node` must be `1/1 Running`.
>
> **Step 2 — Apply the WSL2 RPF fix (WSL2 only):**
> ```bash
> kubectl -n kube-system set env daemonset/calico-node FELIX_IGNORELOOSERPF=true
> ```
>
> **What this fixes and why it is needed on WSL2:**
> RPF (Reverse Path Filtering) is a Linux kernel security feature that
> drops packets where the return route uses a different network interface
> than the incoming path. WSL2 uses a virtualised network stack that
> sets strict RPF (`rp_filter=1`) by default. Calico routes pod traffic
> via virtual `cali*` interfaces which creates asymmetric routing paths
> — strict RPF drops these packets before Calico's own iptables rules
> can evaluate them. The result: NetworkPolicy objects exist but nothing
> is blocked.
>
> `FELIX_IGNORELOOSERPF=true` tells Calico's Felix agent to skip the
> RPF check when writing iptables rules, allowing it to enforce
> NetworkPolicy correctly despite the asymmetric routing.
>
> **This setting is only needed on WSL2 with Docker driver.** On native
> Linux, VMs, and cloud providers (EKS, GKE, AKS), Calico's installer
> sets the correct `rp_filter` value automatically, or the CNI
> architecture (AWS VPC CNI) makes RPF irrelevant.
>
> **Step 3 — Ensure the MongoDB NetworkPolicy exists:**
> ```bash
> kubectl get networkpolicy -n goals-production
> ```
> **Expected — all four policies present:**
> ```text
> NAME                      POD-SELECTOR
> backend-network-policy    app=goals-backend
> frontend-network-policy   app=goals-frontend
> mongodb-network-policy    app=mongodb
> ```
> If `mongodb-network-policy` is missing, external pods can reach MongoDB
> even with Calico running — there is no policy to enforce. Apply it:
> ```bash
> kubectl apply -f manifests/02-mongodb/networkpolicy.yaml
> ```
>
> **Step 4 — Re-run the external pod test after applying both fixes:**
> ```bash
> kubectl run test-pod --image=busybox:1.36 --restart=Never --rm -it \
>   -- sh -c "nc -zv mongodb.goals-production.svc.cluster.local 27017 \
>             || echo 'BLOCKED'"
> ```
> **Expected:**
> ```text
> nc: Connection timed out
> BLOCKED
> ```

### Step 30: Simulate Readiness Probe Failure

```bash
# Terminal 1 — watch backend readiness
kubectl get pods -n goals-production -l app=goals-backend -w

# Terminal 2 — scale MongoDB to 0
kubectl scale statefulset mongodb --replicas=0 -n goals-production
```

**Expected in Terminal 1 (after ~30s):**
```text
goals-backend-xxxxxxxxx-aaaaa   1/1   Running   0   5m
goals-backend-xxxxxxxxx-bbbbb   1/1   Running   0   5m
goals-backend-xxxxxxxxx-aaaaa   0/1   Running   0   5m  ← readiness failed
goals-backend-xxxxxxxxx-bbbbb   0/1   Running   0   5m  ← readiness failed
```

**Verify endpoints removed from Service:**
```bash
kubectl get endpoints goals-backend-svc -n goals-production
```

**Expected:**
```text
NAME                ENDPOINTS   AGE
goals-backend-svc   <none>      10m
```

**Restore MongoDB:**
```bash
kubectl scale statefulset mongodb --replicas=1 -n goals-production
```

**Expected in Terminal 1 (after ~30s):**

**Expected:**
```text
NAME                             READY   STATUS    RESTARTS   AGE
goals-backend-8497b7f69b-brxz6   1/1     Running   0          7h12m
goals-backend-8497b7f69b-twbmz   1/1     Running   0          7h12m
goals-backend-8497b7f69b-twbmz   0/1     Running   0          7h13m
goals-backend-8497b7f69b-brxz6   0/1     Running   0          7h13m
goals-backend-8497b7f69b-twbmz   1/1     Running   0          7h14m ← readiness succeeds now
goals-backend-8497b7f69b-brxz6   1/1     Running   0          7h14m ← readiness succeeds now
```

---

## Scalability Design — Theory
This application is **designed for scalability** without implementing every
autoscaler. The design prerequisites are in place:

```
Implemented (prerequisites for all scalers):
  ✅ resource requests on every container  → HPA can calculate utilisation
  ✅ resource limits on every container    → VPA can right-size
  ✅ replicas: 2 on frontend and backend   → PDB meaningful, scale-in safe
  ✅ readiness probes on all tiers         → pods removed from LB before scale-in
  ✅ PodDisruptionBudget                   → safe voluntary disruptions
  ✅ stateless backend and frontend        → horizontal scale-out safe
  ✅ MongoDB PVC with StatefulSet          → storage survives scale events

Scalers — add when needed:

HPA — Horizontal Pod Autoscaler
  What: adds/removes replicas based on CPU, memory, or custom metrics
  When to add: backend or frontend receiving variable traffic
  Requires: metrics-server (minikube addon)
  Config: kubectl autoscale deployment goals-backend --cpu=70% --min=2 --max=10

VPA — Vertical Pod Autoscaler
  What: right-sizes requests/limits based on observed usage history
  When to add: right-size over-provisioned or under-provisioned containers
  Requires: VPA controller (separate install)
  Use VPA Off mode first: recommendations without actual changes

KEDA — Kubernetes Event-Driven Autoscaler
  What: scale based on external events (queue depth, HTTP rate, DB metrics)
  When to add: event-driven workloads, MongoDB queue depth, custom metrics
  Example: scale backend based on goals_total metric or HTTP request rate
  Advantage: scales to 0 (KEDA handles it, HPA cannot)

Cluster Autoscaler (EKS):
  What: adds/removes nodes when pods cannot schedule
  When: pods are Pending due to insufficient node capacity
  Requires: cloud provider (AWS Auto Scaling Groups on EKS)
  Config: node groups with min/max/desired capacity
```

**On EKS, the recommended combination is:**
```
HPA       → backend and frontend: scale replicas on CPU/RPS
VPA       → Off mode for right-sizing recommendations
KEDA      → optional: scale backend on custom business metrics
CA        → auto-provision nodes when HPA cannot schedule new pods
```

---

## Cleanup

```bash
# Remove application
kubectl delete namespace goals-production

# Remove Traefik
helm uninstall traefik -n traefik
kubectl delete namespace traefik

# Remove minikube profile
minikube delete -p goals-prod
```

**Remove Windows hosts file entries:**
Open `C:\Windows\System32\drivers\etc\hosts` as Administrator and remove:
```
127.0.0.1  goals.local
127.0.0.1  traefik.local
```

---

## Key Concepts Summary

**StatefulSet gives MongoDB stable identity**
`mongodb-0` always reconnects to `mongodb-data-mongodb-0` PVC. Headless
Service provides stable per-pod DNS. Deployment cannot guarantee this.

**Init containers solve startup ordering cleanly**
Backend init container polls MongoDB headless DNS. Node.js starts only
after MongoDB confirmed ready. No retry logic in application code.

**Liveness and readiness serve different purposes**
`/health`: Is Node.js alive? Never checks MongoDB. Failed → restart.
`/ready`: Is MongoDB connected? Failed → remove from Service endpoints.
A DB outage triggers readiness failure (pod hidden from traffic) not
liveness failure (no unnecessary restart).

**Calico CNI enforces NetworkPolicy**
Default Kubernetes CNI (kindnet) creates NetworkPolicy objects but does
not enforce them. Calico enforces them at the kernel level with iptables.
`minikube start --cni=calico` is required for real enforcement.

**`--ports` mapping solves WSL2 Traefik access**
`minikube start --ports=127.0.0.1:8080:30080` publishes NodePort 30080
to WSL2 localhost. WSL2 auto-forwards to Windows localhost. No
port-forward, no minikube tunnel, no minikube service command.

**Traefik IngressRoute is typed, not annotation-based**
Middleware references are structured named objects. kubectl validates
the structure. Dashboard shows live routing state. Standard Ingress
annotations are fragile — wrong annotation silently does nothing.

**Sealed Secrets bring credentials into the GitOps loop**
SealedSecret YAML is encrypted with cluster public key. Only the
controller can decrypt. Safe to commit to Git.

**Observability is instrumented, not deployed**
prom-client emits Prometheus metrics. JSON to stdout for Loki.
OTel SDK with console exporter for traces. Adding Prometheus + Grafana
+ Loki + Tempo later requires zero application changes.

**goals_total gauge is accurate without querying DB on every request**
Seeded on startup with `countDocuments()`. Incremented on POST, decremented
on DELETE. Never updated on GET. Always reflects current DB state.

---

## Commands Reference

```bash
# ── Cluster ──────────────────────────────────────────────────────────────
minikube status -p goals-prod
kubectl get nodes
kubectl get pods -n goals-production
kubectl get pods -n kube-system | grep -E "calico|storage|sealed"

# ── Health checks ─────────────────────────────────────────────────────────
BACKEND=$(kubectl get pod -n goals-production -l app=goals-backend -o name | head -1)
kubectl exec -n goals-production $BACKEND -- wget -qO- http://localhost/health
kubectl exec -n goals-production $BACKEND -- wget -qO- http://localhost/ready

# ── Metrics ───────────────────────────────────────────────────────────────
kubectl exec -n goals-production $BACKEND \
  -- wget -qO- http://localhost/metrics | grep -E "^(goals|http_requests|mongodb)"

# ── Logs ──────────────────────────────────────────────────────────────────
kubectl logs -l app=goals-backend -n goals-production --tail=20
kubectl logs -l app=goals-frontend -n goals-production --tail=10
kubectl logs -l app.kubernetes.io/name=traefik -n traefik --tail=10

# ── MongoDB ───────────────────────────────────────────────────────────────
kubectl exec -n goals-production mongodb-0 \
  -- mongosh --username rselvantech --password passWD \
  --authenticationDatabase admin course-goals \
  --eval "db.goals.find().pretty()" --quiet

# ── nginx stub_status ─────────────────────────────────────────────────────
FRONTEND=$(kubectl get pod -n goals-production -l app=goals-frontend -o name | head -1)
kubectl exec -n goals-production $FRONTEND -- wget -qO- http://localhost:3000/nginx_status

# ── Traefik ───────────────────────────────────────────────────────────────
kubectl get ingressroute -n goals-production
kubectl get middleware -n goals-production
# Dashboard: http://traefik.local:8080/dashboard/

# ── StatefulSet and PVC ───────────────────────────────────────────────────
kubectl describe statefulset mongodb -n goals-production
kubectl get pvc -n goals-production

# ── PDB, Quota, SealedSecret ──────────────────────────────────────────────
kubectl get pdb -n goals-production
kubectl describe resourcequota -n goals-production
kubectl get sealedsecret -n goals-production

# ── Simulate failures ─────────────────────────────────────────────────────
kubectl scale statefulset mongodb --replicas=0 -n goals-production  # trigger readiness fail
kubectl scale statefulset mongodb --replicas=1 -n goals-production  # restore

# ── Bypass Traefik (direct access) ────────────────────────────────────────
kubectl port-forward svc/goals-frontend-svc -n goals-production 3001:3000
# Browser: http://localhost:3001
```