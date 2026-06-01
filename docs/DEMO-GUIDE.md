# eBeeControl — Demo Presentation Guide

## Dashboard URL

🔗 **https://lfl68751.apps.dynatrace.com/ui/document/v0/#share=c9a392f8-2886-4abc-9ab1-3d27b9876b79**

---

## Before the Demo

### 1. Set environment variables

```bash
export DYNATRACE_ENV_URL=https://lfl68751.live.dynatrace.com
export DYNATRACE_API_TOKEN=<your-token>
export GEMINI_API_KEY=<your-gemini-key>
```

### 2. Push fresh data

```bash
cd /Users/alexmarket/Desktop/eBeeControl
npm run demo:live
sleep 5
npm run demo:live
sleep 5
npm run demo:live
```

Running it 3 times gives you multiple incidents to show in the timeline.

### 3. Open the dashboard

Open the link above. Wait 1-2 minutes for Dynatrace to process the ingested logs.

---

## Demo Script (What to Say)

### Opening (30 seconds)

> "eBeeControl is an autonomous deception engine for Kubernetes. It deploys honeytokens — decoy secrets, files, and credentials — into your cluster, detects when attackers access them using eBPF kernel monitoring, and responds autonomously within milliseconds. No human intervention required."

---

### Section 1: 🛡️ Defense Posture

**Tile: Honeytokens by Type (Table)**

> "Here you can see our deployed honeytokens broken down by type. We deploy three kinds of traps:
> - **Decoy secrets** — fake Kubernetes service account tokens
> - **Decoy files** — fake AWS credentials, config files
> - **Decoy credentials** — fake SSH private keys
>
> The system automatically places these in high-risk pods identified by Dynatrace's Davis AI."

**Tile: Honeytokens Deployed Over Time (Line Chart)**

> "This shows when honeytokens were deployed. Each spike represents a discovery cycle where the agent found new high-risk services and deployed traps. The system runs this cycle every 60 minutes."

**Tile: Active Honeytokens Registry (Table)**

> "This is the full registry — every honeytoken we've deployed, which pod it's in, what type it is, and its current status. Notice some are marked 'triggered' — those were accessed by an attacker."

---

### Section 2: ⚔️ Attack Detection

**Tile: Threat Level Distribution (Bar Chart)**

> "When an attacker accesses a honeytoken, the system classifies the threat based on three factors:
> - Is it a production namespace?
> - What's the service criticality (1-5)?
> - What's the Davis AI anomaly score?
>
> You can see most of our detections are CRITICAL — because the attacker is accessing secrets in production pods with high anomaly scores."

**Tile: Attacks Over Time (Area Chart)**

> "This shows the volume of attacks over time. Each peak represents an active intrusion attempt. The system detected and responded to each one autonomously."

**Tile: Latest Access Events (Table)**

> "Here's the raw event feed — every honeytoken access detected by Tetragon's eBPF probes at the kernel level. You can see the process binary path — in this case `/tmp/.hidden/reverse-shell` — which is clearly malicious. The system detected this within 1 second of the file access."

---

### Section 3: ⚡ Autonomous Response

**Tile: Response Actions by Type (Bar Chart)**

> "Once a threat is classified, the system responds autonomously. For CRITICAL threats, it takes three actions:
> 1. **Pod isolation** — cuts all network access via NetworkPolicy
> 2. **IP block** — blocks the attacker's source IP
> 3. **Additional honeytokens** — deploys more traps in the same namespace to catch lateral movement"

**Tile: Success vs Failure (Pie Chart)**

> "This shows our response success rate. All actions succeeded — the attacker was contained within 10 seconds of detection. If any action fails, the system retries up to 3 times and sends escalation alerts."

**Tile: Response Action Log (Table)**

> "The detailed log of every response action — what was done, to which target, what triggered it, and whether it succeeded. This is your audit trail for compliance."

---

### Section 4: 📋 Incidents & Forensics

**Tile: Incident Outcomes (Pie Chart)**

> "Every incident gets a final outcome:
> - **Contained** — attacker was stopped autonomously
> - **Escalated** — response failed, manual intervention needed
> - **False positive** — detection was not a real threat
>
> You can see 100% containment — the system handled everything without human intervention."

**Tile: Incident Timeline (Table)**

> "The full chronological history of every security incident. Each row is a complete attack-response cycle: when it happened, what threat level, which pod was targeted, and the final outcome. This is what your SOC team reviews in the morning."

---

### Section 5: 🧬 Adaptive Learning & Health

**Tile: Component Health (Table)**

> "The system monitors its own health — Tetragon (eBPF detection), Koney operator (honeytoken deployment), Dynatrace (context), and Gemini Enterprise Agent Platform (learning). All components are healthy. If any component fails, the system continues operating with the remaining healthy components and sends alerts."

**Tile: Model Performance (Table)**

> "The Gemini Enterprise Agent Platform placement model improves over time. After every incident, the outcome is fed back to the model. It retrains every 24 hours and only publishes a new model if accuracy improves. This means the system gets smarter about where to place honeytokens without any manual policy updates."

---

### Closing (30 seconds)

> "To summarize: eBeeControl detected an attacker reading a honeytoken in a production pod. Within milliseconds, it:
> - Classified the threat as CRITICAL
> - Isolated the pod from the network
> - Blocked the attacker's IP
> - Deployed additional traps
> - Generated a forensic report
> - Updated the AI model for future defense
>
> All of this happened autonomously. No human intervention. No manual policy updates. The system learns and adapts on its own."

---

## Live Demo (Optional)

If you want to show it happening in real-time during the presentation:

1. Have the dashboard open
2. In a terminal, run: `npm run demo:live`
3. Wait 30 seconds
4. Refresh the dashboard — new data appears

> "Let me trigger an attack right now... [runs demo:live] ... and you can see the new incident appearing in the timeline. The system just detected, classified, responded, and reported — all in under 15 seconds."

---

## Q&A Preparation

| Question | Answer |
|----------|--------|
| "Can attackers evade this?" | "No — detection uses eBPF kernel probes. You can't evade kernel-level monitoring from userspace." |
| "What about false positives?" | "Honeytokens are never accessed by legitimate processes. Any access is suspicious by definition." |
| "How does it scale?" | "One agent per cluster. Tetragon runs as a DaemonSet on every node. Scales with the cluster." |
| "What if Dynatrace is down?" | "The system continues operating. Events are buffered locally and delivered when connectivity resumes." |
| "What's the cost?" | "~$50-70/month for the GKE cluster. Gemini API costs < $0.01 per incident. Dynatrace is existing infrastructure." |
| "How long to deploy?" | "One command: `terraform apply`. Full cluster + agent + Tetragon in ~10 minutes." |

---

## Technical Details (If Asked)

- **728 tests** with 24 property-based correctness guarantees
- **TypeScript** with strict mode
- **Tetragon eBPF** for kernel-level detection (< 1 second)
- **Gemini 2.0 Flash** for forensic report generation
- **Gemini Enterprise Agent Platform** for adaptive placement model
- **Dynatrace** for context, anomaly detection, and dashboard
- **Kubernetes NetworkPolicies** for pod isolation
- **Helm + Terraform + GitHub Actions** for deployment

---

Made with ❤️ by Alex
