/**
 * eBeeControl Demo Script — Simulates a full attack cycle
 *
 * This script demonstrates the complete autonomous deception workflow:
 * 1. Discovery — finds high-risk services
 * 2. Deployment — places honeytokens in vulnerable pods
 * 3. Detection — attacker accesses a honeytoken
 * 4. Assessment — classifies the threat level
 * 5. Response — isolates pod, blocks IP, deploys more traps
 * 6. Reporting — generates forensic report
 * 7. Learning — submits outcome to Vertex AI
 *
 * Run: npx tsx scripts/demo.ts
 */

import { createComponents } from '../src/index.js';
import { createWorkflowController } from '../src/agent/workflow.js';
import { AccessEvent } from '../src/types/index.js';
import { FetchFn, FetchResponse } from '../src/dynatrace/client.js';

// ─── Simulated Dynatrace MCP Server ───────────────────────────────────────────

const mockFetch: FetchFn = async (url: string): Promise<FetchResponse> => {
  // Simulate high-risk service discovery
  if (url.includes('/high-risk')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        services: [
          {
            serviceId: 'svc-payment-gateway',
            serviceName: 'payment-gateway',
            namespace: 'production',
            podIdentifiers: ['pod-payment-7f8d9c', 'pod-payment-a3b2c1'],
            riskScore: 95,
          },
          {
            serviceId: 'svc-auth-service',
            serviceName: 'auth-service',
            namespace: 'production',
            podIdentifiers: ['pod-auth-x9y8z7'],
            riskScore: 88,
          },
          {
            serviceId: 'svc-user-data',
            serviceName: 'user-data-api',
            namespace: 'production',
            podIdentifiers: ['pod-userdata-k5m6n7'],
            riskScore: 72,
          },
        ],
      }),
    };
  }

  // Simulate pod context (production, high criticality, elevated anomaly)
  if (url.includes('/context')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        namespace: 'production',
        namespaceClassification: 'production',
        serviceCriticality: 4,
        davisAnomalyScore: 0.82,
        anomalyWindowMinutes: 10,
      }),
    };
  }

  // Default success for all other calls (metrics, logs, reports)
  return { ok: true, status: 200, json: async () => ({}) };
};

// ─── Demo Execution ───────────────────────────────────────────────────────────

