# Autoscaling — HPA & VPA

## Lab Overview

This lab covers two mechanisms Kubernetes provides for automatic resource
adjustment — scaling **out** (more pods) and scaling **up** (bigger pods).

**Horizontal Pod Autoscaler (HPA)** watches CPU and memory utilisation
across your pods and adjusts the replica count automatically. No manual
intervention required when traffic spikes or drops.

**Vertical Pod Autoscaler (VPA)** watches actual CPU and memory consumption
and adjusts `requests` and `limits` on your pods. It answers the question:
"are my pods sized correctly for what they actually need?"

> ⚠️ **VPA is NOT part of the CKA exam.** It requires a separate
> installation and is not included in standard Kubernetes. It is covered
> here because it is widely used in production environments.

**What you'll do:**
- Install and verify metrics-server (prerequisite for HPA)
- Create an HPA imperatively and understand `autoscaling/v1` limitations
- Write a complete `autoscaling/v2` HPA manifest for CPU and memory
- Generate load and observe HPA scaling out and in
- Tune HPA scale-down stabilisation behaviour
- Install VPA and understand its three components
- Use VPA `Off` mode to get right-sizing recommendations
- Use VPA `Auto` mode and observe pod restarts with updated requests
- Demonstrate the VPA + HPA conflict

## Prerequisites

**Required Software:**
- Minikube multi-node cluster (`3node` profile) — 1 control plane + 2 workers
- kubectl installed and configured
- Git (for VPA installation)
- Text editor (VS Code recommended with Kubernetes extension)

**Knowledge Requirements:**
- **REQUIRED:** Completion of [06-resource-management](../06-resource-management/)
- Understanding of `resources.requests` and `resources.limits`
- Familiarity with Deployments and Services

## Lab Objectives

By the end of this lab, you will be able to:
1. ✅ Create an HPA using both imperative and declarative approaches
2. ✅ Explain the difference between `autoscaling/v1` and `autoscaling/v2`
3. ✅ Write an HPA manifest for CPU and memory using `autoscaling/v2`
4. ✅ Explain and verify the HPA scaling formula
5. ✅ Configure HPA scale-down stabilisation behaviour
6. ✅ Install VPA and identify its three components
7. ✅ Use VPA `Off` mode to collect right-sizing recommendations
8. ✅ Use VPA `Auto` mode and observe automatic pod right-sizing
9. ✅ Demonstrate why VPA and HPA conflict when both target CPU/memory

## Directory Structure

```
12-autoscaling/
└── src/
    ├── nginx-deploy.yaml           # Target deployment for HPA demos
    ├── hpa-v1-imperative.sh        # Imperative autoscale command (autoscaling/v1)
    ├── hpa-cpu-v2.yaml             # HPA — CPU based (autoscaling/v2)
    ├── hpa-memory-v2.yaml          # HPA — memory based (autoscaling/v2)
    ├── hpa-multi-metric.yaml       # HPA — CPU + memory combined
    ├── hpa-behaviour.yaml          # HPA with custom scale-down behaviour
    ├── load-generator.yaml         # Pod that generates HTTP load
    ├── vpa-off.yaml                # VPA in Off mode — recommendations only
    └── vpa-auto.yaml               # VPA in Auto mode — auto right-sizing
```

---

## Understanding HPA & VPA

### HPA Scaling Formula

```
desiredReplicas = ceil[ currentReplicas × (currentMetricValue / desiredMetricValue) ]

Example:
  currentReplicas:  2
  currentCPU:       90%
  targetCPU:        50%

  desiredReplicas = ceil[ 2 × (90 / 50) ]
                 = ceil[ 3.6 ]
                 = 4    ← always rounds UP
```

### autoscaling/v1 vs autoscaling/v2

```
autoscaling/v1  → CPU only, no behaviour tuning, deprecated
autoscaling/v2  → CPU + memory + custom metrics + behaviour tuning
                  Always use v2
```

### HPA Control Loop

```
Every 15 seconds:
  HPA controller → queries Metrics Server
    → calculates desired replicas using formula
      → if change needed AND outside ±10% tolerance:
          updates Deployment replica count
```

### VPA Components

```
Recommender    → analyses historical + current usage → generates recommendations
Updater        → evicts pods that need resource adjustments
Admission Ctrl → sets new requests/limits when evicted pod is recreated
```

