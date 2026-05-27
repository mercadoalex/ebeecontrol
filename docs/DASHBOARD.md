# eBeeControl — Dynatrace Dashboard Guide

## Overview

The eBeeControl Dynatrace Dashboard provides real-time operational visibility into the autonomous deception engine. It tells the story of how the system protects your Kubernetes cluster — from honeytoken deployment through attack detection, autonomous response, and adaptive learning.

The dashboard is designed to be read **top-to-bottom as a narrative**: defense posture → attack detection → autonomous response → incident forensics → system health.

---

## Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  🐝 eBeeControl — Autonomous Deception Engine (Header)          │
├─────────────────────────────────────────────────────────────────┤
│  🛡️ Defense Posture                                             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Honeytokens│  │ Deployments  │  │ Active Registry          │  │
│  │ by Type   │  │ Over Time    │  │ (Table)                  │  │
│  │ (Pie)     │  │ (Line Chart) │  │                          │  │
│  └──────────┘  └──────────────┘  └──────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  ⚔️ Attack Detection                                            │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Threat   │  │ Attacks      │  │ Latest Access Events     │  │
│  │ Levels   │  │ Over Time    │  │ (Table)                  │  │
│  │ (Bar)    │  │ (Area Chart) │  │                          │  │
│  └──────────┘  └──────────────┘  └──────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  ⚡ Autonomous Response                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Actions  │  │ Success vs   │  │ Response Action Log      │  │
│  │ by Type  │  │ Failure      │  │ (Table)                  │  │
│  │ (Bar)    │  │ (Pie)        │  │                          │  │
│  └──────────┘  └──────────────┘  └──────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  📋 Incidents & Forensics                                       │
│  ┌──────────┐  ┌────────────────────────────────────────────┐  │
│  │ Outcomes │  │ Incident Timeline (Table)                   │  │
│  │ (Pie)    │  │                                             │  │
│  └──────────┘  └────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  🧬 Adaptive Learning & System Health                           │
│  ┌────────────────────┐  ┌──────────────────────────────────┐  │
│  │ Component Health   │  │ Model Performance                │  │
│  │ (Table)            │  │ (Table)                          │  │
│  └────────────────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tile-by-Tile Reference

### Section 1: 🛡️ Defense Posture

_"How well are we protected? Where are our traps?"_

#### Tile: Honeytokens by Type (Pie Chart)

**Purpose:** Shows the distribution of deployed honeytoken types across the cluster.

**What it tells you:**
- Balance between decoy secrets, decoy files, and decoy credentials
- Whether the system is diversifying its trap types for maximum coverage

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "honeytokenId") and matchesPhrase(content, "deploymentTimestamp") and not matchesPhrase(content, "incidentId")
| parse content, "JSON:payload"
| summarize count=count(), by:{payload[type]}
```

**Expected values:** `decoy_secret`, `decoy_file`, `decoy_credential`

---

#### Tile: Honeytokens Deployed Over Time (Line Chart)

**Purpose:** Shows the rate of honeytoken deployment over time.

**What it tells you:**
- When discovery cycles ran and deployed new traps
- Whether the system is actively expanding its deception surface
- Spikes indicate new high-risk services were discovered

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "honeytokenId") and matchesPhrase(content, "deploymentTimestamp") and not matchesPhrase(content, "incidentId")
| makeTimeseries count=count(), interval:5m
```

---

#### Tile: Active Honeytokens Registry (Table)

**Purpose:** Detailed list of all deployed honeytokens with their current status.

**Columns:** Timestamp, Pod ID, Namespace, Type, Status

