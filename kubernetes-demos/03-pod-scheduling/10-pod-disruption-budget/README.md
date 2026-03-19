# PodDisruptionBudget

## Lab Overview

A PodDisruptionBudget (PDB) is a policy object that limits how many pods
of a replicated application can be voluntarily disrupted at one time.

PDB protects application availability during voluntary disruptions:

```
Voluntary disruptions (PDB applies):
  → kubectl drain (node maintenance)
  → Rolling updates (Deployment, StatefulSet)
  → Cluster autoscaler node scale-down
  → Direct eviction via Eviction API

Involuntary disruptions (PDB does NOT apply):
  → Node hardware failure
  → Node-pressure eviction (kubelet)
  → OOM kill
  → Kernel panic
```

Without a PDB, a rolling update or node drain could take down all replicas
simultaneously — causing a full outage. A PDB guarantees that a minimum
number of replicas are always available during these operations.

**What this lab covers:**
- PDB with minAvailable — absolute and percentage
- PDB with maxUnavailable — absolute and percentage
- PDB status — Allowed disruptions, Current, Desired
- PDB interaction with rolling updates
- PDB interaction with kubectl drain (covered in Demo 11)
- PDB interaction with cluster autoscaler (EKS reference)
- unhealthyPodEvictionPolicy
- Common pitfalls — single replica, 100% budget

---

## Prerequisites

**Required Software:**
- Minikube `3node` profile — 1 control plane + 2 workers
- kubectl installed and configured

**Knowledge Requirements:**
- **REQUIRED:** Completion of [09-node-pressure-eviction](../09-node-pressure-eviction/)
- Understanding of Deployments and rolling updates
- Understanding of kubectl drain and Eviction API

## Lab Objectives

By the end of this lab, you will be able to:
1. ✅ Create a PDB with minAvailable (absolute and percentage)
2. ✅ Create a PDB with maxUnavailable (absolute and percentage)
3. ✅ Read PDB status — Allowed disruptions, Current, Desired, Total
4. ✅ Observe PDB protecting a rolling update
5. ✅ Explain why single-replica PDB with minAvailable: 1 blocks all disruptions
6. ✅ Set unhealthyPodEvictionPolicy: AlwaysAllow
7. ✅ Explain PDB interaction with cluster autoscaler

## Directory Structure

```
10-pod-disruption-budget/
├── README.md                        # This file
└── src/
    ├── web-deployment.yaml          # 5-replica deployment for PDB demos
    ├── pdb-minavailable.yaml        # PDB with minAvailable: 2
    ├── pdb-minavailable-pct.yaml    # PDB with minAvailable: 60%
    ├── pdb-maxunavailable.yaml      # PDB with maxUnavailable: 1
    ├── pdb-maxunavailable-pct.yaml  # PDB with maxUnavailable: 20%
    └── pdb-alwaysallow.yaml         # PDB with unhealthyPodEvictionPolicy: AlwaysAllow
```

---

## Understanding PodDisruptionBudget

### What PDB Protects

A PDB specifies the number of replicas that an application can tolerate
having, relative to how many it is intended to have. For example, a
Deployment which has replicas: 5 is supposed to have 5 pods at any given
time. If its PDB allows for there to be 4 at a time, then the Eviction
API will allow voluntary disruption of one (but not two) pods at a time.

```
Without PDB:
  kubectl drain → all pods evicted simultaneously → full outage

With PDB (minAvailable: 2, replicas: 5):
  kubectl drain → evicts pods one at a time
  always keeps at least 2 pods running
  3 pods can be disrupted (5 - 2 = 3 allowed)
```

### PDB Fields

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  minAvailable: 2              # OR maxUnavailable — not both
  selector:
    matchLabels:
      app: web
  unhealthyPodEvictionPolicy: IfHealthyBudget   # default