---

## Lab Step-by-Step Guide

---

### Step 1: Enable Metrics Server

Metrics server is required by HPA to query pod CPU and memory utilisation.

```bash
minikube addons enable metrics-server -p 3node
```

**Expected output:**
```
* The 'metrics-server' addon is enabled
```

Wait ~60 seconds for the metrics-server pod to be ready:

```bash
kubectl get pods -n kube-system | grep metrics-server
```

**Expected output:**
```
metrics-server-xxxxxxxxx-aaaaa   1/1   Running   0   60s
```

Verify it is working:

```bash
kubectl top nodes
```

**Expected output:**
```
NAME        CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
3node       200m         5%     950Mi           16%
3node-m02   90m          2%     620Mi           11%
3node-m03   85m          2%     600Mi           10%
```

> Values will vary. As long as you see numbers (not an error), metrics
> server is working correctly.

---

### Step 2: Deploy the Target Application

All HPA demos in this lab target this deployment.

**nginx-deploy.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      terminationGracePeriodSeconds: 0
      containers:
        - name: nginx
          image: nginx
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: "100m"       # HPA calculates utilisation against this
              memory: "128Mi"
            limits:
              cpu: "200m"
              memory: "256Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-svc
spec:
  selector:
    app: nginx
  ports:
    - port: 80
      targetPort: 80
```

> **Why nginx here?** The load generator uses HTTP requests to generate
> realistic CPU load. busybox does not serve HTTP — nginx is the
> appropriate choice for this specific demo.

```bash
cd 07-autoscaling/src

kubectl apply -f nginx-deploy.yaml
kubectl get pods -o wide
```

**Expected output:**
```
NAME                            READY   STATUS    NODE
nginx-deploy-xxxxxxxxx-aaaaa    1/1     Running   3node-m02
```

---

### Step 3: HPA — Imperative Command (autoscaling/v1)

The `kubectl autoscale` command creates an HPA quickly but uses the
deprecated `autoscaling/v1` API — CPU only, no behaviour tuning.

```bash
kubectl autoscale deployment nginx-deploy \
  --min=1 --max=5 --cpu-percent=50

kubectl get hpa nginx-deploy
```

**Expected output:**
```
NAME           REFERENCE                 TARGETS         MINPODS   MAXPODS   REPLICAS
nginx-deploy   Deployment/nginx-deploy   <unknown>/50%   1         5         1
```

> `<unknown>` in TARGETS is normal immediately after creation — the HPA
> controller has not yet received metrics from the metrics server. It
> resolves within 30-60 seconds.

Wait 60 seconds then check again:

```bash
kubectl get hpa nginx-deploy
```

**Expected output:**
```
NAME           REFERENCE                 TARGETS   MINPODS   MAXPODS   REPLICAS
nginx-deploy   Deployment/nginx-deploy   0%/50%    1         5         1
```

Inspect the full HPA detail:

```bash
kubectl describe hpa nginx-deploy
```

Note the `Events` section — it shows scaling decisions as they happen.
Also note that this created an `autoscaling/v1` object:

```bash
kubectl get hpa nginx-deploy -o yaml | grep apiVersion
```

**Expected output:**
```
apiVersion: autoscaling/v1
```

Delete this HPA — we will replace it with a `v2` manifest:

```bash
kubectl delete hpa nginx-deploy
```

---

### Step 4: HPA — Declarative autoscaling/v2 (CPU)

**hpa-cpu-v2.yaml:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa-cpu
spec:
  scaleTargetRef:
    apiVersion: apps/v1       # must match the deployment's apiVersion
    kind: Deployment
    name: nginx-deploy        # must match the deployment name exactly
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50   # scale out when average CPU > 50%
```

**Key YAML Fields:**
- `scaleTargetRef` — identifies which Deployment to scale
- `minReplicas` — HPA will never scale below this count
- `maxReplicas` — HPA will never scale above this count
- `averageUtilization` — target percentage of `requests.cpu`

```bash
kubectl apply -f hpa-cpu-v2.yaml
kubectl get hpa nginx-hpa-cpu
```

**Expected output:**
```
NAME            REFERENCE                 TARGETS   MINPODS   MAXPODS   REPLICAS
nginx-hpa-cpu   Deployment/nginx-deploy   0%/50%    1         5         1
```

Confirm it is using `autoscaling/v2`:

