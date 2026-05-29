# eBeeControl — AI Components: Gemini, Vertex AI, and Davis AI

## Why Three AI Systems?

eBeeControl uses three distinct AI systems because each solves a fundamentally different problem. There is **zero overlap** between them — they operate at different times, on different data, and produce different outputs.

```
┌─────────────────────────────────────────────────────────────────┐
│                    The AI Pipeline                                │
│                                                                 │
│   Davis AI          Gemini              Vertex AI               │
│   (The Sensor)      (The Writer)        (The Strategist)        │
│                                                                 │
│   "How suspicious   "What happened      "Where should we        │
│    is this pod       and what should      put traps next         │
│    RIGHT NOW?"       we do next?"         time?"                 │
│                                                                 │
│   ──────────→        ──────────→         ──────────→            │
│   CONTEXT            EXPLANATION          IMPROVEMENT            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Davis AI (Dynatrace)

### Role: The Sensor

**Question it answers:** "How suspicious is this pod right now?"

### What it does

Davis AI is Dynatrace's built-in anomaly detection engine. It continuously monitors your entire Kubernetes cluster — CPU, memory, network, request patterns, error rates — and produces an **anomaly score** (0.0 to 1.0) for every service.

We don't train Davis. We don't configure Davis. We just **ask it a question** when we need context about a pod.

### When it's used

During **threat assessment** — after a honeytoken is accessed, we ask Davis:
- Is this pod in a production namespace?
- What's the service criticality? (1-5)
- What's the anomaly score for the last 10 minutes? (0.0-1.0)

### What it provides

```
GET /api/v1/pods/{podId}/context

Response:
{
  "namespaceClassification": "production",
  "serviceCriticality": 4,
  "davisAnomalyScore": 0.85
}
```

### Why we need it

Without Davis, we'd have to classify every honeytoken access the same way. With Davis, we can distinguish between:
- A developer accidentally reading a file in staging (low anomaly, non-production) → **LOW**
- An attacker with a reverse shell in production during a spike in anomalous behavior → **CRITICAL**

### Key characteristics

| Property | Value |
|----------|-------|
| Owned by | Dynatrace (SaaS) |
| Trained by | Dynatrace (automatic, on your cluster data) |
| Called when | Every honeytoken access event |
| Latency | < 3 seconds |
| Cost | Included in Dynatrace license |
| We control | Nothing — it's a black box we query |

---

## Gemini (Google)

### Role: The Writer

**Question it answers:** "What happened and what should the security team do next?"

### What it does

Gemini is a Large Language Model (LLM). It takes structured incident data and produces a **human-readable forensic report** with analysis, timeline, and recommendations.

We don't train Gemini. We give it a prompt with incident details and it writes a report.

### When it's used

After **response execution** — once the attacker is contained, we ask Gemini to write the forensic report:

```
Prompt: "Analyze this security incident:
- Process /tmp/.hidden/reverse-shell (PID 31337, root)
- Read honeytoken at /var/run/secrets/.../decoy-token
- Pod: pod-payment-7f8d9c, namespace: production
- Anomaly score: 0.85, criticality: 4
- Response: pod isolated, IP blocked, 2 additional traps deployed
- All actions succeeded

Provide: summary, attacker intent, recommended follow-up actions."
```

### What it provides

A natural language forensic report:
```
## Incident Summary
An unauthorized process (reverse shell) accessed a decoy service account
token in a production payment pod. The elevated anomaly score (0.85)
suggests this is part of an active intrusion campaign...

## Likely Attacker Intent
Credential harvesting for lateral movement...