**What it tells you:**
- Which pods have honeytokens
- Which honeytokens have been triggered (attacker accessed them)
- The exact file paths being monitored

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "honeytokenId") and matchesPhrase(content, "deploymentTimestamp") and not matchesPhrase(content, "incidentId")
| parse content, "JSON:payload"
| fields timestamp, payload[podId], payload[namespace], payload[type], payload[status]
| sort timestamp desc
| limit 20
```

---

### Section 2: ⚔️ Attack Detection

_"Are we under attack? How severe is it?"_

#### Tile: Threat Level Distribution (Bar Chart)

**Purpose:** Shows the breakdown of detected threats by severity level.

**What it tells you:**
- How many attacks have been detected at each severity level
- Whether you're seeing mostly low-level probes or critical intrusions
- A spike in "critical" indicates a serious breach attempt

**Severity levels:**
- **Low** — Non-production namespace, low anomaly, low criticality
- **Medium** — Production namespace OR moderate anomaly
- **High** — Production + elevated anomaly (0.6-0.8) or criticality 4
- **Critical** — Production + high anomaly (>0.8) or criticality 5

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "threatClassification") and matchesPhrase(content, "accessType")
| parse content, "JSON:payload"
| summarize count=count(), by:{payload[threatClassification]}
```

---

#### Tile: Attacks Over Time (Area Chart)

**Purpose:** Shows the volume of honeytoken access events over time.

**What it tells you:**
- Attack patterns and timing (are attacks happening during off-hours?)
- Whether an active campaign is underway (sustained high volume)
- Correlation with deployment events (new traps catching new attackers)

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "threatClassification") and matchesPhrase(content, "accessType")
| makeTimeseries count=count(), interval:5m
```

---

#### Tile: Latest Access Events (Table)

**Purpose:** Real-time feed of the most recent honeytoken access detections.

**Columns:** Timestamp, Pod ID, Namespace, Process Binary, Access Type, Threat Classification

**What it tells you:**
- Which process accessed the honeytoken (e.g., `/tmp/.hidden/reverse-shell`)
- The exact pod and namespace under attack
- Whether it's a read, write, open, or stat operation
- The assigned threat level

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "threatClassification") and matchesPhrase(content, "accessType") and not matchesPhrase(content, "incidentId")
| parse content, "JSON:payload"
| fields timestamp, payload[podId], payload[namespace], payload[processBinaryPath], payload[accessType], payload[threatClassification]
| sort timestamp desc
| limit 10
```

---

### Section 3: ⚡ Autonomous Response

_"What did the system do about it? Was it effective?"_

#### Tile: Response Actions by Type (Bar Chart)

**Purpose:** Shows which response actions the system has taken.

**What it tells you:**
- How many pod isolations, IP blocks, and additional trap deployments occurred
- The system's response strategy in action

**Action types:**
- **pod_isolation** — Pod network access completely cut off via NetworkPolicy
- **ip_block** — Attacker's source IP blocked at the network level
- **additional_honeytokens** — More traps deployed in the compromised namespace

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "actionId") and matchesPhrase(content, "actionType") and matchesPhrase(content, "outcome")
| parse content, "JSON:payload"
| summarize count=count(), by:{payload[actionType]}
```

---

#### Tile: Success vs Failure (Pie Chart)

**Purpose:** Shows the success rate of autonomous response actions.

**What it tells you:**
- Whether containment actions are succeeding
- If failures are occurring (may indicate RBAC issues or network problems)
- A high failure rate means manual intervention is needed

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "actionId") and matchesPhrase(content, "actionType") and matchesPhrase(content, "outcome")
| parse content, "JSON:payload"
| summarize count=count(), by:{payload[outcome]}
```

---

#### Tile: Response Action Log (Table)

**Purpose:** Detailed log of every response action with its outcome.

**Columns:** Timestamp, Action Type, Target, Triggering Classification, Outcome