async function runDemo() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          🐝 eBeeControl — Attack Simulation Demo           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Phase 1: Initialize ──
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📡 Phase 1: Initializing eBeeControl Agent');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const components = createComponents(undefined, mockFetch);
  const workflow = createWorkflowController({
    dynatraceClient: components.dynatraceClient,
    registry: components.registry,
    auditLog: components.auditLog,
    eventBroadcaster: components.eventBroadcaster,
    reportGenerator: components.reportGenerator,
    learningFeedbackLoop: components.learningFeedbackLoop,
    deploymentOrchestrator: components.deploymentOrchestrator,
    orchestrator: components.orchestrator,
    responseExecutorDeps: {
      isolatePod: async (podId) => {
        console.log(`   🔒 [K8s API] Pod ${podId} isolated via NetworkPolicy`);
      },
      blockIp: async (podId) => {
        console.log(`   🚫 [K8s API] Source IP blocked for ${podId}`);
      },
      deployHoneytokens: async (namespace, count) => {
        console.log(`   🍯 [Koney] Deployed ${count} additional honeytokens in ${namespace}`);
      },
      sendAlert: async (message) => {
        console.log(`   🚨 [Alert] ${message}`);
      },
      auditLog: components.auditLog,
    },
  });

  console.log('   ✅ Agent initialized with all components');
  console.log('   ✅ Dynatrace MCP Server connected (simulated)');
  console.log('   ✅ Tetragon Monitor active');
  console.log('   ✅ Vertex AI Trainer ready');
  console.log('');

  await sleep(1000);

  // ── Phase 2: Discovery ──
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 Phase 2: High-Risk Service Discovery');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('   Querying Dynatrace for high-risk services...');

  await sleep(800);
  await workflow.runDiscoveryAndDeployment();

  const registryEntries = components.registry.getAll();
  console.log(`   ✅ Found 3 high-risk services in production namespace`);
  console.log(`   ✅ Ranked by risk score: payment-gateway (95), auth-service (88), user-data-api (72)`);
  console.log(`   ✅ Deployed ${registryEntries.length} honeytokens across target pods`);
  console.log('');
  console.log('   Deployed honeytokens:');
  for (const entry of registryEntries.slice(0, 6)) {
    console.log(`     🍯 ${entry.type} → ${entry.podId}:${entry.filePath}`);
  }
  if (registryEntries.length > 6) {
    console.log(`     ... and ${registryEntries.length - 6} more`);
  }
  console.log('');

  await sleep(1500);

  // ── Phase 3: Simulated Attack ──
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚔️  Phase 3: ATTACK DETECTED — Honeytoken Accessed!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Pick a deployed honeytoken to "trigger"
  const targetEntry = registryEntries[0];

  const attackEvent: AccessEvent = {
    eventId: 'evt-attack-001',
    processId: 31337,
    processBinaryPath: '/tmp/.hidden/reverse-shell',
    userId: 0,
    podId: targetEntry.podId,
    namespace: targetEntry.namespace,
    honeytokenPath: targetEntry.filePath,
    accessType: 'read',
    timestamp: new Date().toISOString(),
  };

  console.log(`   ⚠️  Tetragon eBPF detected file access:`);
  console.log(`      Process: ${attackEvent.processBinaryPath} (PID: ${attackEvent.processId})`);
  console.log(`      User: root (UID: ${attackEvent.userId})`);
  console.log(`      Pod: ${attackEvent.podId}`);
  console.log(`      File: ${attackEvent.honeytokenPath}`);
  console.log(`      Type: ${attackEvent.accessType}`);
  console.log(`      Time: ${attackEvent.timestamp}`);
  console.log('');

  await sleep(1000);

  // ── Phase 4: Threat Assessment ──
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧠 Phase 4: Contextual Threat Assessment (Gemini)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('   Querying Dynatrace for pod context...');

  await sleep(600);

  console.log('   Context received:');
  console.log('     • Namespace: production ⚠️');
  console.log('     • Service Criticality: 4/5 ⚠️');
  console.log('     • Davis AI Anomaly Score: 0.82 🔴');
  console.log('');
  console.log('   Gemini classification: production AND anomaly > 0.8');

  await sleep(500);

  // ── Phase 5: Full Workflow Execution ──
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚡ Phase 5: Autonomous Response Execution');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const result = await workflow.processAccessEvent(attackEvent);

  console.log('');
  console.log(`   🎯 Threat Classification: ${result.assessment.classification.toUpperCase()}`);
  console.log(`   ⏱️  Assessment Latency: ${result.assessment.assessmentLatencyMs}ms`);
  console.log('');
  console.log('   Response Actions:');
  for (const action of result.responseResult.actions) {
    const icon = action.result === 'success' ? '✅' : '❌';
    console.log(`     ${icon} ${action.actionType} → ${action.target} [${action.result}]`);
  }
  console.log('');

  await sleep(1000);

  // ── Phase 6: Forensic Report ──
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Phase 6: Forensic Report Generated');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Report ID: ${result.forensicReport.reportId}`);
  console.log(`   Generated: ${result.forensicReport.generationTimestamp}`);
  console.log(`   Retention: ${result.forensicReport.retentionDays} days`);
  console.log('');
  console.log('   Timeline:');
  for (const entry of result.forensicReport.timeline) {
    console.log(`     ${entry.timestamp} — ${entry.eventDescription}`);
  }
  console.log('');
  console.log('   Recommended Follow-Up Actions:');
  for (const action of result.forensicReport.recommendedFollowUpActions) {
    console.log(`     → ${action}`);
  }
  console.log('');

  await sleep(800);

  // ── Phase 7: Learning ──
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧬 Phase 7: Adaptive Learning');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Outcome submitted to Vertex AI: ${result.outcomeSubmitted ? '✅' : '❌'}`);
  console.log(`   Broadcast to Dynatrace: ${result.broadcastCompleted ? '✅' : '❌'}`);
  console.log(`   Training dataset size: ${components.vertexAiTrainer.getDatasetSize()} records`);
  console.log(`   Current model: ${components.vertexAiTrainer.getCurrentModelVersion().versionId}`);
  console.log(`   Model accuracy: ${components.vertexAiTrainer.getCurrentModelVersion().validationAccuracy}%`);
  console.log('');

  await sleep(500);

  // ── Phase 8: Audit Log ──
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 Phase 8: Audit Trail');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const auditEntries = components.auditLog.getAll();
  console.log(`   Total audit entries: ${auditEntries.length}`);
  console.log('');
  console.log('   Recent decisions:');
  for (const entry of auditEntries.slice(-5)) {
    console.log(`     [${entry.decisionType.toUpperCase()}] ${entry.decisionRationale.substring(0, 70)}`);
  }
  console.log('');

  // ── Summary ──
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    🐝 Demo Complete                         ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║                                                              ║');
  console.log(`║  Threat Level:     ${result.assessment.classification.toUpperCase().padEnd(38)}║`);
  console.log(`║  Response Time:    ${result.assessment.assessmentLatencyMs}ms${' '.repeat(35 - String(result.assessment.assessmentLatencyMs).length)}║`);
  console.log(`║  Actions Taken:    ${result.responseResult.actions.length}${' '.repeat(37)}║`);
  console.log(`║  All Succeeded:    ${result.responseResult.allSucceeded ? 'Yes' : 'No'}${' '.repeat(35)}║`);
  console.log(`║  Report Generated: Yes${' '.repeat(35)}║`);
  console.log(`║  Learning Updated: ${result.outcomeSubmitted ? 'Yes' : 'No'}${' '.repeat(35)}║`);
  console.log('║                                                              ║');
  console.log('║  The attacker accessed a honeytoken. Within milliseconds:    ║');
  console.log('║  • Pod was isolated from the network                         ║');
  console.log('║  • Source IP was blocked                                     ║');
  console.log('║  • Additional traps were deployed                            ║');
  console.log('║  • Forensic report was generated                             ║');
  console.log('║  • AI model was updated for future defense                   ║');
  console.log('║                                                              ║');
  console.log('║  No human intervention required. Fully autonomous.           ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the demo
runDemo().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
