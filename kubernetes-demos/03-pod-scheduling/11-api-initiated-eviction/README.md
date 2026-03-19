# API-initiated Eviction

## Lab Overview

API-initiated eviction is the process by which you use the Eviction API
to create an Eviction object that triggers graceful pod termination.

Unlike node-pressure eviction (Demo 09) which is driven by the kubelet
and does not respect PodDisruptionBudget, API-initiated eviction is a
policy-controlled operation:

```
API-initiated eviction:
  → respects PodDisruptionBudget (returns 429 if PDB would be violated)
  → respects terminationGracePeriodSeconds
  → triggered by kubectl drain, direct API call, or controllers
  → like a policy-controlled DELETE on the pod

Node-pressure eviction:
  → kubelet-driven, does NOT respect PDB
  → hard threshold: 0s grace period
  → triggered by resource exhaustion
```

Real-world use cases:
- Node maintenance — drain before patching OS or replacing hardware
- Cluster upgrades — safely evict pods before upgrading node components
- Autoscaler scale-down — gracefully remove pods before terminating a node

**What this lab covers:**
- Direct Eviction API call
- kubectl drain — uses Eviction API internally
- PodDisruptionBudget interaction — 429 response when PDB violated
- Node maintenance workflow — cordon, drain, uncordon
- unhealthyPodEvictionPolicy — AlwaysAllow vs IfHealthyBudget

---

## Prerequisites

**Required Software:**
- Minikube `3node` profile — 1 control plane + 2 workers
- kubectl installed and configured
- curl (for direct API calls)

**Knowledge Requirements:**
- **REQUIRED:** Completion of [09-node-pressure-eviction](../09-node-pressure-eviction/)
- **REQUIRED:** Completion of [10-pod-disruption-budget](../10-pod-disruption-budget/)
- Understanding of kubectl drain basics

## Lab Objectives

By the end of this lab, you will be able to:
1. ✅ Evict a pod directly using the Eviction API
2. ✅ Explain the difference between API-initiated eviction and pod deletion
3. ✅ Create a PodDisruptionBudget and observe 429 response on violation
4. ✅ Perform a safe node drain respecting PDB
5. ✅ Use cordon, drain, and uncordon for node maintenance workflow
6. ✅ Explain unhealthyPodEvictionPolicy and when to use AlwaysAllow

## Directory Structure

```
11-api-initiated-eviction/
├── README.md                        # This file
└── src/
    ├── web-deployment.yaml          # 3-replica deployment for eviction demo
    ├── pdb-minavailable.yaml        # PDB with minAvailable: 2
    ├── pdb-maxunavailable.yaml      # PDB with maxUnavailable: 1
    └── pdb-alwaysallow.yaml         # PDB with unhealthyPodEvictionPolicy: AlwaysAllow
```

---

## Understanding API-initiated Eviction

### What is an Eviction Object

API-initiated eviction is the process by which you use the Eviction API
to create an Eviction object that triggers graceful pod termination.
Using the API to create an Eviction object for a Pod is like performing
a policy-controlled DELETE operation on the Pod.

When you request an eviction using the API, the API server performs
admission checks and responds:

```
200 OK            → eviction allowed, pod deleted gracefully
429 Too Many Requests → eviction blocked by PodDisruptionBudget
500 Internal Error → eviction blocked by misconfiguration
```

### PodDisruptionBudget Fields

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  minAvailable: 2           # mutually exclusive with maxUnavailable
  # maxUnavailable: 1       # cannot set both
  selector:
    matchLabels:
      app: web
  unhealthyPodEvictionPolicy: IfHealthyBudget  # default
```

| Field | Purpose |
|---|---|
| `minAvailable` | Minimum pods that must remain available after eviction. Integer or percentage |
| `maxUnavailable` | Maximum pods that can be unavailable after eviction. Integer or percentage |
| `selector` | Which pods this PDB protects — required |
| `unhealthyPodEvictionPolicy` | `IfHealthyBudget` (default) or `AlwaysAllow` |

> You can specify only one of `minAvailable` and `maxUnavailable` in a
> single PodDisruptionBudget. The use of `maxUnavailable` is recommended
> as it automatically responds to changes in the number of replicas.

### minAvailable vs maxUnavailable

```
minAvailable: 2  (with 3 replicas)
  → at least 2 pods must be available after eviction
  → 1 pod can be disrupted at a time
  → equivalent to maxUnavailable: 1 when replicas=3