## Recommended Follow-Up Actions
1. Review pod access logs for the last 24 hours
2. Check for lateral movement in adjacent namespaces
3. Initiate incident response team escalation...
```

### Why we need it

Without Gemini, the forensic report would be a raw JSON dump. With Gemini, security analysts get a **readable narrative** they can act on immediately — no need to parse structured data manually.

### Key characteristics

| Property | Value |
|----------|-------|
| Owned by | Google (API) |
| Trained by | Google (general purpose LLM) |
| Called when | After each incident response completes |
| Latency | < 60 seconds |
| Cost | ~$0.001 per report (Gemini 2.0 Flash) |
| We control | The prompt (system instruction + incident data) |

---

## Vertex AI (Google Cloud)

### Role: The Strategist

**Question it answers:** "Where should we put honeytokens next time to maximize detection?"

### What it does

Vertex AI is a machine learning platform. We use it to train a **placement optimization model** that learns from past incidents. Over time, it gets better at predicting which pods are most likely to be attacked and what type of honeytoken will catch attackers.

We **do** train this model. We feed it outcome data from every incident.

### When it's used

Two phases:

1. **After each incident** — we submit outcome data (what worked, what didn't)
2. **Every 24 hours** — the model retrains on accumulated data (if 50+ new records)

### What it provides

An updated **placement model** that the agent uses during discovery cycles to:
- Rank which services are highest risk
- Decide what type of honeytoken to deploy
- Choose optimal file paths for placement

### Training data (what we feed it)

```json
{
  "incidentId": "uuid",
  "honeytokenType": "decoy_secret",
  "placementLocation": "/var/run/secrets/.../decoy-token",
  "effectiveness": {
    "detectionToResponseLatencySeconds": 0.002,
    "threatContained": true,
    "falsePositive": false
  }
}
```

### The Publish Guard (Safety)

A new model is **only published** if its accuracy meets or exceeds the current model. This means the system can **never get worse** — only better or the same.

```
IF new_accuracy >= current_accuracy → PUBLISH (system improves)
IF new_accuracy <  current_accuracy → REJECT  (keep current model)
```

### Why we need it

Without Vertex AI, we'd place honeytokens randomly or based on static rules. With Vertex AI, the system **learns from real attacks** and optimizes placement over time:
- First week: honeytokens placed based on Dynatrace risk scores
- After 50 incidents: model learns which placements actually catch attackers
- After 200 incidents: model predicts optimal placement with high accuracy

### Key characteristics

| Property | Value |
|----------|-------|
| Owned by | Us (trained on our data) |
| Trained by | Us (automated, every 24 hours) |
| Called when | During discovery cycle (to rank services) |
| Latency | Training: minutes. Inference: milliseconds |
| Cost | ~$0.10 per training run |
| We control | Training data, retraining schedule, publish guard |

---

## How They Work Together

```
                    ┌─────────────┐
                    │   ATTACK    │
                    │  DETECTED   │
                    └──────┬──────┘
                           │
                           ▼
              ┌────────────────────────┐
              │      DAVIS AI          │
              │  "Is this suspicious?" │
              │                        │
              │  Input: pod metrics    │
              │  Output: anomaly=0.85  │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  THREAT CLASSIFICATION │
              │  (our rules engine)    │
              │                        │
              │  production + 0.85     │
              │  = CRITICAL            │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  AUTONOMOUS RESPONSE   │
              │  (pod isolation, etc.) │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │      GEMINI            │
              │  "Write the report"    │
              │                        │
              │  Input: incident data  │
              │  Output: forensic      │
              │          report        │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │     VERTEX AI          │
              │  "Learn from this"     │
              │                        │
              │  Input: outcome data   │
              │  Output: better model  │
              │  (after 50+ incidents) │
              └────────────────────────┘
```

---

## Summary Table

| | Davis AI | Gemini | Vertex AI |
|---|---|---|---|
| **Type** | Anomaly detection | Language model | ML training platform |
| **Analogy** | Thermometer | Journalist | Coach |
| **Question** | "How hot is it?" | "What's the story?" | "How do we improve?" |
| **Timing** | Real-time (continuous) | On-demand (per incident) | Batch (every 24h) |
| **Data direction** | We READ from it | We PROMPT it | We TRAIN it |
| **Learning** | Learns your cluster automatically | Doesn't learn (stateless) | Learns from our incidents |
| **Output** | A number (0.0-1.0) | A text report | A model (accuracy %) |
| **Without it** | All threats classified the same | Raw JSON instead of reports | Static placement forever |
| **Replaceable?** | Only with another APM tool | Any LLM (Claude, GPT, etc.) | Any ML platform |

---

## The Key Insight

> **Davis tells us what's happening NOW.**
> **Gemini explains what HAPPENED.**
> **Vertex AI decides what to do NEXT TIME.**

Three different time horizons. Three different problems. Zero overlap.

---

Made with ❤️ by Alex