```

| Field | Purpose | Format |
|---|---|---|
| `minAvailable` | Minimum pods that must remain available | Integer or percentage (e.g. "60%") |
| `maxUnavailable` | Maximum pods that can be unavailable | Integer or percentage (e.g. "20%") |
| `selector` | Which pods this PDB protects | Required — label selector |
| `unhealthyPodEvictionPolicy` | How unhealthy pods are treated | `IfHealthyBudget` or `AlwaysAllow` |

> You can specify only one of `minAvailable` and `maxUnavailable`.
> `maxUnavailable` is recommended as it automatically responds to
> changes in the number of replicas.

### PDB Syntax — Memory Aid
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  selector:                              # S
    matchLabels:
      app: web
  minAvailable: 2                        # M  (or maxUnavailable)
  unhealthyPodEvictionPolicy: AlwaysAllow  # U
```

**SMU** — "Selector Must be Unhealthy"
```
S → selector                  required — which pods this PDB protects
M → minAvailable /            required — one of these two (not both)
    maxUnavailable
U → unhealthyPodEvictionPolicy optional — IfHealthyBudget (default) or AlwaysAllow
```

> S and M are required — PDB is invalid without them.
> U is optional but always set AlwaysAllow on production PDBs
> to prevent drain from hanging on unhealthy pods.

### PDB Status Fields

```bash
kubectl describe pdb web-pdb
```

```
Status:
  Allowed disruptions:  1    ← how many pods can be disrupted NOW
  Current:              5    ← currently healthy pods
  Desired:              4    ← minimum healthy pods required (minAvailable)
  Total:                5    ← total pods selected by PDB
```

```
Allowed disruptions = Current - Desired
                    = 5 - 4 = 1
```

### minAvailable vs maxUnavailable — Practical Difference

```
minAvailable: 2  (replicas: 5)
  → always keep at least 2 pods available
  → allowed disruptions = 5 - 2 = 3
  → if replicas changes to 3: allowed disruptions = 3 - 2 = 1
  → value is FIXED regardless of replica count

maxUnavailable: 1  (replicas: 5)
  → at most 1 pod unavailable at any time
  → allowed disruptions = 1 always
  → if replicas changes to 3: allowed disruptions = 1 still
  → value is RELATIVE to replica count changes
  → recommended for deployments that scale
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

### Common Pitfall — Single Replica with minAvailable: 1

```
Deployment: replicas: 1
PDB: minAvailable: 1

Allowed disruptions = 1 - 1 = 0

Result: NO evictions allowed — ever
kubectl drain will hang indefinitely
```

This is a common misconfiguration. A single-replica application with
`minAvailable: 1` provides zero availability tolerance — the PDB
effectively blocks all voluntary disruptions.

**Solution:** Use `maxUnavailable: 1` for single-replica applications
when you need to allow maintenance:

```yaml
spec:
  maxUnavailable: 1   # allows 1 pod to be unavailable
                       # for single replica: 100% unavailability allowed
```

Or accept the disruption and set `minAvailable: 0`.

### PDB and Rolling Updates

Pods which are deleted or unavailable due to a rolling upgrade to an
application do count against the disruption budget, but workload
resources such as Deployment and StatefulSet are not limited by PDBs
when doing rolling upgrades. Instead, the handling of failures during
application updates is configured in the spec for the specific workload
resource (`maxSurge`, `maxUnavailable`).

```
Rolling update with PDB:
  → PDB counts unavailable pods during rollout
  → If rolling update takes pods unavailable, it counts against budget
  → PDB does not stop the rolling update itself
  → PDB limits EVICTION-API-initiated disruptions separately
```

---

## Lab Step-by-Step Guide

---

### Step 1: Deploy Web Application

```bash
cd 10-pod-disruption-budget/src

kubectl get nodes
```

**web-deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-deploy
spec:
  replicas: 5
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      terminationGracePeriodSeconds: 10
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
web-deploy-xxxxxxxxx-ccccc    1/1     Running   3node-m02
web-deploy-xxxxxxxxx-ddddd    1/1     Running   3node-m03
web-deploy-xxxxxxxxx-eeeee    1/1     Running   3node-m03
```

---