maxUnavailable: 1  (with 3 replicas)
  → at most 1 pod can be unavailable
  → automatically adjusts if replicas changes
  → preferred — more flexible
```

> Example: with minAvailable: 30%, evictions are allowed as long as
> at least 30% of the desired replicas are healthy.

### unhealthyPodEvictionPolicy

```
IfHealthyBudget (default)
  → unhealthy pods can only be evicted if the application still has
    at least minAvailable healthy pods
  → protects unhealthy pods from disruption during node drain
  → can cause drain to hang if unhealthy pods exist

AlwaysAllow
  → unhealthy pods can always be evicted regardless of budget
  → recommended for node drain workflows
  → prevents drain from hanging due to stuck unhealthy pods
```

### kubectl drain vs Direct Delete

```
kubectl drain           → uses Eviction API → respects PDB
                          graceful termination
                          returns 429 if PDB violated (retries)

kubectl delete pod      → direct deletion → bypasses PDB
                          forceful if --grace-period=0
                          does not wait for PDB
```

---

## Lab Step-by-Step Guide

---

### Step 1: Deploy Web Application

```bash
cd 09-api-initiated-eviction/src

kubectl get nodes
```

**Expected output:**
```
NAME        STATUS   ROLES           AGE   VERSION
3node       Ready    control-plane   ...   v1.34.0
3node-m02   Ready    <none>          ...   v1.34.0
3node-m03   Ready    <none>          ...   v1.34.0
```

**web-deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-deploy
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: app
          image: busybox
          command: ["sh", "-c", "sleep 3600"]
          resources:
            requests:
              cpu: "100m"
              memory: "64Mi"
            limits:
              cpu: "200m"
              memory: "128Mi"
```

```bash
kubectl apply -f web-deployment.yaml
kubectl get pods -o wide
```

**Expected output:**
```
NAME                          READY   STATUS    NODE
web-deploy-xxxxxxxxx-aaaaa    1/1     Running   3node-m02
web-deploy-xxxxxxxxx-bbbbb    1/1     Running   3node-m02
web-deploy-xxxxxxxxx-ccccc    1/1     Running   3node-m03
```

---

### Step 2: Direct Eviction API Call

Evict one pod directly using the Eviction API without a PDB active.

Get the name of one pod:

```bash
POD_NAME=$(kubectl get pods -l app=web -o jsonpath='{.items[0].metadata.name}')
echo $POD_NAME
```

Evict using kubectl proxy and curl:

```bash
kubectl proxy &
PROXY_PID=$!

curl -v -H 'Content-type: application/json' \
  http://localhost:8001/api/v1/namespaces/default/pods/${POD_NAME}/eviction \
  -d "{
    \"apiVersion\": \"policy/v1\",
    \"kind\": \"Eviction\",
    \"metadata\": {
      \"name\": \"${POD_NAME}\",
      \"namespace\": \"default\"
    }
  }"
```

**Expected output:**
```
HTTP/1.1 200 OK
...
{"kind":"Status","apiVersion":"v1","status":"Success"}
```

```bash
kubectl get pods -o wide
```

**Expected output:**
```
NAME                          READY   STATUS    NODE
web-deploy-xxxxxxxxx-bbbbb    1/1     Running   3node-m02
web-deploy-xxxxxxxxx-ccccc    1/1     Running   3node-m03
web-deploy-xxxxxxxxx-ddddd    1/1     Running   3node-m02   ← new pod created by deployment
```

The evicted pod was terminated gracefully. The Deployment controller
created a replacement pod automatically.

```bash
kill $PROXY_PID
```

---

### Step 3: PodDisruptionBudget — minAvailable

Create a PDB that requires at least 2 pods to remain available:

**pdb-minavailable.yaml:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb-minavailable
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: web
```

```bash
kubectl apply -f pdb-minavailable.yaml
kubectl describe pdb web-pdb-minavailable
```

**Expected output:**
```
Name:           web-pdb-minavailable
Namespace:      default
Min available:  2
Selector:       app=web
Status:
  Allowed disruptions:  1
  Current:              3
  Desired:              2
  Total:                3
```

`Allowed disruptions: 1` — one pod can be evicted (3 total - 2 minimum = 1 allowed).

**Evict one pod — should succeed (allowed disruptions = 1):**

```bash
kubectl proxy &
PROXY_PID=$!

POD_NAME=$(kubectl get pods -l app=web -o jsonpath='{.items[0].metadata.name}')

curl -v -H 'Content-type: application/json' \
  http://localhost:8001/api/v1/namespaces/default/pods/${POD_NAME}/eviction \
  -d "{
    \"apiVersion\": \"policy/v1\",
    \"kind\": \"Eviction\",
    \"metadata\": {
      \"name\": \"${POD_NAME}\",
      \"namespace\": \"default\"
    }
  }"
```

**Expected output:**
```
HTTP/1.1 200 OK
```

Wait for replacement pod to become Running, then try evicting again:

```bash
kubectl get pods -o wide
# Wait until 3 pods are Running again

# Now evict another pod — PDB allows only 1 disruption
# While 1 pod is still being replaced, try evicting another
POD_NAME=$(kubectl get pods -l app=web -o jsonpath='{.items[0].metadata.name}')

curl -v -H 'Content-type: application/json' \
  http://localhost:8001/api/v1/namespaces/default/pods/${POD_NAME}/eviction \
  -d "{
    \"apiVersion\": \"policy/v1\",
    \"kind\": \"Eviction\",
    \"metadata\": {
      \"name\": \"${POD_NAME}\",
      \"namespace\": \"default\"
    }
  }"
```

**Expected output when PDB budget is exhausted:**
```
HTTP/1.1 429 Too Many Requests
{
  "kind": "Status",
  "reason": "TooManyRequests",
  "message": "Cannot evict pod as it would violate the pod's disruption budget."
}
```

> 429 = eviction blocked by PDB. The eviction can be retried later
> once the disrupted pod recovers and PDB budget is restored.

```bash
kill $PROXY_PID
kubectl delete -f pdb-minavailable.yaml
```

---

### Step 4: Node Maintenance Workflow — Cordon, Drain, Uncordon

The standard node maintenance workflow uses three commands:

```
kubectl cordon   → mark node unschedulable (no new pods)
kubectl drain    → evict all pods from node (respects PDB)
kubectl uncordon → mark node schedulable again
```

**Create a PDB before draining:**

**pdb-maxunavailable.yaml:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb-maxunavailable
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: web
  unhealthyPodEvictionPolicy: AlwaysAllow
```

```bash
kubectl apply -f pdb-maxunavailable.yaml
kubectl describe pdb web-pdb-maxunavailable
```

**Expected output:**
```
Name:             web-pdb-maxunavailable
Max unavailable:  1
Allowed disruptions:  1
Current:              3
Desired:              2
Total:                3
```

**Step 1 — Cordon the node:**

```bash
kubectl cordon 3node-m02
kubectl get nodes
```

**Expected output:**
```
NAME        STATUS                     ROLES
3node       Ready                      control-plane
3node-m02   Ready,SchedulingDisabled   <none>    ← cordoned
3node-m03   Ready                      <none>
```

No new pods will be scheduled on `3node-m02`. Existing pods continue
running.

**Step 2 — Drain the node:**

```bash
kubectl drain 3node-m02 \
  --ignore-daemonsets \
  --delete-emptydir-data
```

**Expected output:**
```
node/3node-m02 already cordoned
evicting pod default/web-deploy-xxxxxxxxx-aaaaa
evicting pod default/web-deploy-xxxxxxxxx-bbbbb
pod/web-deploy-xxxxxxxxx-aaaaa evicted
pod/web-deploy-xxxxxxxxx-bbbbb evicted
node/3node-m02 drained
```

```bash
kubectl get pods -o wide
```

