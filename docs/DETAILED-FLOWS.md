# eBeeControl — Detailed System Flows

## Overview

This document provides a deep-dive into every flow in the eBeeControl autonomous deception engine. Each section covers the exact sequence of operations, the technologies involved, timing constraints, error handling, and how data flows between components.

---

## Flow 1: Discovery & Deployment

### Purpose
Find high-risk services in the Kubernetes cluster and deploy honeytokens (decoy secrets, files, credentials) into vulnerable pods.

### Trigger
- Runs automatically every **60 minutes** (configurable: 5-1440 min)
- Skips if the previous cycle hasn't completed

### Sequence of Operations

```
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: Query Dynatrace for High-Risk Services                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Agent ──HTTP GET──→ Dynatrace MCP Server                           │
│         /api/v1/services/high-risk                                  │
│                                                                     │
│  Timeout: 30 seconds                                                │
│  Retry: Exponential backoff (2s, 4s, 8s, 16s, 32s) — max 5 retries │
│                                                                     │
│  Response: [                                                        │
│    { serviceId, serviceName, namespace, podIdentifiers, riskScore }  │
│  ]                                                                  │
│                                                                     │
│  If empty → log "no high-risk services found", skip cycle           │
│  If all retries fail → log critical failure, abort cycle            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: Rank Services by Risk Score                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Sort descending by riskScore (0-100)                               │
│  Tiebreaker: alphabetical by serviceName                            │
│                                                                     │
│  Example:                                                           │
│    payment-gateway (95) → auth-service (88) → user-data-api (72)    │
│                                                                     │
│  Technology: Pure function, no external calls                       │
│  Property tested: Property 2 (Service Ranking Order)                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: Deploy Honeytokens to Each Target Pod                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  For each service → for each pod in podIdentifiers:                 │
│                                                                     │
│  Agent ──→ Koney Deployer ──→ Kubernetes API                        │
│                                                                     │
│  Deploys 3 honeytokens per pod:                                     │
│    1. decoy_secret  → /var/run/secrets/.../decoy-token-{podId}      │
│    2. decoy_file    → /tmp/.config/credentials-{podId}.json         │
│    3. decoy_credential → /home/app/.ssh/id_rsa_{podId}              │
│                                                                     │
│  K8s API call: Creates a Secret resource with:                      │
│    - Labels: app.kubernetes.io/managed-by=ebeecontrol               │
│    - Annotations: ebeecontrol.io/placement, ebeecontrol.io/type     │
│    - Data: Base64-encoded decoy content                             │
│                                                                     │
│  Timing: Must complete within 30 seconds per pod                    │
│  Count: 1-5 honeytokens per pod (Property 3)                       │
│  On failure: Clean up partial deployments, return remediation actions│
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: Update Registry & Register with Tetragon                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  For each successfully deployed honeytoken:                         │
│                                                                     │
│  A) Update Honeytoken Registry (in-memory):                         │
│     { honeytokenId, podId, namespace, type, filePath,               │
│       deploymentTimestamp, status: "active", accessCount: 0 }       │
│                                                                     │
│  B) Register path with Tetragon Monitor:                            │
│     { podId, namespace, filePath, honeytokenId }                    │
│     → Tetragon attaches eBPF kprobe to this file path              │
│     → Detection begins within 30 seconds of registration           │
│                                                                     │
│  C) Broadcast to Dynatrace (via Log Ingestion API):                 │
│     → Honeytoken registry change event pushed                      │
│     → Dashboard "Active Honeytokens" tile updates                  │
│                                                                     │
│  D) Log to Audit Log:                                               │
│     { decisionType: "deployment", rationale, inputData, outcome }   │
└─────────────────────────────────────────────────────────────────────┘
```

### Technologies Involved

| Component | Technology | Role |
|-----------|-----------|------|
| Orchestrator | Node.js + setInterval | Schedules discovery cycles |
| Dynatrace MCP Server | REST API | Provides high-risk service data |
| Koney Deployer | @kubernetes/client-node | Creates K8s Secrets |
| Tetragon | eBPF TracingPolicy | Monitors deployed file paths |
| Registry | In-memory Map | Tracks all deployed honeytokens |
| Dynatrace Ingestion | REST API (Log Ingest) | Pushes events to dashboard |

### Error Scenarios

| Scenario | Handling |
|----------|----------|
| Dynatrace unreachable | Exponential backoff, 5 retries, abort on exhaustion |
| No high-risk services found | Log info, skip cycle gracefully |
| K8s Secret creation fails | Clean up partial deployments, return remediation actions |
| Previous cycle still running | Skip this cycle entirely |

