# eBeeControl — Roadmap

## Current State (v1.0)

| Feature | Status |
|---------|--------|
| Full TypeScript implementation (728 tests) | ✅ |
| Tetragon eBPF integration | ✅ |
| Koney operator integration | ✅ |
| Real K8s deployer + NetworkPolicies | ✅ |
| Gemini AI forensic reports | ✅ |
| Gemini Enterprise Agent Platform (adaptive learning) | ✅ |
| Dynatrace MCP Server + Davis AI | ✅ |
| Dynatrace Dashboard (live data) | ✅ |
| Docker + Helm + Terraform + GitHub Actions | ✅ |
| Demo scripts (console + live Dynatrace) | ✅ |
| Full documentation | ✅ |

---

## v1.1 — Production Hardening

| Feature | Priority | Effort |
|---------|----------|--------|
| Rate limiting on response actions (prevent isolation cascades) | High | Low |
| Kill switch / pause mechanism for autonomous response | High | Low |
| Slack/PagerDuty alerting integration | Medium | Low |
| Configurable response policies (allow/deny per namespace) | Medium | Medium |

---

## v2.0 — Semantic Anomaly Detection (BigQuery Vector Search)

### The Vision

Add a "Semantic Detective" layer that uses **BigQuery Vector Search** with **Gemini embeddings** to detect unknown attack patterns by finding semantically similar events across the incident history.

### Why

Current eBeeControl classifies threats using rules (namespace + criticality + anomaly score). This works for known patterns but misses:
- Novel attack techniques that don't match existing rules
- Correlated attacks across multiple pods/namespaces from the same actor
- Slow, low-signal attacks that individually look benign but together form a pattern

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ Current Flow (v1.0):                                             │
│                                                                 │
│   Honeytoken accessed → Rule-based classification               │
│   (low/medium/high/critical based on context)                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Enhanced Flow (v2.0):                                            │
│                                                                 │
│   Honeytoken accessed                                           │
│        │                                                        │
│        ├──→ Rule-based classification (existing)                │
│        │                                                        │
│        └──→ Generate event narrative                            │
│             │                                                   │
│             ▼                                                   │
│        Embed with gemini-embedding-001 (3072 dimensions)        │
│             │                                                   │
│             ▼                                                   │
│        BigQuery Vector Search (top-k=5 nearest neighbors)       │
│             │                                                   │
│             ▼                                                   │
│        ┌────────────────────────────────────────────┐           │
│        │ "This looks like the same attacker from    │           │
│        │  3 days ago — similar process, similar     │           │
│        │  file access pattern, same namespace"      │           │
│        └────────────────────────────────────────────┘           │
│             │                                                   │
│             ▼                                                   │
│        Enrich forensic report with correlated incidents         │
│        Escalate if pattern matches known campaigns              │
└─────────────────────────────────────────────────────────────────┘
```

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    eBeeControl Agent                           │
│                                                              │
│  On each incident:                                           │
│  1. Convert access event → event narrative (text)            │
│  2. Call gemini-embedding-001 → 3072-dim vector              │
│  3. Store vector in BigQuery                                 │
│  4. Search for similar past events (cosine similarity)       │
│  5. If similar malicious events found → escalate             │
│  6. Feed back to continual learning                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    BigQuery                                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Table: ebeecontrol.incident_embeddings                │    │
│  │                                                      │    │
│  │ incident_id | timestamp | narrative | embedding |     │    │
│  │             |           | (text)    | (3072-dim)|     │    │
│  │             |           |           | vector    |     │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Vector Index: BETH_style cosine similarity            │    │
│  │ Enables sub-second search across millions of events   │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Event Narrative Format

Each incident is converted to a human-readable narrative before embedding:

```
Process '/tmp/.hidden/reverse-shell' (PID: 31337), spawned by parent PID 1,
performed a 'read' action on honeytoken '/var/run/secrets/.../decoy-token'
in pod 'pod-payment-7f8d9c' (namespace: production).
Service criticality: 4/5. Davis anomaly score: 0.85.
Response: pod isolated, IP blocked, 2 additional honeytokens deployed.
Outcome: contained.
```

### What This Enables

| Capability | Description |
|-----------|-------------|
| **Attack correlation** | "These 5 incidents across different pods are the same attacker" |
| **Unknown threat detection** | Find attacks that don't match rules but are semantically similar to past attacks |
| **Campaign tracking** | Identify ongoing campaigns by clustering related events |
| **Reduced false negatives** | Catch subtle attacks that individually look benign |
| **Continual learning** | Analyst feedback improves detection without retraining the model |

### Technology Choices

| Component | Technology | Why |
|-----------|-----------|-----|
| Embedding model | `gemini-embedding-001` | 3072 dimensions, understands security context |
| Vector storage | BigQuery | Native vector search, scales to millions of events, no separate DB needed |
| Distance metric | Cosine similarity | Best for semantic similarity in high-dimensional spaces |
| Top-k | 5 neighbors | Good balance between precision and stability (from article's analysis) |
| Classification | Majority voting (3/5) | If 3+ neighbors are malicious → escalate |

### Why BigQuery Over OpenSearch/Pinecone/Weaviate?

| Factor | BigQuery | OpenSearch | Pinecone |
|--------|----------|-----------|----------|
| Already in our stack (GCP) | ✅ | ❌ | ❌ |
| Native vector search | ✅ | ✅ | ✅ |
| SQL + vector in one query | ✅ | ❌ | ❌ |
| Scales to billions of rows | ✅ | ⚠️ | ✅ |
| No extra infrastructure | ✅ | ❌ (cluster needed) | ❌ (SaaS cost) |
| Works with BigFrames | ✅ | ❌ | ❌ |
| Cost for our scale | Low (pay per query) | High (cluster) | Medium (per vector) |

BigQuery is the right choice because we're already on Google Cloud and it combines structured data (incident metadata) with vector search in a single query — no need to maintain a separate vector database.

---

## v3.0 — Multi-Cluster & Advanced Deception

| Feature | Description |
|---------|-------------|
| Multi-cluster federation | Single brain managing honeytokens across multiple clusters |
| Polymorphic honeytokens | Honeytokens that change content to appear more realistic |
| Attacker profiling | Build attacker profiles based on behavior patterns |
| Automated threat intelligence sharing | Export attack patterns to threat intel feeds |
| Custom Dynatrace App | Purpose-built UI instead of dashboard tiles |

---

Made with ❤️ by Alex
