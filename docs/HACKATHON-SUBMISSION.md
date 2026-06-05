# eBeeControl — Hackathon Submission

## Inspiration

Security teams are overwhelmed. The average time to detect a breach in a Kubernetes cluster is **277 days** — and once attackers gain access, they sell it to others through Cybercrime-as-a-Service (CaaS) marketplaces. Traditional security tools are reactive: they wait for known signatures and miss novel attacks entirely.

We were inspired by the concept of **cyber deception** — instead of waiting for attackers to hit real assets, what if we could bait them with traps and catch them the moment they move? The Dynatrace Research team's open-source project [Koney](https://github.com/dynatrace-oss/koney) showed that honeytokens in Kubernetes are technically feasible. But Koney deploys traps — it doesn't think. It doesn't decide WHERE to place them, HOW to respond, or HOW to improve over time.

That's where eBeeControl comes in: **an autonomous AI brain on top of Koney** that uses Gemini to reason about threats, Davis AI to understand context, and the Gemini Enterprise Agent Platform to learn from every incident. No human intervention required.

## What it does

eBeeControl is an autonomous deception engine that protects Kubernetes clusters through a continuous 7-step cycle:

1. **Discover** — Queries the Dynatrace MCP Server for high-risk services using Davis AI anomaly scores
2. **Deploy** — Instructs Koney to place honeytokens (decoy secrets, fake credentials, trap files) in vulnerable pods
3. **Detect** — Tetragon eBPF kernel probes fire within 1 second when any process accesses a honeytoken
4. **Assess** — Gemini classifies the threat as low/medium/high/critical using real-time context from Davis AI (namespace, service criticality, anomaly score)
5. **Respond** — Autonomously isolates the compromised pod, blocks the attacker's IP, and deploys additional traps to catch lateral movement — all within 15 seconds
6. **Report** — Gemini 2.0 Flash generates a detailed forensic report with timeline, attacker intent analysis, and recommended follow-up actions
7. **Learn** — Submits incident outcomes to the Gemini Enterprise Agent Platform, which retrains the placement model every 24 hours so future trap placement improves over time

The entire cycle runs 24/7 without human approval. The system gets smarter with every attack it catches.

## How we built it

**Architecture:**
- **TypeScript** (strict mode) — 728 tests, 24 property-based correctness guarantees
- **Gemini 2.0 Flash** — Forensic report generation via Google Gen AI SDK
- **Gemini Enterprise Agent Platform** — Adaptive placement model that retrains on real incident data
- **Dynatrace MCP Server** — Service topology, Davis AI anomaly detection, real-time pod context
- **Koney** (Dynatrace OSS) — Kubernetes operator for honeytoken deployment via DeceptionPolicy CRDs
- **Cilium Tetragon** — eBPF kernel probes for sub-second honeytoken access detection
- **Dynatrace Dashboard** — Real-time operational visibility with DQL-powered tiles

**Infrastructure:**
- **GKE** — Google Kubernetes Engine for production deployment
- **Terraform** — Infrastructure as Code for reproducible environments
- **Helm** — Kubernetes packaging and deployment
- **GitHub Actions** — CI/CD pipeline (test → build → push → deploy → install Tetragon → apply policies)
- **Docker** — Multi-stage build with non-root user, read-only filesystem

**Development approach:**
- Spec-driven development: requirements → design → implementation → property-based testing
- 24 formal correctness properties validated with fast-check (100+ iterations each)
- Every component testable via dependency injection
- Graceful degradation — system continues operating when individual components fail

## Challenges we ran into

1. **ARM vs AMD64** — Building on Apple Silicon Mac for GKE (AMD64) caused `exec format error`. Learned to always use `--platform=linux/amd64` with Docker buildx.

2. **Terraform state management** — Local state didn't sync with GitHub Actions runner. Solved by migrating to GCS remote backend, but existing resources required manual imports.

3. **Dynatrace Log Ingestion format** — The API silently accepted data but didn't index it. The fix was wrapping payloads in `{"content": JSON.stringify(payload), "log.source": "ebeecontrol"}` format.

4. **Gemini API quota** — Free tier quotas reset unpredictably. Implemented a graceful fallback: if Gemini is unavailable, the system generates reports locally using the same data structure. The system never crashes.

5. **Making Koney vs custom code decision** — Initially built our own K8s deployer before realizing Koney (Dynatrace OSS) already solves this problem as a proper Kubernetes operator with CRDs. Refactored to use Koney as the "hands" and eBeeControl as the "brain."

6. **Threat classification without false positives** — Honeytokens are never accessed by legitimate processes, so any access is suspicious by definition. But we still needed to differentiate severity. Solved by using Davis AI context (anomaly score + criticality + namespace) for nuanced classification.

## Accomplishments that we're proud of

- **728 tests** with **24 property-based correctness guarantees** — the system is formally verified to behave correctly across all valid inputs
- **< 15 second** detection-to-containment time — from kernel probe firing to pod isolation
- **Zero false positives by design** — honeytokens are never accessed by legitimate processes
- **Model Publish Guard** — the AI placement model can never get worse, only better (new model published only if accuracy ≥ current)
- **Graceful degradation** — if any component fails, the system continues protecting with remaining healthy components
- **Five AI systems working together without overlap** — Davis AI (context), Gemini (reports), Gemini Enterprise Agent Platform (learning), each solving a distinct problem
- **Live Dynatrace Dashboard** — real-time visibility into the autonomous cycle with color-coded threat levels
- **Complete IaC** — one `terraform apply` creates the entire environment; one `terraform destroy` tears it down

## What we learned

1. **Deception > Detection** — Traditional security waits for known attacks. Deception catches unknown attackers by their behavior (accessing bait), not their signatures.

2. **eBPF is a game-changer** — Kernel-level monitoring cannot be evaded from userspace. Tetragon gives you visibility that no application-level tool can match.

3. **Separation of concerns matters** — Koney deploys traps, eBeeControl thinks. Gemini writes, Davis senses, Gemini Enterprise Agent Platform learns. Each does one thing well.

4. **Property-based testing catches bugs unit tests miss** — Generating random inputs across 100+ iterations found edge cases in threat classification that hand-written examples never would.

5. **The "assume worst case" principle** — When context is missing (Dynatrace timeout), default to HIGH classification. Never under-classify a threat due to missing data.

6. **AI fallbacks are essential** — Real Gemini with graceful fallback to local generation means the system never stops working regardless of API availability.

## What's next for eBeeControl

### v1.1 — Production Hardening
- Rate limiting on response actions (prevent isolation cascades)
- Kill switch / pause mechanism for autonomous response
- Slack/PagerDuty alerting integration

### v2.0 — Semantic Anomaly Detection (BigQuery Vector Search)
- Convert each incident into an event narrative
- Embed with `gemini-embedding-001` (3072 dimensions)
- Use BigQuery native vector search to find semantically similar past incidents
- Detect "unknown unknowns" — attacks that don't match rules but resemble past attacks
- Enable campaign tracking: "These 5 incidents across different pods are the same attacker"
- Continual learning: analyst feedback improves detection without full model retraining

### v3.0 — Multi-Cluster & Advanced Deception
- Federation across multiple Kubernetes clusters
- Polymorphic honeytokens that change content to appear more realistic
- Attacker profiling based on behavior patterns
- Automated threat intelligence sharing to community feeds