---

## Flow 2: Detection & Response (The Attack Cycle)

### Purpose
Detect when an attacker accesses a honeytoken, classify the threat, and respond autonomously.

### Trigger
- **Event-driven** — fires immediately when a file access is detected
- No polling, no delay — eBPF kernel probe fires within 1 second

### Sequence of Operations

```
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: eBPF Kernel Probe Fires (Tetragon)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Attacker process reads/opens/stats a honeytoken file               │
│                                                                     │
│  Tetragon eBPF kprobe (fd_install / sys_read / sys_newstat) fires   │
│  within < 1 SECOND of the file operation                            │
│                                                                     │
│  Raw event captured:                                                │
│    - Process ID: 31337                                              │
│    - Binary: /tmp/.hidden/reverse-shell                             │
│    - User ID: 0 (root)                                              │
│    - Pod: pod-payment-7f8d9c                                        │
│    - Namespace: production                                          │
│    - File: /var/run/secrets/.../decoy-token                         │
│    - Operation: read                                                │
│    - Timestamp: 2026-05-29T01:04:08.732Z (millisecond precision)    │
│                                                                     │
│  Technology: Cilium Tetragon, eBPF kprobes                          │
│  Cannot be evaded by userspace techniques                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: Event Forwarding to Dynatrace                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Tetragon ──gRPC stream──→ Dynatrace MCP Server                    │
│                                                                     │
│  Must forward within 2 SECONDS of event generation                  │
│                                                                     │
│  On failure:                                                        │
│    - Buffer locally (circular buffer, max 1000 events)              │
│    - Retry at 10-second intervals, max 5 attempts                   │
│    - If buffer full: FIFO eviction (discard oldest)                 │
│    - Emit overflow warning on next successful connection            │
│                                                                     │
│  Technology: gRPC streaming, circular buffer                        │
│  Property tested: Property 8 (Buffer Retry), Property 9 (Bounded)  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: Threat Assessment (Gemini AI)                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Agent receives event via Dynatrace subscription                    │
│                                                                     │
│  A) Query Dynatrace for pod context (3-second timeout):             │
│     GET /api/v1/pods/{podId}/context?namespace={namespace}          │
│                                                                     │
│     Returns:                                                        │
│       namespaceClassification: "production" | "non-production"      │
│       serviceCriticality: 1-5 (5 = most critical)                   │
│       davisAnomalyScore: 0.0-1.0 (1.0 = highest anomaly)           │
│                                                                     │
│  B) Classify threat using rules:                                    │
│     ┌────────────┬──────────────────────────────────────────────┐   │
│     │ CRITICAL   │ production AND (anomaly > 0.8 OR crit = 5)   │   │
│     │ HIGH       │ production AND (anomaly 0.6-0.8 OR crit = 4) │   │
│     │ MEDIUM     │ production OR anomaly 0.3-0.6 OR crit = 3    │   │
│     │ LOW        │ non-prod AND anomaly < 0.3 AND crit ≤ 2      │   │
│     └────────────┴──────────────────────────────────────────────┘   │
│                                                                     │
│  C) On timeout (> 3s): Default to HIGH (assume worst case)          │
│  D) On missing fields: Use highest-risk defaults                    │
│     (production, criticality=5, anomaly=1.0)                        │
│                                                                     │
│  Must complete within 5 SECONDS total                               │
│  Technology: Dynatrace Davis AI, rule-based classifier              │
│  Property tested: Property 10 (Threat Classification Correctness)   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: Autonomous Response Execution                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Response plan generated based on classification:                   │
│                                                                     │
│  ┌─────────────┬────────────────────────────────────────────────┐   │
│  │ CRITICAL    │ Pod isolation + IP block + 2 more honeytokens   │   │
│  │ HIGH        │ Pod isolation + IP block + 2 more honeytokens   │   │
│  │ MEDIUM      │ 2 more honeytokens (no isolation)               │   │
│  │ LOW         │ No action (log only)                            │   │
│  └─────────────┴────────────────────────────────────────────────┘   │
│                                                                     │
│  Execution order (by priority):                                     │
│                                                                     │
│  1. POD ISOLATION (Priority 1):                                     │
│     Agent ──→ K8s API: Create NetworkPolicy (deny-all ingress+egress)│
│     Timeout: 10 seconds                                             │
│     Retry: 3 attempts, 5-second intervals                           │
│     On failure: Send alert, retry                                   │
│     On exhaustion: CRITICAL ALERT → manual intervention required    │
│                                                                     │
│  2. IP BLOCK (Priority 2):                                          │
│     Agent ──→ K8s API: Create NetworkPolicy (deny ingress from IP)  │
│     Timeout: 10 seconds                                             │
│     Retry: 3 attempts, 5-second intervals                           │
│     On failure: Send alert, retry                                   │
│                                                                     │
│  3. ADDITIONAL HONEYTOKENS (Priority 3):                            │
│     Agent ──→ Koney Deployer: Deploy 2+ more traps in namespace     │
│     Catches lateral movement attempts                               │
│                                                                     │
│  Technology: @kubernetes/client-node, NetworkPolicy API              │
│  Property tested: Property 11 (Response Escalation)                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 5: Forensic Report Generation (Gemini AI)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  After response completes, Gemini generates a forensic report:      │
│                                                                     │
│  Agent ──→ Gemini 2.0 Flash API                                     │
│                                                                     │
│  Prompt includes:                                                   │
│    - Full access event details (process, user, pod, file, time)     │
│    - Threat assessment (classification, criticality, anomaly)       │
│    - Response actions taken and their outcomes                      │
│                                                                     │
│  Gemini returns:                                                    │
│    - Summary of what happened                                       │
│    - Likely attacker intent                                         │
│    - Recommended follow-up actions                                  │
│                                                                     │
│  Report structure:                                                  │
│    { reportId, generationTimestamp, triggeringAccessEventId,         │
│      accessEventDetails, contextualAssessment, responseActions,     │
│      timeline, recommendedFollowUpActions }                         │
│                                                                     │
│  Timeout: 60 seconds                                                │
│  Retry: 3 attempts, 10-second intervals                            │
│  Retention: 90 days                                                 │
│  Fallback: Local template if Gemini unavailable                     │
│                                                                     │
│  Technology: Google Gen AI SDK, Gemini 2.0 Flash                    │
│  Property tested: Property 12 (Report Completeness)                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 6: Broadcast All Events to Dynatrace                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Every event in the cycle is pushed to Dynatrace Log Ingestion API: │
│                                                                     │
│  1. Access event (with threat classification)                       │
│  2. Each response action (with outcome)                             │
│  3. Forensic report (full JSON)                                     │
│  4. Incident timeline entry (summary)                               │
│  5. Registry status change (honeytoken → "triggered")               │
│                                                                     │
│  Format: POST /api/v2/logs/ingest                                   │
│  Each entry: { content: JSON.stringify(payload),                     │
│                "log.source": "ebeecontrol" }                        │
│                                                                     │
│  On failure: Buffer locally, exponential backoff (5 retries)        │
│  On exhaustion: Discard batch, log warning                          │
│                                                                     │
│  Technology: Dynatrace Log Ingestion API v2                         │
│  Dashboard updates within Dynatrace's ingestion latency (~2-5s)     │
└─────────────────────────────────────────────────────────────────────┘
```