```bash
kubectl get hpa nginx-hpa-cpu -o yaml | grep apiVersion
```

**Expected output:**
```
apiVersion: autoscaling/v2
```

**Cleanup:**
```bash
kubectl delete -f hpa-cpu-v2.yaml
```

---

### Step 5: Generate Load and Observe HPA Scaling

Apply the CPU HPA again and generate HTTP load to trigger scaling:

```bash
kubectl apply -f hpa-cpu-v2.yaml
```

In a **second terminal**, watch HPA in real time:

```bash
kubectl get hpa nginx-hpa-cpu -w
```

Back in the first terminal, start the load generator:

**load-generator.yaml:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: load-generator
spec:
  terminationGracePeriodSeconds: 0
  containers:
    - name: load
      image: busybox
      command:
        - sh
        - -c
        - |
          while true; do
            wget -q -O- http://nginx-svc
            done
```

```bash
kubectl apply -f load-generator.yaml
```

Watch the second terminal — within 30-60 seconds you will see:

**Expected output in watch terminal:**
```
NAME            REFERENCE                 TARGETS    MINPODS   MAXPODS   REPLICAS
nginx-hpa-cpu   Deployment/nginx-deploy   0%/50%     1         5         1
nginx-hpa-cpu   Deployment/nginx-deploy   45%/50%    1         5         1
nginx-hpa-cpu   Deployment/nginx-deploy   112%/50%   1         5         1
nginx-hpa-cpu   Deployment/nginx-deploy   112%/50%   1         5         3
nginx-hpa-cpu   Deployment/nginx-deploy   78%/50%    1         5         3
nginx-hpa-cpu   Deployment/nginx-deploy   62%/50%    1         5         4
nginx-hpa-cpu   Deployment/nginx-deploy   48%/50%    1         5         4
```

Verify scaling events:

```bash
kubectl describe hpa nginx-hpa-cpu | grep -A10 Events
```

**Expected output:**
```
Events:
  Normal  SuccessfulRescale  ...  New size: 3; reason: cpu resource utilization
                                  (percentage of request) above target
  Normal  SuccessfulRescale  ...  New size: 4; reason: cpu resource utilization
                                  (percentage of request) above target
```

**Verify the scaling formula with live numbers:**

When TARGETS shows `112%/50%` with 1 replica:
```
desiredReplicas = ceil[ 1 × (112 / 50) ]
               = ceil[ 2.24 ]
               = 3
```

When TARGETS shows `78%/50%` with 3 replicas:
```
desiredReplicas = ceil[ 3 × (78 / 50) ]
               = ceil[ 4.68 ]
               = 5   ← but capped at maxReplicas=5
```

Stop the load generator and observe scale-down:

```bash
kubectl delete -f load-generator.yaml
kubectl get hpa nginx-hpa-cpu -w
```

**Expected output (scale-down is slow — wait 5+ minutes):**
```
nginx-hpa-cpu   Deployment/nginx-deploy   0%/50%    1         5         4
nginx-hpa-cpu   Deployment/nginx-deploy   0%/50%    1         5         4
# ... stays at 4 for ~5 minutes (stabilisation window)
nginx-hpa-cpu   Deployment/nginx-deploy   0%/50%    1         5         1
```

> Scale-down takes 5 minutes by default. This is intentional — prevents
> rapid scale-in/out cycles (pod thrashing) from brief metric fluctuations.

**Cleanup:**
```bash
kubectl delete -f hpa-cpu-v2.yaml
```

---

### Step 6: HPA — Memory Based (autoscaling/v2)

Memory-based HPA is only available in `autoscaling/v2`. This is one of
the key reasons `v1` is deprecated.

**hpa-memory-v2.yaml:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa-memory
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deploy
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 70   # scale out when average memory > 70%
```

```bash
kubectl apply -f hpa-memory-v2.yaml
kubectl get hpa nginx-hpa-memory
```

**Expected output:**
```
NAME               REFERENCE                 TARGETS   MINPODS   MAXPODS   REPLICAS
nginx-hpa-memory   Deployment/nginx-deploy   15%/70%   1         5         1
```

Memory utilisation is currently ~15% (128Mi request, ~20Mi actual for
idle nginx). HPA holds at 1 replica — within target.

**Cleanup:**
```bash
kubectl delete -f hpa-memory-v2.yaml
```

