# eBeeControl — Video Script (Under 3 Minutes)

## Setup Before Recording

```bash
export DYNATRACE_ENV_URL=https://lfl68751.live.dynatrace.com
export DYNATRACE_API_TOKEN=your_token
npm run demo:live && sleep 5 && npm run demo:live && sleep 5 && npm run demo:live
```

Wait 2 minutes, then open the dashboard.

---

## Script

### INTRO (0:00 - 0:20)

> "Hi, I'm Alex. This is eBeeControl — an autonomous deception engine for Kubernetes.
>
> It uses Gemini AI to deploy honeytokens into your cluster, detects attackers using eBPF kernel monitoring, and responds autonomously — all without human intervention.
>
> Let me show you how it works through our Dynatrace dashboard."

*[Show: Full dashboard overview, scroll slowly]*

---

### 🛡️ DEFENSE POSTURE (0:20 - 0:50)

*[Point to: Total Honeytokens single value]*

> "First, our defense posture. The agent has deployed honeytokens — decoy secrets, fake credentials, and trap files — across the cluster."

*[Point to: Pie chart]*

> "We deploy three types: decoy secrets like fake service account tokens, decoy files like fake AWS credentials, and decoy SSH keys. Each one is bait designed to catch attackers."

*[Point to: Bar chart]*

> "These are distributed across production namespaces — exactly where attackers would look for real credentials."

---

### ⚔️ UNDER ATTACK (0:50 - 1:20)

*[Point to: Total Attacks single value — should be red/orange]*

> "Now the interesting part. The system has detected multiple attacks."

*[Point to: Threat Level pie chart]*

> "Each detection is classified using Dynatrace Davis AI context — namespace, service criticality, and anomaly scores. You can see most are CRITICAL — because the attacker is accessing secrets in production pods with high anomaly scores."

*[Point to: Attack Timeline area chart]*

> "This timeline shows when attacks happened. The eBPF kernel probes detected file access within one second — there's no way to evade kernel-level monitoring from userspace."

---

### ⚡ AUTONOMOUS RESPONSE (1:20 - 1:50)

*[Point to: Response Actions single value — green]*

> "Here's where eBeeControl shines. For every critical threat, the system responded autonomously."

*[Point to: Actions by Type bar chart]*

> "Three types of response: pod isolation cuts all network access, IP blocking stops the attacker's source, and additional honeytokens are deployed to catch lateral movement."

*[Point to: Containment Outcomes pie chart]*

> "And the result — 100% contained. Every attacker was stopped within 15 seconds of detection. No human intervention required."

---

### 🧬 GETTING SMARTER (1:50 - 2:15)

*[Point to: Model Accuracy single value]*

> "The system doesn't just respond — it learns. After every incident, the outcome is fed to the Gemini Enterprise Agent Platform."

*[Point to: Training Dataset single value]*

> "The placement model retrains every 24 hours on real attack data. It only publishes a new model if accuracy improves — so the system can never get worse, only better."

*[Point to: System Health table]*

> "And all components are monitored — Tetragon for eBPF detection, Koney for deployment, Dynatrace for context, and the AI trainer. If anything fails, the system degrades gracefully and alerts the team."

---

### 📋 INCIDENT TIMELINE (2:15 - 2:35)

*[Point to: Incident Timeline table]*

> "Finally, the full audit trail. Every incident — when it happened, what threat level, which pod was targeted, and the outcome. This is what your SOC team reviews. Gemini also generates a detailed forensic report for each incident with recommended follow-up actions."

---

### CLOSING (2:35 - 2:55)

> "To summarize — eBeeControl combines five technologies:
>
> - **Koney** deploys the traps
> - **Tetragon eBPF** detects access at the kernel level
> - **Dynatrace Davis AI** provides real-time context
> - **Gemini** classifies threats and writes forensic reports
> - **Gemini Enterprise Agent Platform** learns and improves placement over time
>
> The result: an autonomous security system that detects and contains attackers in under 15 seconds, learns from every incident, and never needs human intervention.
>
> Thank you."

---

## Total Time: ~2:55

## Tips for Recording

1. **Screen layout**: Dashboard full screen, no other tabs visible
2. **Mouse movement**: Point to each tile as you talk about it
3. **Pace**: Don't rush — let the visuals speak
4. **Energy**: Start calm (defense), build tension (attack), resolve (response), end confident (learning)
5. **Optional**: Split screen with terminal running `npm run demo:live` at the start to show data flowing in

---

Made with ❤️ by Alex