### Total Time: Detection to Containment

| Step | Time |
|------|------|
| eBPF probe fires | < 1 second |
| Forward to Dynatrace | < 2 seconds |
| Query pod context | < 3 seconds |
| Classify threat | < 1 millisecond |
| Execute pod isolation | < 10 seconds |
| **Total** | **< 15 seconds** |

### Technologies Involved

| Component | Technology | Role |
|-----------|-----------|------|
| Tetragon | eBPF kprobes (kernel) | Detects file access at kernel level |
| Dynatrace MCP | REST API + Davis AI | Provides context and anomaly scores |
| Threat Classifier | TypeScript rules engine | Classifies threat level |
| Response Executor | @kubernetes/client-node | Creates NetworkPolicies |
| Gemini | Google Gen AI SDK | Generates forensic reports |
| Log Ingestion | Dynatrace API v2 | Pushes events to dashboard |

---

## Flow 3: Adaptive Learning & Model Retraining

### Purpose
Learn from every incident to improve future honeytoken placement. The system gets smarter over time without manual policy updates.

### Trigger
- **Outcome submission**: After every threat response sequence completes
- **Model retraining**: Every 24 hours (configurable: 1-168 hours)
- **Model publishing**: Only when new model accuracy ≥ current accuracy

### Sequence of Operations