---

### Step 7: HPA — Multiple Metrics

When multiple metrics are defined, HPA calculates the desired replica
count for **each metric independently** and uses the **highest** result.

**hpa-multi-metric.yaml:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa-multi
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deploy
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 70
  # HPA uses whichever metric requires MORE replicas
  # CPU at 90% → needs 2 replicas
  # Memory at 85% → needs 2 replicas
  # → HPA scales to 2 (both agree)
  # CPU at 90% → needs 2 replicas
  # Memory at 30% → needs 1 replica
  # → HPA scales to 2 (CPU wins — highest wins)
```

```bash
kubectl apply -f hpa-multi-metric.yaml
kubectl describe hpa nginx-hpa-multi | grep -A5 "Metrics:"
```

**Expected output:**
```
Metrics:                                             ( current / target )
  resource cpu on pods  (as a percentage of request):  0% (0) / 50%
  resource memory on pods  (as a percentage of request):  15% / 70%
```

**Cleanup:**
```bash
kubectl delete -f hpa-multi-metric.yaml
```

---

### Step 8: HPA Behaviour — Custom Scale-Down

The default 5-minute scale-down window can be tuned. This is useful
in production when you need faster scale-in (cost saving) or slower
scale-in (stability).

**hpa-behaviour.yaml:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa-behaviour
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deploy
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 60    # scale down after 60s (not default 300s)
      policies:
        - type: Pods
          value: 2                       # remove at most 2 pods per minute
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0     # scale up immediately (no delay)
      policies:
        - type: Pods
          value: 4                       # add at most 4 pods per 15 seconds
          periodSeconds: 15
```

```bash
kubectl apply -f hpa-behaviour.yaml
```

Apply load and then stop it — compare scale-down speed with the
default 5-minute window from Step 5:

```bash
kubectl apply -f load-generator.yaml
# Wait for scale-out, then:
kubectl delete -f load-generator.yaml
kubectl get hpa nginx-hpa-behaviour -w
# Scale-down should happen within ~60-90 seconds instead of 5 minutes
```

**Cleanup:**
```bash
kubectl delete -f hpa-behaviour.yaml
kubectl delete -f nginx-deploy.yaml
```

---

### Step 9: Install VPA

VPA is a separate project. Install it from the official autoscaler repo:

```bash
git clone https://github.com/kubernetes/autoscaler.git
cd autoscaler/vertical-pod-autoscaler
./hack/vpa-up.sh
```

**Expected output (last few lines):**
```
customresourcedefinition.apiextensions.k8s.io/verticalpodautoscalers.autoscaling.k8s.io created
customresourcedefinition.apiextensions.k8s.io/verticalpodautoscalercheckpoints.autoscaling.k8s.io created
...
deployment.apps/vpa-admission-controller created
deployment.apps/vpa-recommender created
deployment.apps/vpa-updater created
```

Verify the three VPA components are running:

```bash
kubectl get pods -n kube-system | grep vpa
```

**Expected output:**
```
vpa-admission-controller-xxxxxxxxx-aaaaa   1/1   Running   0   30s
vpa-recommender-xxxxxxxxx-bbbbb            1/1   Running   0   30s
vpa-updater-xxxxxxxxx-ccccc                1/1   Running   0   30s
```

Confirm VPA CRDs are installed:

```bash
kubectl api-resources | grep verticalpod
```

**Expected output:**
```
verticalpodautoscalercheckpoints   vpacheckpoint   autoscaling.k8s.io/v1   true   VerticalPodAutoscalerCheckpoint
verticalpodautoscalers             vpa             autoscaling.k8s.io/v1   true   VerticalPodAutoscaler
```

> **Minikube note:** VPA Admission Controller uses a mutating webhook.
> If pods fail to start due to webhook errors, you can run the demo
> without Admission Controller — `Off` mode (Recommender only) still
> works fully.

---

### Step 10: VPA — Off Mode (Recommendations Only)

`Off` mode is the safest and most practical production starting point.
VPA analyses usage and provides recommendations without modifying any pods.

First redeploy the target application:

```bash
cd ../src
kubectl apply -f nginx-deploy.yaml
kubectl get pods
```