**Expected output:**
```
NAME                          READY   STATUS    NODE
web-deploy-xxxxxxxxx-ddddd    1/1     Running   3node-m03
web-deploy-xxxxxxxxx-eeeee    1/1     Running   3node-m03
web-deploy-xxxxxxxxx-fffff    1/1     Running   3node-m03
```

All pods moved to `3node-m03`. Node is safe for maintenance.

> `--ignore-daemonsets` — DaemonSet pods cannot be evicted (they are
> managed by DaemonSet controller and would be recreated immediately).
> This flag skips them.
>
> `--delete-emptydir-data` — pods with emptyDir volumes would block drain
> without this flag because emptyDir data would be lost. This flag
> acknowledges the data loss.

**Step 3 — Simulate maintenance complete, uncordon:**

```bash
kubectl uncordon 3node-m02
kubectl get nodes
```

**Expected output:**
```
NAME        STATUS   ROLES
3node       Ready    control-plane
3node-m02   Ready    <none>    ← schedulable again
3node-m03   Ready    <none>
```

```bash
kubectl get pods -o wide
# Pods will gradually rebalance to 3node-m02 as new ones are scheduled
```

**Cleanup:**
```bash
kubectl delete -f pdb-maxunavailable.yaml
kubectl delete -f web-deployment.yaml
```

---

### Step 5: unhealthyPodEvictionPolicy — AlwaysAllow

Demonstrate why `AlwaysAllow` is recommended for drain workflows.
When unhealthy pods exist, `IfHealthyBudget` (default) blocks drain.

Deploy a deployment where one pod will be stuck unhealthy:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: unhealthy-deploy
spec:
  replicas: 3
  selector:
    matchLabels:
      app: unhealthy-test
  template:
    metadata:
      labels:
        app: unhealthy-test
    spec:
      terminationGracePeriodSeconds: 0
      containers:
        - name: app
          image: busybox
          command: ["sh", "-c", "sleep 3600"]
          resources:
            requests:
              cpu: "100m"
              memory: "64Mi"
            limits:
              cpu: "200m"
              memory: "128Mi"
          readinessProbe:
            exec:
              command: ["cat", "/tmp/ready"]
            initialDelaySeconds: 2
            periodSeconds: 5
EOF

kubectl get pods -o wide
# Some pods will show 0/1 READY (failing readiness probe — /tmp/ready not present)
```

**pdb-alwaysallow.yaml:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: unhealthy-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: unhealthy-test
  unhealthyPodEvictionPolicy: AlwaysAllow
```

```bash
kubectl apply -f pdb-alwaysallow.yaml
kubectl describe pdb unhealthy-pdb
```

```bash
# Drain node — AlwaysAllow means unhealthy pods are evicted even if
# budget would otherwise block them
kubectl drain 3node-m02 \
  --ignore-daemonsets \
  --delete-emptydir-data
```

**Expected output:**
```
evicting pod default/unhealthy-deploy-xxxxxxxxx-aaaaa
pod/unhealthy-deploy-xxxxxxxxx-aaaaa evicted
node/3node-m02 drained
```

> With `IfHealthyBudget` (default), drain would hang waiting for unhealthy
> pods to become healthy before evicting them. `AlwaysAllow` evicts them
> regardless — preventing stuck drains during maintenance.

**Cleanup:**
```bash
kubectl uncordon 3node-m02
kubectl delete deployment unhealthy-deploy
kubectl delete pdb unhealthy-pdb
```

---

## Common Questions

### Q: What is the difference between `kubectl drain` and `kubectl delete pod`?

**A:** `kubectl drain` uses the Eviction API and respects
PodDisruptionBudget — it will block (retry) if eviction would violate
the PDB. `kubectl delete pod` is a direct deletion that bypasses PDB.
Always use `kubectl drain` for node maintenance to maintain application
availability guarantees.

### Q: What does a 429 response mean?

**A:** 429 Too Many Requests means the eviction is not currently allowed
because of the configured PodDisruptionBudget. The eviction can be
retried later once the budget is restored (evicted pod recovers and
becomes healthy again).

### Q: Can I force drain even if PDB blocks it?