```
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: Submit Outcome Data to Vertex AI                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  After every response sequence, the agent submits:                  │
│                                                                     │
│  OutcomeData = {                                                    │
│    incidentId: "uuid",                                              │
│    accessEvent: { full event details },                             │
│    honeytokenType: "decoy_secret" | "decoy_file" | "decoy_cred",   │
│    placementLocation: "/var/run/secrets/.../decoy-token",           │
│    actionsTaken: [ { actionType, target, result } ],                │
│    effectiveness: {                                                 │
│      detectionToResponseLatencySeconds: 0.002,                      │
│      threatContained: true,                                         │
│      falsePositive: false                                           │
│    }                                                                │
│  }                                                                  │
│                                                                     │
│  Must submit within 60 SECONDS of response completion               │
│  Validation: All fields checked for completeness                    │
│  On invalid data: Throw ValidationError, do not ingest              │
│                                                                     │
│  Technology: Vertex AI Trainer (in-memory dataset)                  │
│  Property tested: Property 14 (Outcome Ingestion)                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: Accumulate Training Data                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Each outcome is appended to the training dataset                   │
│  Dataset entry count increments by exactly 1 (Property 14)          │
│                                                                     │
│  The dataset tracks:                                                │
│    - Which honeytoken types were most effective                     │
│    - Which placements caught attackers                              │
│    - Detection-to-response latency                                  │
│    - False positive rate                                            │
│    - Containment success rate                                       │
│                                                                     │
│  Minimum 50 records required before retraining                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: Model Retraining (Every 24 Hours)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Conditions for retraining:                                         │
│    ✓ Retraining interval elapsed (default 24h)                      │
│    ✓ At least 50 new outcome records since last training            │
│                                                                     │
│  Retraining process:                                                │
│    1. Take current dataset                                          │
│    2. Split into training + validation sets                         │
│    3. Train new placement optimization model                        │
│    4. Evaluate against validation set → get accuracy %              │
│                                                                     │
│  Technology: Vertex AI (simulated locally, real in production)       │
│  Property tested: Property 16 (Discovery Scheduling)                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: Model Publish Guard                                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  THE CRITICAL SAFETY CHECK:                                         │
│                                                                     │
│  IF new_model_accuracy >= current_model_accuracy:                   │
│    → PUBLISH new model                                              │
│    → Agent uses it for future placement decisions                   │
│    → Log: model version, dataset size, accuracy                     │
│    → Reset dataset counter                                          │
│                                                                     │
│  IF new_model_accuracy < current_model_accuracy:                    │
│    → REJECT new model                                               │
│    → Keep existing model unchanged                                  │
│    → Log: rejection reason                                          │
│    → Retry at next scheduled interval                               │
│                                                                     │
│  This ensures the system NEVER gets worse — only better or same.    │
│                                                                     │
│  Technology: Vertex AI model evaluation                             │
│  Property tested: Property 15 (Model Publish Guard)                 │
└─────────────────────────────────────────────────────────────────────┘
```

### What the Model Learns

| Input | What it optimizes |
|-------|------------------|
| Which pods were attacked | Where to place honeytokens next |
| Which honeytoken types caught attackers | What type to deploy |
| Detection latency | Optimal file path placement |
| False positive rate | Reduce unnecessary alerts |
| Containment success | Improve response strategy |

---

## Flow 4: Data Flow to Dynatrace Dashboard

### Purpose
Push all operational data to Dynatrace so the dashboard tiles show real-time system activity.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    eBeeControl Agent                               │
│                                                                  │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────┐   │
│  │ Event       │    │ Dynatrace Log    │    │ Dynatrace     │   │
│  │ Broadcaster │──→ │ Ingestion Client │──→ │ Log API v2    │   │
│  └─────────────┘    └──────────────────┘    └───────┬───────┘   │
│         │                                           │            │
│         │           ┌──────────────────┐            │            │
│         └─────────→ │ Dynatrace Metrics│            │            │
│                     │ Client           │            │            │
│                     └──────────────────┘            │            │
└──────────────────────────────────────────────────────┼────────────┘
                                                      │
                                                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Dynatrace Platform                              │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │ Log Storage  │──→ │ DQL Engine   │──→ │ Dashboard Tiles   │  │
│  │ (Grail)      │    │ (Queries)    │    │ (Tables, Charts)  │  │
│  └──────────────┘    └──────────────┘    └───────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### What Gets Pushed

| Event Type | API | Dashboard Tile |
|-----------|-----|---------------|
| Honeytoken deployed/triggered | Log Ingest | Honeytokens by Type, Registry |
| Access event detected | Log Ingest | Threat Levels, Access Events |
| Response action taken | Log Ingest | Actions by Type, Success/Failure |
| Component health change | Log Ingest | Component Health |
| Forensic report generated | Log Ingest | Forensic Reports |
| Model metrics updated | Log Ingest | Model Performance |
| Incident completed | Log Ingest | Incident Outcomes, Timeline |

### Log Entry Format

