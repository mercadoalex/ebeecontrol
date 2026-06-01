# eBeeControl — Koney Integration

## What is Koney?

[Koney](https://github.com/dynatrace-oss/koney) is a **Dynatrace open-source Kubernetes operator** for automated cyber deception. It was developed by Dynatrace Research and published as an academic paper at EuroS&P 2025.

Koney enables you to define **DeceptionPolicy** custom resources that describe what honeytokens to deploy, where to place them, and how to monitor them — all as code.

**Repository:** https://github.com/dynatrace-oss/koney

---

## Why Koney Instead of Our Custom k8s-deployer.ts?

Our project initially included a custom `src/koney/k8s-deployer.ts` that creates Kubernetes Secrets directly. While this works, using the real Koney operator is significantly better:

| Aspect | Custom k8s-deployer.ts | Koney Operator |
|--------|----------------------|----------------|
| **Deployment method** | Creates raw K8s Secrets via API | Uses DeceptionPolicy CRDs (declarative) |
| **Rotation** | Manual — no automatic rotation | Automatic honeytoken rotation on schedule |
| **Teardown** | Manual cleanup on decommission | Automatic cleanup when policy is deleted |
| **eBPF monitoring** | Separate Tetragon setup required | Built-in eBPF detection via Tetragon |
| **Alert forwarding** | Custom code to forward events | Native Dynatrace security event integration |
| **Deception-as-code** | Imperative API calls | Declarative YAML policies (GitOps-friendly) |
| **Maintenance** | We maintain the deployment logic | Dynatrace maintains the operator |
| **Research-backed** | Ad-hoc implementation | Peer-reviewed academic research (EuroS&P 2025) |
| **Community** | Just us | Dynatrace OSS community |

---

## How eBeeControl Uses Koney

eBeeControl is the **intelligence layer on top of Koney**. The relationship is:

```
┌─────────────────────────────────────────────────────────────────┐
│                    eBeeControl (Our Agent)                        │
│                                                                 │
│  "The Brain" — Decides WHAT to do                               │
│                                                                 │
│  • WHERE to place honeytokens (Gemini + Vertex AI)              │
│  • HOW to classify threats (Davis AI context)                   │
│  • WHAT response to execute (pod isolation, IP block)           │
│  • WHY it happened (Gemini forensic reports)                    │
│  • HOW to improve (Vertex AI adaptive learning)                 │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 │ Creates/updates DeceptionPolicy CRDs
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Koney (Dynatrace OSS Operator)                 │
│                                                                 │
│  "The Hands" — Executes the deployment                          │
│                                                                 │
│  • Deploys honeytokens into pods (secrets, files, credentials)  │
│  • Rotates honeytokens on schedule                              │
│  • Monitors access via eBPF (Tetragon)                          │
│  • Forwards alerts to Dynatrace                                 │
│  • Cleans up when policies are removed                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## The DeceptionPolicy CRD

Koney introduces a custom resource called `DeceptionPolicy`. eBeeControl creates these programmatically based on Gemini's placement decisions:

```yaml
apiVersion: deception.dynatrace.com/v1alpha1
kind: DeceptionPolicy
metadata:
  name: ebeecontrol-payment-pod
  namespace: production
  labels:
    app.kubernetes.io/managed-by: ebeecontrol
spec:
  # Target pods matching these selectors
  podSelector:
    matchLabels:
      app: payment-gateway

  # Honeytokens to deploy
  honeytokens:
    - type: file
      name: decoy-aws-credentials
      path: /tmp/.config/credentials.json
      content: |
        {"aws_access_key_id": "AKIADECOY...", "aws_secret_access_key": "DECOY..."}

    - type: secret
      name: decoy-service-token
      path: /var/run/secrets/kubernetes.io/serviceaccount/decoy-token
      
    - type: file
      name: decoy-ssh-key
      path: /home/app/.ssh/id_rsa_prod
      content: |
        -----BEGIN RSA PRIVATE KEY-----
        DECOY-DO-NOT-USE
        -----END RSA PRIVATE KEY-----

  # Monitoring configuration
  monitoring:
    ebpf: true
    operations: [open, read, stat]
    
  # Rotation schedule
  rotation:
    interval: 7d
```

---

## Advantages for the Hackathon

Using Koney gives us significant advantages in the judging criteria:

### 1. Technological Implementation
- We're integrating with a **real Dynatrace open-source project** (not reinventing the wheel)
- Shows proper use of Kubernetes operators and CRDs
- Demonstrates understanding of the Dynatrace ecosystem

### 2. Design
- **Separation of concerns**: eBeeControl = brain, Koney = hands
- Declarative deception-as-code (GitOps compatible)
- Clean architecture — each component does one thing well

### 3. Potential Impact
- Koney is already research-validated (EuroS&P 2025 paper)
- eBeeControl adds the missing intelligence layer that Koney doesn't have
- Together they form a complete autonomous deception system

### 4. Quality of the Idea
- We're not just using Koney — we're **extending it with AI**
- Koney deploys traps; eBeeControl decides where, learns from outcomes, and responds autonomously
- This is the first system to combine Koney + Gemini + Vertex AI

---

## What Koney Does vs What eBeeControl Does

| Capability | Koney | eBeeControl |
|-----------|-------|-------------|
| Deploy honeytokens | ✅ | ❌ (delegates to Koney) |
| Rotate honeytokens | ✅ | ❌ (Koney handles) |
| Detect access (eBPF) | ✅ | ❌ (Koney + Tetragon) |
| Forward alerts to Dynatrace | ✅ | ❌ (Koney handles) |
| **Decide WHERE to place traps** | ❌ | ✅ (Gemini + Vertex AI) |
| **Classify threat severity** | ❌ | ✅ (Davis AI context) |
| **Autonomous response** | ❌ | ✅ (pod isolation, IP block) |
| **Generate forensic reports** | ❌ | ✅ (Gemini AI) |
| **Learn from incidents** | ❌ | ✅ (Vertex AI) |
| **Adaptive placement** | ❌ | ✅ (model improves over time) |
| **Full operational dashboard** | ❌ | ✅ (Dynatrace tiles) |

**Key insight:** Koney is a powerful deployment tool, but it has no intelligence. It doesn't know WHERE to put traps, HOW to respond to detections, or HOW to improve over time. That's what eBeeControl adds.

---

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    eBeeControl Agent                              │
│                                                                 │
│  1. Query Dynatrace → "Which services are high-risk?"           │
│  2. Ask Gemini → "What's the best placement strategy?"          │
│  3. Create DeceptionPolicy CRD → Koney deploys the traps       │
│  4. Koney detects access → Alert forwarded to Dynatrace         │
│  5. eBeeControl receives alert → Classify + Respond + Report    │
│  6. Submit outcome to Vertex AI → Model improves                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Current Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| eBeeControl agent | ✅ Complete | Full TypeScript implementation, 728 tests |
| Custom k8s-deployer.ts | ✅ Working | Fallback when Koney is not installed |
| Koney operator integration | 🔄 In progress | Agent creates DeceptionPolicy CRDs |
| Koney installed on cluster | ⚠️ Manual step | `helm install koney dynatrace-oss/koney` |

The system works in two modes:
1. **With Koney** (production): Agent creates DeceptionPolicy CRDs, Koney handles deployment + monitoring
2. **Without Koney** (demo/testing): Agent uses custom k8s-deployer.ts as a fallback

---

Made with ❤️ by Alex