**What it tells you:**
- The exact sequence of containment actions
- Which pod was isolated and when
- Whether retries were needed
- The threat level that triggered each action

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "actionId") and matchesPhrase(content, "actionType") and matchesPhrase(content, "outcome")
| parse content, "JSON:payload"
| fields timestamp, payload[actionType], payload[target], payload[triggeringClassification], payload[outcome]
| sort timestamp desc
| limit 15
```

---

### Section 4: 📋 Incidents & Forensics

_"What's the full story? What happened end-to-end?"_

#### Tile: Incident Outcomes (Pie Chart)

**Purpose:** Shows how incidents were resolved.

**What it tells you:**
- **Contained** — Attacker was successfully stopped autonomously
- **Escalated** — Response actions failed, manual intervention required
- **False Positive** — Detection was not a real threat

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "incidentId") and matchesPhrase(content, "finalOutcome")
| parse content, "JSON:payload"
| summarize count=count(), by:{payload[finalOutcome]}
```

---

#### Tile: Incident Timeline (Table)

**Purpose:** Complete chronological history of all security incidents.

**Columns:** Timestamp, Threat Classification, Affected Pod, Namespace, Final Outcome

**What it tells you:**
- The full history of attacks against your cluster
- Which pods are being targeted repeatedly
- Whether the system is successfully containing threats
- Patterns in attacker behavior (same namespace, same time of day)

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "incidentId") and matchesPhrase(content, "finalOutcome")
| parse content, "JSON:payload"
| fields timestamp, payload[threatClassification], payload[affectedPodId], payload[namespace], payload[finalOutcome]
| sort timestamp desc
| limit 20
```

---

### Section 5: 🧬 Adaptive Learning & System Health

_"Is the system healthy? Is it getting smarter?"_

#### Tile: Component Health (Table)

**Purpose:** Shows the operational status of each system component.

**Components monitored:**
- **Tetragon_Monitor** — eBPF kernel-level detection
- **Koney_Deployer** — Honeytoken deployment engine
- **Dynatrace_MCP_Server** — Observability context provider
- **Vertex_AI_Trainer** — Machine learning model trainer

**Status values:**
- **healthy** — Component responding normally
- **unhealthy** — Component failed last health check
- **degraded** — Component failed recovery, operating in reduced mode

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "componentName") and matchesPhrase(content, "lastSuccessfulCheckTimestamp")
| parse content, "JSON:payload"
| fields timestamp, payload[componentName], payload[status]
| sort timestamp desc
| limit 10
```

---

#### Tile: Model Performance (Table)

**Purpose:** Shows the Vertex AI placement model's accuracy and training status.

**Columns:** Timestamp, Model Version, Validation Accuracy, Dataset Size, Training Status

**What it tells you:**
- Current model version and its accuracy percentage
- How much training data has been collected
- Whether retraining is in progress or idle
- Whether accuracy is improving over time (the system is learning)

**DQL Query:**
```
fetch logs
| filter matchesPhrase(content, "modelVersionId") and matchesPhrase(content, "validationAccuracy")
| parse content, "JSON:payload"
| fields timestamp, payload[modelVersionId], payload[validationAccuracy], payload[trainingDatasetSize], payload[trainingStatus]
| sort timestamp desc
| limit 5
```

---

## Populating the Dashboard

Run the live demo to push data:

```bash
export DYNATRACE_ENV_URL=https://lfl68751.live.dynatrace.com
export DYNATRACE_API_TOKEN=dt0c01.YOUR_TOKEN
npm run demo:live
```

Run it multiple times for richer visualizations:

```bash
npm run demo:live && sleep 5 && npm run demo:live && sleep 5 && npm run demo:live
```

---

## Presentation Tips

1. **Start with Defense Posture** — "Here's how many traps we have deployed across the cluster"
2. **Trigger the demo live** — Run `npm run demo:live` during the presentation
3. **Watch Attack Detection light up** — "An attacker just accessed a honeytoken"
4. **Show Autonomous Response** — "Within milliseconds, the pod was isolated"
5. **End with Learning** — "The system just got smarter for next time"

The dashboard tells the story automatically — just scroll down.

---

Made with ❤️ by Alex