Every event is sent as:
```json
{
  "content": "{\"honeytokenId\":\"uuid\",\"podId\":\"pod-x\",...}",
  "log.source": "ebeecontrol",
  "timestamp": "2026-05-29T01:04:08.732Z"
}
```

The `content` field contains the full event payload as a JSON string.
Dashboard DQL queries use `contains(content, "fieldName")` to filter.

### Batching & Retry

```
Events generated → Buffer (batch up to 100 items)
                        │
                        ▼ (every 5 seconds OR when batch full)
                   Flush to Dynatrace API
                        │
                   ┌────┴────┐
                   │ Success │ Failure
                   │         │
                   ▼         ▼
              Clear buffer   Move to retry buffer
                             │
                             ▼
                        Exponential backoff
                        (2s, 4s, 8s, 16s, 32s)
                             │
                        ┌────┴────┐
                        │ Success │ All retries exhausted
                        │         │
                        ▼         ▼
                   Clear item    DISCARD + log warning
```

---

## Flow 5: Health Monitoring & Recovery

### Purpose
Continuously monitor all system components and automatically recover from failures.

### Sequence

```
┌─────────────────────────────────────────────────────────────────────┐
│ Every 30 seconds (configurable):                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Check each component (10-second timeout per check):                │
│                                                                     │
│  ┌─────────────────────┬────────────────────────────────────────┐   │
│  │ Tetragon_Monitor    │ Call getRegisteredPaths()               │   │
│  │ Koney_Deployer      │ Call getDeploymentStatus("health")      │   │
│  │ Dynatrace_MCP_Server│ Call getPodContext("health", "default") │   │
│  │ Vertex_AI_Trainer   │ Call getTrainingStatus()                │   │
│  └─────────────────────┴────────────────────────────────────────┘   │
│                                                                     │
│  Component is UNHEALTHY if:                                         │
│    - Check throws an error, OR                                      │
│    - Check doesn't respond within 10 seconds                        │
│                                                                     │
│  Component is HEALTHY if:                                           │
│    - Check resolves successfully within 10 seconds                  │
│                                                                     │
│  Property tested: Property 17 (Health Status Computation)           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    Component unhealthy?
                              │
                    ┌─────────┴─────────┐
                    │ YES               │ NO
                    ▼                   ▼
┌───────────────────────────┐   Component stays healthy
│ Recovery Process:          │
│                           │
│ 1. Log failure            │
│ 2. Retry 3x at 20s       │
│ 3. Alert within 60s      │
│                           │
│ After 3 retries:          │
│ → Mark DEGRADED           │
│ → Send escalation alert   │
│ → Continue with healthy   │
│   components              │
│ → System keeps running    │
└───────────────────────────┘
```

### Graceful Degradation

| Component Down | System Behavior |
|---------------|----------------|
| Tetragon | No new detections, existing responses continue |
| Koney Deployer | No new deployments, existing honeytokens still monitored |
| Dynatrace MCP | Context queries timeout → default to HIGH classification |
| Vertex AI | Learning paused, current model stays in use |
| Dynatrace Ingestion | Events buffered locally, delivered when restored |

**Key principle: The system NEVER stops protecting. It degrades gracefully.**

---

## Complete End-to-End Timeline

```
T+0.000s  │ Attacker reads /var/run/secrets/.../decoy-token
T+0.001s  │ eBPF kprobe fires in kernel
T+0.500s  │ Tetragon generates AccessEvent
T+1.500s  │ Event forwarded to Dynatrace MCP Server
T+2.000s  │ Agent receives event via subscription
T+2.100s  │ Agent queries Dynatrace for pod context
T+2.800s  │ Context received (production, criticality=4, anomaly=0.85)
T+2.801s  │ Threat classified: CRITICAL
T+2.802s  │ Response plan generated: isolate + block + deploy
T+3.000s  │ Pod isolation NetworkPolicy created
T+3.500s  │ IP block NetworkPolicy created
T+4.000s  │ 2 additional honeytokens deployed
T+4.001s  │ All response actions logged to audit log
T+4.100s  │ Access event broadcast to Dynatrace
T+4.200s  │ Response actions broadcast to Dynatrace
T+5.000s  │ Gemini generates forensic report
T+5.100s  │ Report broadcast to Dynatrace
T+5.200s  │ Outcome submitted to Vertex AI trainer
T+5.300s  │ Incident timeline entry broadcast to Dynatrace
T+5.400s  │ Workflow complete. Attacker contained.
           │
T+5.400s  │ Dashboard tiles update with new data
```

**Total: 5.4 seconds from attack to full containment + reporting + learning.**

---

Made with ❤️ by Alex