### Step 2: PDB with minAvailable — Absolute Value

**pdb-minavailable.yaml:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb-min
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app: web
```

```bash
kubectl apply -f pdb-minavailable.yaml
kubectl describe pdb web-pdb-min
```

**Expected output:**
```
Name:           web-pdb-min
Namespace:      default
Min available:  3
Selector:       app=web
Status:
  Allowed disruptions:  2
  Current:              5
  Desired:              3
  Total:                5
```

```
Allowed disruptions = Current(5) - Desired(3) = 2
→ 2 pods can be disrupted simultaneously
```

Scale down deployment and observe PDB update:

```bash
kubectl scale deployment web-deploy --replicas=3
kubectl describe pdb web-pdb-min
```

**Expected output:**
```
Status:
  Allowed disruptions:  0
  Current:              3
  Desired:              3
  Total:                3
```

```
Allowed disruptions = Current(3) - Desired(3) = 0
→ No evictions allowed — minAvailable(3) = replicas(3)
→ Any eviction would drop below minimum
```

Scale back:
```bash
kubectl scale deployment web-deploy --replicas=5
kubectl delete -f pdb-minavailable.yaml
```

---

### Step 3: PDB with minAvailable — Percentage

**pdb-minavailable-pct.yaml:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb-min-pct
spec:
  minAvailable: "60%"
  selector:
    matchLabels:
      app: web
```

```bash
kubectl apply -f pdb-minavailable-pct.yaml
kubectl describe pdb web-pdb-min-pct
```

**Expected output:**
```
Status:
  Allowed disruptions:  2
  Current:              5
  Desired:              3
  Total:                5
```

```
minAvailable: 60% of 5 replicas = 3 pods
Allowed disruptions = 5 - 3 = 2
```

Scale to 10 and observe percentage recalculation:

```bash
kubectl scale deployment web-deploy --replicas=10
kubectl describe pdb web-pdb-min-pct
```

**Expected output:**
```
Status:
  Allowed disruptions:  4
  Current:              10
  Desired:              6
  Total:                10
```

```
minAvailable: 60% of 10 = 6 pods
Allowed disruptions = 10 - 6 = 4
```

```bash
kubectl scale deployment web-deploy --replicas=5
kubectl delete -f pdb-minavailable-pct.yaml
```

---

### Step 4: PDB with maxUnavailable

**pdb-maxunavailable.yaml:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb-max
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: web
  unhealthyPodEvictionPolicy: AlwaysAllow
```

```bash
kubectl apply -f pdb-maxunavailable.yaml
kubectl describe pdb web-pdb-max
```

**Expected output:**
```
Name:               web-pdb-max
Max unavailable:    1
Status:
  Allowed disruptions:  1
  Current:              5
  Desired:              4
  Total:                5
```

```
maxUnavailable: 1 → at most 1 pod unavailable
Allowed disruptions = 1 always
```

Scale and observe maxUnavailable stays constant:

```bash
kubectl scale deployment web-deploy --replicas=10
kubectl describe pdb web-pdb-max
```

**Expected output:**
```
Status:
  Allowed disruptions:  1   ← still 1 regardless of replica count
  Current:              10
  Desired:              9
  Total:                10
```

```
maxUnavailable: 1 → always 1 disruption allowed
minAvailable would have changed proportionally — this is why
maxUnavailable is recommended for scaling deployments
```

```bash
kubectl scale deployment web-deploy --replicas=5
```

---

### Step 5: PDB During Rolling Update

Observe how PDB interacts with rolling updates. The rolling update
counts pods that are temporarily unavailable against the PDB.

```bash
# PDB maxUnavailable: 1 is still active
kubectl describe pdb web-pdb-max

# Trigger rolling update — change image
kubectl set image deployment/web-deploy app=nginx