**vpa-off.yaml:**
```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: nginx-vpa-off
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deploy
  updatePolicy:
    updateMode: "Off"       # recommend only — never modify pods
  resourcePolicy:
    containerPolicies:
      - containerName: nginx
        minAllowed:
          cpu: "50m"
          memory: "64Mi"
        maxAllowed:
          cpu: "2"
          memory: "2Gi"
```

**Key YAML Fields:**
- `targetRef` — identifies the Deployment to analyse
- `updateMode: "Off"` — VPA only recommends, never evicts or modifies
- `resourcePolicy.containerPolicies` — bounds for VPA recommendations
- `minAllowed` — VPA will not recommend below this
- `maxAllowed` — VPA will not recommend above this

```bash
kubectl apply -f vpa-off.yaml
kubectl get vpa nginx-vpa-off
```

**Expected output:**
```
NAME             MODE   CPU   MEM    PROVIDED   AGE
nginx-vpa-off    Off    50m   64Mi   False      10s
```

`PROVIDED: False` means VPA has not yet generated recommendations.
Wait 2-3 minutes for the Recommender to analyse pod usage, then:

```bash
kubectl describe vpa nginx-vpa-off
```

**Expected output (Recommendation section):**
```
  Recommendation:
    Container Recommendations:
      Container Name:  nginx
      Lower Bound:
        Cpu:     25m
        Memory:  262144k
      Target:
        Cpu:     25m
        Memory:  262144k
      Uncapped Target:
        Cpu:     25m
        Memory:  262144k
      Upper Bound:
        Cpu:     597m
        Memory:  928302k
```

**What each recommendation means:**

| Field | Meaning | How to use |
|---|---|---|
| `Lower Bound` | Minimum safe allocation | Never set requests below this |
| `Target` | Optimal allocation — set this as your `requests` | Apply as `requests` |
| `Upper Bound` | Maximum VPA thinks you might need | Do NOT use as `limits` — often over-estimated |

> **Production pattern:** Take `Target` values and add 20-30% buffer
> for `limits`. Apply `Target` directly as `requests`. Do not use
> `Upper Bound` for limits — it is routinely overestimated.

**Cleanup:**
```bash
kubectl delete -f vpa-off.yaml
```

---

### Step 11: VPA — Auto Mode (Live Right-Sizing)

`Auto` mode continuously analyses and adjusts. The Updater evicts pods
that need resource changes. The Admission Controller sets correct values
when the pod is recreated.

**vpa-auto.yaml:**
```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: nginx-vpa-auto
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deploy
  updatePolicy:
    updateMode: "Auto"      # continuously update — evict and recreate pods
  resourcePolicy:
    containerPolicies:
      - containerName: nginx
        minAllowed:
          cpu: "50m"
          memory: "64Mi"
        maxAllowed:
          cpu: "1"
          memory: "1Gi"
```

```bash
kubectl apply -f vpa-auto.yaml
```

Note the current pod name and its resource requests before VPA acts:

```bash
kubectl get pods
kubectl describe pod <pod-name> | grep -A6 "Requests:"
```

**Expected output (current — what you set in nginx-deploy.yaml):**
```
    Requests:
      cpu:     100m
      memory:  128Mi
```

Wait 2-5 minutes for VPA Updater to act. Watch for pod eviction and
recreation:

```bash
kubectl get pods -w
```

**Expected output:**
```
NAME                            READY   STATUS    RESTARTS
nginx-deploy-xxxxxxxxx-aaaaa    1/1     Running   0
nginx-deploy-xxxxxxxxx-aaaaa    1/1     Terminating   0    ← evicted by VPA Updater
nginx-deploy-xxxxxxxxx-bbbbb    0/1     Pending       0    ← new pod being created
nginx-deploy-xxxxxxxxx-bbbbb    1/1     Running       0    ← running with new resources
```

Inspect the new pod's resource requests:

```bash
kubectl describe pod <new-pod-name> | grep -A6 "Requests:"
```

**Expected output (VPA has right-sized the pod):**
```
    Requests:
      cpu:     25m         ← reduced from 100m — VPA target recommendation
      memory:  262144k     ← set by VPA Admission Controller at pod creation
```

VPA reduced the CPU request from 100m to 25m because an idle nginx
container uses far less CPU than the 100m we originally allocated.

**Cleanup:**
```bash
kubectl delete -f vpa-auto.yaml
kubectl delete -f nginx-deploy.yaml
```

---

### Step 12: VPA + HPA Conflict Demo