**A:** Yes — `kubectl drain --disable-eviction` bypasses the Eviction
API and uses direct deletion. This circumvents PDB protection and should
only be used when you need to proceed regardless of application
availability guarantees.

### Q: Why does drain hang during node maintenance?

**A:** The most common cause is unhealthy pods that cannot be evicted
due to `IfHealthyBudget` PDB policy — drain waits for unhealthy pods
to become healthy before evicting them. Set `unhealthyPodEvictionPolicy:
AlwaysAllow` on your PDBs to prevent this.

---

## What You Learned

In this lab, you:
- ✅ Evicted a pod directly using the Eviction API
- ✅ Created a PodDisruptionBudget and observed 200 OK and 429 responses
- ✅ Performed a complete node maintenance workflow — cordon, drain, uncordon
- ✅ Used `--ignore-daemonsets` and `--delete-emptydir-data` drain flags
- ✅ Understood `unhealthyPodEvictionPolicy: AlwaysAllow` and why it
  prevents stuck drains

**Key Takeaway:** API-initiated eviction is the safe, policy-controlled
way to evict pods. Always use `kubectl drain` for node maintenance — it
respects PDB and graceful termination. Set `unhealthyPodEvictionPolicy:
AlwaysAllow` on PDBs to prevent drain from hanging on unhealthy pods.
A 429 response means the PDB is protecting your application — not an
error, but a guarantee working as designed.

---

## Quick Commands Reference

| Command | Description |
|---|---|
| `kubectl cordon <node>` | Mark node unschedulable — existing pods unaffected |
| `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data` | Safely drain all pods from node |
| `kubectl uncordon <node>` | Mark node schedulable again |
| `kubectl drain <node> --disable-eviction` | Force drain — bypasses PDB (use with caution) |
| `kubectl get pdb` | List all PodDisruptionBudgets |
| `kubectl describe pdb <n>` | Show PDB status including allowed disruptions |
| `kubectl create pdb <n> --selector=app=<n> --min-available=1` | Create PDB imperatively |
| `kubectl explain pdb.spec` | Browse PDB field docs |

---

## CKA Certification Tips

✅ **PDB API version — policy/v1 (not v1beta1 which is removed):**
```yaml
apiVersion: policy/v1   # ← correct
kind: PodDisruptionBudget
```

✅ **minAvailable vs maxUnavailable — mutually exclusive:**
```yaml
spec:
  minAvailable: 2     # OR
  maxUnavailable: 1   # NOT both — validation error if both set
```

✅ **429 = PDB blocked eviction — not an error:**
```
429 Too Many Requests → PDB protecting application
                        retry after budget is restored
200 OK                → eviction allowed and processed
```

✅ **Standard drain flags to memorise:**
```bash
kubectl drain <node> \
  --ignore-daemonsets \      # skip DaemonSet pods (cannot evict them)
  --delete-emptydir-data     # allow deletion of pods with emptyDir volumes
```

✅ **Node maintenance workflow:**
```
1. kubectl cordon <node>     → prevent new pods
2. kubectl drain <node>      → evict existing pods (respects PDB)
3. [perform maintenance]
4. kubectl uncordon <node>   → allow new pods
```

✅ **Imperative PDB creation:**
```bash
kubectl create pdb web-pdb --selector=app=web --min-available=2
```

---

## Troubleshooting

**kubectl drain hangs:**
```bash
# Check for unhealthy pods blocked by IfHealthyBudget
kubectl get pods -l <selector> -o wide
# Check PDB status
kubectl describe pdb <name>
# Solution: set unhealthyPodEvictionPolicy: AlwaysAllow
# or force with --disable-eviction (bypasses PDB)
```

**429 response on eviction:**
```bash
kubectl describe pdb <name>
# Check Allowed disruptions — must be > 0 for eviction to proceed
# Check Current vs Desired — if Current < Desired, budget is exhausted
```

**Pods not rescheduled after uncordon:**
```bash
# Pods from Deployment/StatefulSet reschedule automatically
# Check deployment status
kubectl get deployment <name>
kubectl rollout status deployment/<name>
```