# Watch rolling update progress
kubectl rollout status deployment/web-deploy
kubectl get pods -o wide -w
```

**Expected output during rolling update:**
```
NAME                          READY   STATUS        NODE
web-deploy-old-xxxxxxxxx-a    1/1     Running       3node-m02
web-deploy-old-xxxxxxxxx-b    1/1     Running       3node-m02
web-deploy-old-xxxxxxxxx-c    1/1     Terminating   3node-m02  ← 1 pod terminating
web-deploy-new-xxxxxxxxx-d    0/1     Pending       3node-m03  ← new pod starting
```

Rolling update terminates one pod at a time — `maxUnavailable: 1` in
the Deployment spec controls this. The PDB `maxUnavailable: 1` counts
the unavailable pods and limits simultaneous evictions.

```bash
# Rollback to busybox
kubectl rollout undo deployment/web-deploy
kubectl rollout status deployment/web-deploy
```

---

### Step 6: Single Replica Pitfall

Demonstrate the common misconfiguration of single-replica PDB:

```bash
# Scale to 1 replica
kubectl scale deployment web-deploy --replicas=1

# Apply PDB with minAvailable: 1
cat <<EOF | kubectl apply -f -
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb-single
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: web
EOF

kubectl describe pdb web-pdb-single
```

**Expected output:**
```
Status:
  Allowed disruptions:  0   ← zero disruptions allowed
  Current:              1
  Desired:              1
  Total:                1
```

```
Allowed disruptions = Current(1) - Desired(1) = 0
→ No evictions allowed — kubectl drain will hang
```

**Try to drain a node — observe it hangs:**

```bash
# In a separate terminal or background
kubectl cordon 3node-m02
kubectl drain 3node-m02 --ignore-daemonsets --delete-emptydir-data &
DRAIN_PID=$!

# Wait 10 seconds then check
sleep 10
kubectl get pods -o wide
# Pod is still running — drain is blocked by PDB
```

**Cancel drain and fix:**

```bash
kill $DRAIN_PID
kubectl uncordon 3node-m02

# Fix: use maxUnavailable: 1 instead
kubectl delete pdb web-pdb-single

cat <<EOF | kubectl apply -f -
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb-fixed
spec:
  maxUnavailable: 1    # allows 1 disruption even with 1 replica
  selector:
    matchLabels:
      app: web
EOF

kubectl describe pdb web-pdb-fixed
# Allowed disruptions: 1 ← drain can proceed
```

**Cleanup:**
```bash
kubectl delete pdb web-pdb-fixed
kubectl scale deployment web-deploy --replicas=5
```

---

### Step 7: Final Cleanup

```bash
kubectl delete -f pdb-maxunavailable.yaml
kubectl delete -f web-deployment.yaml