Demonstrating that using both VPA and HPA on CPU/memory simultaneously
causes unpredictable behaviour.

```bash
kubectl apply -f nginx-deploy.yaml
kubectl apply -f hpa-cpu-v2.yaml
kubectl apply -f vpa-auto.yaml
```

**Expected output after a few minutes:**

```bash
kubectl get hpa nginx-hpa-cpu
kubectl get vpa nginx-vpa-auto
kubectl describe hpa nginx-hpa-cpu | grep -A5 Events
```

Both controllers are competing:
- HPA is adjusting replica count based on CPU utilisation percentage
- VPA is changing CPU requests — which directly changes the utilisation
  percentage that HPA is watching
- HPA recalculates based on new requests → different replica count
- VPA adjusts again → HPA recalculates again → loop

> This is the VPA + HPA conflict. There is no error message — it is
> a silent behavioural problem that causes unstable, unpredictable
> replica counts.

**The safe pattern:**

```
Option 1: HPA (CPU/memory) + VPA (Off mode for recommendations)
Option 2: HPA (custom metrics like HTTP RPS) + VPA (Auto for CPU/memory)
Option 3: HPA only — skip VPA, set requests manually from observability data
```

**Cleanup:**
```bash
kubectl delete -f vpa-auto.yaml
kubectl delete -f hpa-cpu-v2.yaml
kubectl delete -f nginx-deploy.yaml
```

---

### Step 13: Final Cleanup

```bash
# Remove all HPAs and VPAs
kubectl delete hpa --all
kubectl delete vpa --all

# Remove all deployments, pods, services
kubectl delete deployment --all
kubectl delete pod --all
kubectl delete service nginx-svc

# Verify clean state
kubectl get all
kubectl get hpa
kubectl get vpa

# Optionally disable metrics server if no longer needed
# minikube addons disable metrics-server -p 3node
```

---

## Experiments to Try

1. **Verify the scaling formula with live numbers:**
   ```bash
   # While load is running, note exact TARGETS value and current REPLICAS
   kubectl get hpa nginx-hpa-cpu
   # TARGETS: 87%/50%, REPLICAS: 2
   # Expected: ceil[2 × (87/50)] = ceil[3.48] = 4
   # Watch and confirm HPA scales to 4
   ```

2. **HPA with requests not set — observe `<unknown>` target:**
   ```bash
   # Edit nginx-deploy.yaml, remove the resources: section
   # Apply it, then create the HPA
   # kubectl get hpa → TARGETS shows <unknown>/50%
   # HPA cannot calculate utilisation without requests defined
   ```

3. **VPA with multiple containers:**
   ```yaml
   resourcePolicy:
     containerPolicies:
       - containerName: nginx      # main container
         minAllowed: {cpu: 50m}
       - containerName: sidecar    # sidecar container
         minAllowed: {cpu: 10m}
   # VPA generates separate recommendations per container
   ```

4. **Test VPA respects PodDisruptionBudget:**
   ```bash
   # Create a PDB requiring minimum 1 available replica
   kubectl create pdb nginx-pdb --selector=app=nginx --min-available=1
   # Scale nginx-deploy to 1 replica
   # VPA Updater will not evict — doing so would violate PDB
   kubectl describe vpa nginx-vpa-auto | grep -i "unable\|pdb\|disruption"
   ```

---

## Common Questions

### Q: Why does `TARGETS` show `<unknown>` after creating HPA?

**A:** Two possible causes. First — metrics server has not yet collected
data for the pod (wait 30-60 seconds). Second — `resources.requests` is
not defined on the target pods. HPA calculates utilisation as actual
usage divided by request. Without a request value, the percentage cannot
be calculated. Always define `resources.requests` on HPA target pods.

### Q: Can HPA scale a Deployment to zero replicas?

**A:** No. HPA enforces a minimum of 1 replica (`minReplicas` defaults to
1 and cannot be set to 0). For scale-to-zero capability, use KEDA which
extends Kubernetes with event-driven scaling and supports 0 as a minimum.

### Q: Why is VPA's `Upper Bound` so high?

**A:** The Upper Bound is VPA's conservative estimate of peak usage. It
is calculated from historical usage with a large safety margin. In
practice it is almost always an overestimate. Never use Upper Bound
as your limits value — use Target plus a 20-30% buffer instead.

