# eBeeControl — System Architecture

## Executive Summary

eBeeControl is an autonomous deception engine that protects Kubernetes clusters by deploying honeytokens (decoy secrets, files, and credentials), detecting when attackers access them, and responding automatically — all without human intervention.

The system combines five technologies:
- **Gemini AI** for intelligent decision-making
- **eBPF (Tetragon)** for kernel-level detection
- **[Koney](https://github.com/dynatrace-oss/koney)** (Dynatrace OSS) — Kubernetes operator for automated honeytoken deployment, rotation, and monitoring via DeceptionPolicy CRDs
- **Dynatrace** for observability and context
- **Gemini Enterprise Agent Platform** for adaptive learning

---

## How It Works (The 7-Step Cycle)

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │   1. DISCOVER ──→ 2. DEPLOY ──→ 3. DETECT             │
    │        ↑                              │                 │
    │        │                              ↓                 │
    │   7. LEARN ←── 6. REPORT ←── 5. RESPOND ←── 4. ASSESS │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```

| Step | What Happens | Component | Time |
|------|-------------|-----------|------|
| 1. Discover | Query Dynatrace for high-risk services | Dynatrace MCP Server | Every 60 min |
| 2. Deploy | Place honeytokens in vulnerable pods | Koney + K8s API | < 30 sec |
| 3. Detect | eBPF kernel probe fires on file access | Tetragon | < 1 sec |
| 4. Assess | Query context, classify threat level | Gemini + Dynatrace | < 5 sec |
| 5. Respond | Isolate pod, block IP, deploy more traps | K8s NetworkPolicy | < 10 sec |
| 6. Report | Generate forensic report | Gemini AI | < 60 sec |
| 7. Learn | Submit outcome, retrain model | Gemini Enterprise Agent Platform | Async |

**Total time from detection to containment: < 15 seconds**

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         eBeeControl Agent                                │
│                    (Node.js / TypeScript / GKE)                          │
│                                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Orchestrator│  │   Threat     │  │  Response   │  │  Learning   │  │
│  │  (Discovery │  │  Classifier  │  │  Executor   │  │  Feedback   │  │
│  │   Cycle)    │  │  (4 levels)  │  │  (3 actions)│  │  Loop       │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘  └──────┬──────┘  │
│         │                │                  │                │          │
│  ┌──────┴──────┐  ┌──────┴───────┐  ┌──────┴──────┐  ┌──────┴──────┐  │
│  │  Honeytoken │  │   Report     │  │   Audit     │  │   Health    │  │
│  │  Registry   │  │  Generator   │  │    Log      │  │  Monitor    │  │
│  └─────────────┘  └──────────────┘  └─────────────┘  └─────────────┘  │
└────────┬──────────────────┬──────────────────┬──────────────────┬───────┘
         │                  │                  │                  │
    ┌────▼────┐       ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
    │Dynatrace│       │  Koney  │       │Tetragon │       │Gemini Enterprise Agent Platform│
    │MCP Server│       │Deployer │       │ Monitor │       │ Trainer │
    │         │       │  (K8s)  │       │ (eBPF)  │       │         │
    └────┬────┘       └────┬────┘       └────┬────┘       └────┬────┘
         │                  │                  │                  │
    ┌────▼────────────────▼──────────────────▼──────────────────▼────┐
    │                    Kubernetes Cluster                            │
    │  ┌─────┐  ┌─────┐  ┌─────┐  ┌──────────────┐  ┌───────────┐  │
    │  │Pod A│  │Pod B│  │Pod C│  │NetworkPolicies│  │  Secrets  │  │
    │  │ 🍯  │  │ 🍯  │  │ 🍯  │  │              │  │  (decoys) │  │
    │  └─────┘  └─────┘  └─────┘  └──────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────┘
         │
    ┌────▼──────────────────────────────────────────────────────────┐
    │                    Dynatrace Platform                          │
    │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
    │  │ Metrics  │  │   Logs   │  │Dashboard │  │  Davis AI   │  │
    │  │  API     │  │   API    │  │  (Tiles) │  │  (Anomaly)  │  │
    │  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
    └───────────────────────────────────────────────────────────────┘
```

---

## Component Interactions

### 1. Discovery Flow

```
Orchestrator ──(every 60 min)──→ Dynatrace MCP Server
                                        │
                                        ▼
                                 "Which services are high-risk?"
                                        │
                                        ▼
                                 Returns: service list with risk scores
                                        │
                                        ▼
Orchestrator ──(rank by score)──→ Select top targets
                                        │
                                        ▼
Deployment Orchestrator ──→ Koney Deployer ──→ K8s API (create Secrets)
                                        │
                                        ▼
                              Registry updated + Tetragon paths registered
                                        │
                                        ▼
                              Dynatrace Ingestion (broadcast registry change)
```

### 2. Detection & Response Flow

```
Attacker reads honeytoken file
         │
         ▼
Tetragon eBPF probe fires (< 1 sec)
         │
         ▼
Access Event generated (processId, binary, userId, pod, path, type)
         │
         ▼
Event forwarded to Dynatrace MCP Server (< 2 sec)
         │
         ▼
Agent receives event via subscription
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│ THREAT ASSESSMENT (< 5 sec total)                       │
│                                                         │
│  1. Query Dynatrace for pod context (3 sec timeout)     │
│  2. Get: namespace, criticality, anomaly score          │
│  3. Classify: low / medium / high / critical            │
│  4. If timeout → default to HIGH                        │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│ AUTONOMOUS RESPONSE (< 10 sec)                          │
│                                                         │
│  HIGH/CRITICAL:                                         │
│    • Pod isolation (NetworkPolicy deny-all)             │
│    • IP block (ingress deny)                            │
│    • Deploy 2+ additional honeytokens                   │
│                                                         │
│  MEDIUM:                                                │
│    • Deploy 2+ additional honeytokens                   │
│                                                         │
│  LOW:                                                   │
│    • No action (log only)                               │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│ FORENSIC REPORT (< 60 sec)                              │
│                                                         │
│  Gemini generates:                                      │
│    • Access event details                               │
│    • Contextual assessment                              │
│    • Response actions taken                             │
│    • Chronological timeline                             │
│    • Recommended follow-up actions                      │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│ ADAPTIVE LEARNING (async)                               │
│                                                         │
│  1. Submit outcome to Gemini Enterprise Agent Platform                         │
│  2. Include: detection latency, containment success,    │
│     false positive determination                        │
│  3. Model retrains every 24h (if 50+ records)           │
│  4. New model published only if accuracy improves       │
└─────────────────────────────────────────────────────────┘
         │
         ▼
All events broadcast to Dynatrace Dashboard (real-time)
```

### 3. Health Monitoring Flow

```
Health Monitor (every 30 sec)
         │
         ├──→ Check Tetragon Monitor (10 sec timeout)
         ├──→ Check Koney Deployer (10 sec timeout)
         ├──→ Check Dynatrace MCP Server (10 sec timeout)
         └──→ Check Gemini Enterprise Agent Platform Trainer (10 sec timeout)
                  │
                  ▼
         Component unhealthy?
                  │
            ┌─────┴─────┐
            │ YES        │ NO
            ▼            ▼
     Retry 3x at 20s    Mark healthy
            │
            ▼
     Still unhealthy?
            │
      ┌─────┴─────┐
      │ YES        │ NO
      ▼            ▼
  Mark DEGRADED   Mark healthy
  Send escalation  (recovered)
  alert
  Continue with
  healthy components
```

---

## Data Flow to Dynatrace

All operational data is pushed to Dynatrace via two APIs:

### Metrics API (numeric state)
- Honeytoken registry status (active/triggered/expired counts)
- Component health status
- Model accuracy and training dataset size

### Log Ingestion API (structured events)
- Access events (with threat classification)
- Response actions (with outcomes)
- Forensic reports (full JSON)
- Incident timeline entries
- Learning metrics updates

```
Agent ──→ Event Broadcaster ──→ Metrics Client ──→ Dynatrace Metrics API
                             └──→ Log Client ────→ Dynatrace Log Ingestion API
                                                          │
                                                          ▼
                                                   Dynatrace Dashboard
                                                   (DQL queries on tiles)
```

---

## Threat Classification Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLASSIFICATION RULES                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CRITICAL: production AND (anomaly > 0.8 OR criticality = 5)    │
│                                                                 │
│  HIGH:     production AND (anomaly 0.6-0.8 OR criticality = 4)  │
│                                                                 │
│  MEDIUM:   production OR anomaly 0.3-0.6 OR criticality = 3     │
│                                                                 │
│  LOW:      non-production AND anomaly < 0.3 AND criticality ≤ 2 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  MISSING DATA → assume worst case:                              │
│    namespace → production                                       │
│    criticality → 5                                              │
│    anomaly → 1.0                                                │
├─────────────────────────────────────────────────────────────────┤
│  TIMEOUT (> 3 sec) → classify as HIGH                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Retry & Error Handling

| Operation | Strategy | Max Retries | Interval | On Exhaustion |
|-----------|----------|-------------|----------|---------------|
| Dynatrace discovery | Exponential backoff | 5 | 2s, 4s, 8s, 16s, 32s | Abort cycle |
| Dynatrace context | No retry | 0 | — | Default to HIGH |
| Pod isolation | Fixed interval | 3 | 5s | Critical alert |
| IP block | Fixed interval | 3 | 5s | Alert |
| Tetragon forwarding | Fixed interval | 5 | 10s | Buffer (max 1000) |
| Forensic report | Fixed interval | 3 | 10s | Log failure |
| Dynatrace ingestion | Exponential backoff | 5 | 2s, 4s, 8s, 16s, 32s | Discard batch |
| Component health | Fixed interval | 3 | 20s | Mark degraded |

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Google Cloud Platform                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    GKE Cluster                              │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  ebeecontrol namespace                               │  │  │
│  │  │                                                      │  │  │
│  │  │  ┌─────────────────┐  ┌───────────┐  ┌──────────┐  │  │  │
│  │  │  │ ebeecontrol pod │  │ ConfigMap │  │  Secret  │  │  │  │
│  │  │  │ (Node.js agent) │  │ (config)  │  │ (DT key) │  │  │  │
│  │  │  └─────────────────┘  └───────────┘  └──────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  kube-system namespace                               │  │  │
│  │  │                                                      │  │  │
│  │  │  ┌─────────────────┐  ┌──────────────────────────┐  │  │  │
│  │  │  │ Tetragon        │  │ TracingPolicy            │  │  │  │
│  │  │  │ (DaemonSet)     │  │ (honeytoken-monitor)     │  │  │  │
│  │  │  └─────────────────┘  └──────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Target namespaces (production, staging, etc.)       │  │  │
│  │  │                                                      │  │  │
│  │  │  ┌─────┐  ┌─────┐  ┌─────┐  ┌────────────────┐    │  │  │
│  │  │  │Pod 🍯│  │Pod 🍯│  │Pod 🍯│  │ NetworkPolicies│    │  │  │
│  │  │  └─────┘  └─────┘  └─────┘  │ (isolation)    │    │  │  │
│  │  │                              └────────────────┘    │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Container    │  │  Gemini Enterprise Agent Platform   │  │  Cloud IAM           │  │
│  │ Registry     │  │  (Training)  │  │  (Workload Identity) │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Dynatrace SaaS                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Metrics  │  │   Logs   │  │Dashboard │  │ Davis AI      │  │
│  │  API v2  │  │  Ingest  │  │  (Tiles) │  │ (Anomaly Det.)│  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Language | TypeScript (strict) | Type-safe implementation |
| Runtime | Node.js 20 | Application runtime |
| Container | Docker (Alpine) | Lightweight deployment |
| Orchestration | Kubernetes (GKE) | Container management |
| Infrastructure | Terraform | Infrastructure as Code |
| CI/CD | GitHub Actions | Automated pipeline |
| Packaging | Helm | Kubernetes deployment |
| Detection | Cilium Tetragon (eBPF) | Kernel-level file monitoring |
| AI/ML | Google Gemini (Gemini Enterprise Agent Platform) | Report generation + placement model |
| Observability | Dynatrace | Context, anomaly detection, dashboard |
| Testing | Vitest + fast-check | 728 tests, 24 property-based |

---

## Security Properties (Formally Verified)

The system has 24 correctness properties validated with property-based testing:

| # | Property | What it guarantees |
|---|----------|-------------------|
| 1 | Exponential Backoff | Retry delays follow 2^(n+1) sequence exactly |
| 2 | Service Ranking | Services always sorted by risk score, alphabetical tiebreak |
| 3 | Deployment Count | Always 1-5 honeytokens per pod |
| 4 | Deployment Report | All required fields present in every report |
| 5 | Error Response | Every failure includes remediation actions |
| 6 | Registry Consistency | Registry always matches deployment state |
| 7 | Access Event Fields | Every event has all required fields |
| 8 | Buffer Retry | Never more than 5 retries per event |
| 9 | Bounded Buffer | Buffer never exceeds 1000 events |
| 10 | Threat Classification | Classification always matches the defined rules |
| 11 | Response Escalation | Medium+ threats always get additional honeytokens |
| 12 | Report Completeness | Every report has all required sections |
| 13 | Report Uniqueness | All report IDs are unique |
| 14 | Outcome Ingestion | Dataset count increments by exactly 1 |
| 15 | Model Publish Guard | New model only published if accuracy improves |
| 16 | Discovery Scheduling | Cycle only starts if interval elapsed AND previous complete |
| 17 | Health Status | Unhealthy iff error OR timeout > 10s |
| 18 | Audit Log | Every decision logged with all required fields |
| 19 | Event Feed Capacity | Feed never exceeds 1000, newest first |
| 20 | Report Search | Results always match search criteria |
| 21 | Timeline Filter | Results always match ALL filter criteria |
| 22 | Health Indicators | Each status has a distinct visual indicator |
| 23 | Empty State Messages | Every section has a non-empty message |
| 24 | Response Actions View | Every action has all required display fields |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Gemini as orchestrator | Nuanced reasoning about threat context vs static rules |
| eBPF for detection | Kernel-level visibility, cannot be evaded by userspace |
| Dynatrace for context | Leverages existing observability, no duplicate infrastructure |
| Dynatrace-native dashboard | No custom UI to maintain, team already uses Dynatrace |
| Gemini Enterprise Agent Platform for learning | Placement model improves over time without manual policy updates |
| Event-driven + periodic | Detection is instant (event-driven), discovery is scheduled |
| Assume worst case on missing data | Threats never under-classified due to missing context |
| Property-based testing | Formal correctness guarantees, not just example-based tests |

---

## Running the System

### Local Demo (no cluster needed)
```bash
npm run demo          # Console output showing full cycle
npm run demo:live     # Pushes real data to Dynatrace
```

### Production (GKE)
```bash
cd terraform && terraform apply    # Create infrastructure
docker buildx build --platform=linux/amd64 --output type=docker -t gcr.io/ebeecontrol/ebeecontrol:latest .
docker push gcr.io/ebeecontrol/ebeecontrol:latest
helm upgrade --install ebeecontrol ./helm/ebeecontrol -n ebeecontrol
```

### Destroy
```bash
cd terraform && terraform destroy
```

---

Made with ❤️ by Alex