# Verify clean
kubectl get pdb
kubectl get deployments
kubectl get pods
```

---

## Common Questions

### Q: Does PDB work with StatefulSets?

**A:** Yes. PDB works with any replicated workload — Deployments,
StatefulSets, ReplicaSets. For a StatefulSet with 3 replicas and
`minAvailable: 2`, kubectl drain only evicts a pod if all 3 replicas
are healthy. If multiple drains run in parallel, Kubernetes ensures
only 1 pod (replicas - minAvailable = 3 - 2 = 1) is unavailable.

### Q: Does PDB apply to rolling updates?

**A:** Pods which are deleted or unavailable due to a rolling upgrade
do count against the disruption budget, but Deployments and StatefulSets
are not limited by PDBs when doing rolling upgrades. The rolling update
behaviour is controlled by `maxSurge` and `maxUnavailable` in the
Deployment spec. PDB limits disruptions from the Eviction API separately.

### Q: What happens if PDB selector matches no pods?

**A:** For `policy/v1` — an empty selector matches every pod in the
namespace. An unset selector selects no pods. Always set an explicit
selector to avoid unintended matches.

### Q: Does cluster autoscaler respect PDB?

**A:** Yes. The cluster autoscaler respects PDB when scaling down nodes.
If evicting pods from a node would violate a PDB, the autoscaler will
not scale down that node. This is why well-configured PDBs are important
in auto-scaling clusters.

---

## What You Learned

In this lab, you:
- ✅ Created PDBs with `minAvailable` (absolute and percentage)
- ✅ Created PDBs with `maxUnavailable` (absolute and percentage)
- ✅ Read PDB status — Allowed disruptions, Current, Desired, Total
- ✅ Observed how `maxUnavailable` stays constant when replicas change
  while `minAvailable` adjusts proportionally
- ✅ Observed PDB interaction with rolling updates
- ✅ Demonstrated the single-replica pitfall with `minAvailable: 1`
- ✅ Understood `unhealthyPodEvictionPolicy: AlwaysAllow`

**Key Takeaway:** PDB is your application's availability guarantee
during voluntary disruptions. Always define a PDB for production
workloads. Use `maxUnavailable` rather than `minAvailable` for
deployments that scale — it remains valid as replicas change. Avoid
`minAvailable: 1` with single-replica deployments — it blocks all
disruptions. Set `unhealthyPodEvictionPolicy: AlwaysAllow` to prevent
drain from hanging on unhealthy pods.

---

## Quick Commands Reference

| Command | Description |
|---|---|
| `kubectl get pdb` | List all PodDisruptionBudgets |
| `kubectl describe pdb <n>` | Show PDB status including allowed disruptions |
| `kubectl create pdb <n> --selector=app=<n> --min-available=2` | Create PDB imperatively (minAvailable) |
| `kubectl create pdb <n> --selector=app=<n> --max-unavailable=1` | Create PDB imperatively (maxUnavailable) |
| `kubectl explain pdb.spec` | Browse PDB field docs |
| `kubectl rollout status deployment/<n>` | Monitor rolling update progress |
| `kubectl set image deployment/<n> <container>=<image>` | Trigger rolling update |
| `kubectl rollout undo deployment/<n>` | Rollback deployment |

---

## CKA Certification Tips

✅ **PDB API version — policy/v1 (not v1beta1 which is removed in v1.25):**
```yaml
apiVersion: policy/v1   # ← correct for v1.21+
kind: PodDisruptionBudget
```

✅ **minAvailable vs maxUnavailable — mutually exclusive:**
```yaml
spec:
  minAvailable: 2     # OR
  maxUnavailable: 1   # NOT both — validation error
```

✅ **Selector is required:**
```yaml
spec:
  selector:
    matchLabels:
      app: web   # required — empty selector matches ALL pods in namespace
```

✅ **Reading PDB status — know these fields:**
```
Allowed disruptions  → how many pods can be disrupted NOW
Current             → currently healthy pods
Desired             → minimum healthy pods required
Total               → total pods selected
```

✅ **Single replica pitfall:**
```
replicas: 1 + minAvailable: 1 → Allowed disruptions = 0 → drain hangs
Fix: use maxUnavailable: 1
```

✅ **Imperative creation:**
```bash
kubectl create pdb web-pdb --selector=app=web --min-available=2
kubectl create pdb web-pdb --selector=app=web --max-unavailable=1
```

---

## Troubleshooting

**kubectl drain hangs indefinitely:**
```bash
kubectl describe pdb <n>
# Check Allowed disruptions — if 0, no evictions permitted
# Common cause: single replica + minAvailable: 1
# Fix: use maxUnavailable: 1 or delete the PDB
kubectl get pods -l <selector> -o wide
# Check if pods are unhealthy — IfHealthyBudget blocks unhealthy pod eviction
# Fix: set unhealthyPodEvictionPolicy: AlwaysAllow
```

**PDB Allowed disruptions shows 0 unexpectedly:**
```bash
kubectl describe pdb <n>
# Check Current vs Desired
# If Current = Desired, allowed disruptions = 0
# This means enough pods are already unavailable
kubectl get pods -l <selector>
# Look for pods in non-Running state
```

**PDB not protecting pods during drain:**
```bash
# Verify PDB selector matches pod labels
kubectl get pods -l <pdb-selector> -o wide
# Verify PDB is in the same namespace as the pods
kubectl get pdb -n <namespace>
```