### Q: Does VPA work with Deployments that have multiple replicas?

**A:** Yes, but VPA applies the same resource values to all replicas.
It does not size replicas differently. The Updater evicts pods one at a
time (respecting PDB) to apply updated resources.

---

## What You Learned

In this lab, you:
- ✅ Created HPA using both imperative (`autoscaling/v1`) and declarative
  (`autoscaling/v2`) approaches
- ✅ Verified the HPA scaling formula with live metric values
- ✅ Wrote HPA manifests for CPU, memory, and multiple metrics
- ✅ Configured custom scale-down behaviour to reduce stabilisation window
- ✅ Installed VPA and identified its three components
- ✅ Used VPA `Off` mode to collect right-sizing recommendations
- ✅ Used VPA `Auto` mode and observed automatic pod right-sizing
- ✅ Demonstrated the VPA + HPA conflict and the safe usage pattern

**Key Takeaway:** Always use `autoscaling/v2` for HPA — `v1` is deprecated
and supports CPU only. Define `resources.requests` on all HPA target pods
or utilisation will show `<unknown>`. VPA is powerful for right-sizing but
requires careful use — `Off` mode is the safest production starting point.
Never run VPA `Auto` and HPA on CPU/memory for the same Deployment
simultaneously.

---

## Quick Commands Reference

| Command | Description |
|---|---|
| `kubectl autoscale deployment <n> --min=1 --max=10 --cpu-percent=50` | Create HPA imperatively (v1) |
| `kubectl get hpa` | List all HPA objects |
| `kubectl get hpa <n> -w` | Watch HPA metrics and replica changes live |
| `kubectl describe hpa <n>` | Show HPA details and scaling events |
| `kubectl delete hpa <n>` | Delete an HPA |
| `kubectl get vpa` | List all VPA objects (requires VPA installed) |
| `kubectl describe vpa <n>` | Show VPA recommendations |
| `kubectl api-resources \| grep verticalpod` | Verify VPA CRDs are installed |
| `minikube addons enable metrics-server -p 3node` | Enable metrics server |

---

## CKA Certification Tips

✅ **Always use `autoscaling/v2` — never v1:**
```yaml
apiVersion: autoscaling/v2    # ← correct
kind: HorizontalPodAutoscaler
```

✅ **`scaleTargetRef` must be exact — common source of exam errors:**
```yaml
scaleTargetRef:
  apiVersion: apps/v1       # must be apps/v1 for Deployments
  kind: Deployment
  name: my-deploy           # must match deployment name exactly
```

✅ **`resources.requests` must be defined on target pods:**
```yaml
# Without this, kubectl get hpa shows <unknown>/50% and HPA never scales
resources:
  requests:
    cpu: "100m"
```

✅ **Generate HPA YAML fast in exam:**
```bash
# Create imperative first, then export and convert to v2
kubectl autoscale deployment my-deploy --min=1 --max=10 --cpu-percent=50 \
  --dry-run=client -o yaml > hpa.yaml
# Edit apiVersion to autoscaling/v2 and adjust metrics block
```

✅ **HPA formula — know it:**
```
desiredReplicas = ceil[ currentReplicas × (current% / target%) ]
```

✅ **Scale-down is slow by default — 5 minutes:**
```yaml
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300   # default — change to tune
```

---

## Troubleshooting

**HPA shows `<unknown>` in TARGETS:**
```bash
# Check 1: metrics server running?
kubectl get pods -n kube-system | grep metrics-server
# Check 2: requests defined on target pods?
kubectl describe pod <target-pod> | grep -A4 Requests
# Check 3: wait 60 seconds — metrics take time to populate
```

**VPA not generating recommendations:**
```bash
# Check VPA components are running
kubectl get pods -n kube-system | grep vpa
# Check VPA object status
kubectl describe vpa <n>
# Recommender needs a few minutes of pod metrics history
```

**Pods not scaling out despite high CPU:**
```bash
# Check HPA events
kubectl describe hpa <n> | grep -A10 Events
# Check if maxReplicas is already reached
kubectl get hpa <n>
# Check if requests are defined
kubectl describe deployment <n> | grep -A4 Requests
```

**General debugging:**
```bash
kubectl describe hpa <n>                        # scaling events and current state
kubectl get events --sort-by='.lastTimestamp'   # cluster-wide events
kubectl top pods                                # current actual usage
```
