/**
 * eBeeControl Live Demo — Pushes real data to Dynatrace
 *
 * This script runs the full attack simulation and pushes all events
 * to your Dynatrace environment so you can see them on the dashboard.
 *
 * Prerequisites:
 *   export DYNATRACE_ENV_URL=https://abc12345.live.dynatrace.com
 *   export DYNATRACE_API_TOKEN=dt0c01.XXXXX
 *
 * Run: npx tsx scripts/demo-live.ts
 */

import { DynatraceMetricsIngestionClient } from '../src/dynatrace-ingestion/metrics-client.js';
import { DynatraceLogIngestionClient } from '../src/dynatrace-ingestion/log-client.js';
import { createEventBroadcaster } from '../src/dynatrace-ingestion/event-broadcaster.js';
import { createHoneytokenRegistry } from '../src/agent/registry.js';
import { createAuditLog } from '../src/agent/audit-log.js';
import { createReportGenerator } from '../src/agent/report-generator.js';
import { createGeminiClientWithFallback } from '../src/agent/gemini-report-generator.js';
import { createLearningFeedbackLoop } from '../src/agent/learning-feedback.js';
import { VertexAiTrainer } from '../src/vertex/trainer.js';
import { classifyThreat } from '../src/agent/threat-classifier.js';
import { generateResponsePlan } from '../src/agent/response-planner.js';
import { executeResponse } from '../src/agent/response-executor.js';
import { createHttpClient } from '../src/utils/http-client.js';
import { AccessEvent, PodContext, HoneytokenRegistryEntry, ThreatAssessment, ResponseAction } from '../src/types/index.js';
import { DynatraceIngestionConfig } from '../src/config.js';
import { v4 as uuidv4 } from 'uuid';

// ─── Configuration ────────────────────────────────────────────────────────────

const DYNATRACE_ENV_URL = process.env.DYNATRACE_ENV_URL;
const DYNATRACE_API_TOKEN = process.env.DYNATRACE_API_TOKEN;

if (!DYNATRACE_ENV_URL || !DYNATRACE_API_TOKEN) {
  console.error('❌ Missing environment variables:');
  console.error('   export DYNATRACE_ENV_URL=https://abc12345.live.dynatrace.com');
  console.error('   export DYNATRACE_API_TOKEN=dt0c01.XXXXX');
  process.exit(1);
}

const ingestionConfig: DynatraceIngestionConfig = {
  metricsEndpoint: `${DYNATRACE_ENV_URL}/api/v2/metrics/ingest`,
  logEndpoint: `${DYNATRACE_ENV_URL}/api/v2/logs/ingest`,
  apiToken: DYNATRACE_API_TOKEN,
  requestTimeoutSeconds: 10,
  retryConfig: {
    maxRetries: 3,
    initialBackoffSeconds: 2,
    backoffMultiplier: 2,
    maxBackoffSeconds: 16,
  },
  batchConfig: {
    maxBatchSize: 50,
    flushIntervalSeconds: 2,
  },
};

// ─── Setup ────────────────────────────────────────────────────────────────────

const httpClient = createHttpClient();
const metricsClient = new DynatraceMetricsIngestionClient(ingestionConfig, httpClient);
const logClient = new DynatraceLogIngestionClient(ingestionConfig, httpClient);
const broadcaster = createEventBroadcaster(metricsClient, logClient);
const registry = createHoneytokenRegistry();
const auditLog = createAuditLog();
const vertexTrainer = new VertexAiTrainer();
const learningLoop = createLearningFeedbackLoop(vertexTrainer, auditLog);
const reportGenerator = createReportGenerator(
  createGeminiClientWithFallback()
);

// ─── Demo ─────────────────────────────────────────────────────────────────────

async function runLiveDemo() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║      🐝 eBeeControl — Live Dynatrace Demo                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   Dynatrace: ${DYNATRACE_ENV_URL}`);
  console.log('');

  // ── Step 1: Deploy honeytokens and push to Dynatrace ──
  console.log('📡 Step 1: Deploying honeytokens across namespaces...');

  const honeytokens: HoneytokenRegistryEntry[] = [
    // Production namespace
    {
      honeytokenId: uuidv4(),
      podId: 'pod-payment-7f8d9c',
      namespace: 'production',
      type: 'decoy_secret',
      filePath: '/var/run/secrets/kubernetes.io/serviceaccount/decoy-token',
      deploymentTimestamp: new Date().toISOString(),
      status: 'active',
      accessCount: 0,
    },
    {
      honeytokenId: uuidv4(),
      podId: 'pod-auth-x9y8z7',
      namespace: 'production',
      type: 'decoy_file',
      filePath: '/tmp/.config/credentials.json',
      deploymentTimestamp: new Date().toISOString(),
      status: 'active',
      accessCount: 0,
    },
    {
      honeytokenId: uuidv4(),
      podId: 'pod-userdata-k5m6n7',
      namespace: 'production',
      type: 'decoy_credential',
      filePath: '/home/app/.ssh/id_rsa_prod',
      deploymentTimestamp: new Date().toISOString(),
      status: 'active',
      accessCount: 0,
    },
    // Staging namespace
    {
      honeytokenId: uuidv4(),
      podId: 'pod-api-stg-a3b4c5',
      namespace: 'staging',
      type: 'decoy_secret',
      filePath: '/var/run/secrets/kubernetes.io/serviceaccount/stg-token',
      deploymentTimestamp: new Date().toISOString(),
      status: 'active',
      accessCount: 0,
    },
    {
      honeytokenId: uuidv4(),
      podId: 'pod-worker-stg-d6e7f8',
      namespace: 'staging',
      type: 'decoy_file',
      filePath: '/tmp/.aws/credentials',
      deploymentTimestamp: new Date().toISOString(),
      status: 'active',
      accessCount: 0,
    },
    // Development namespace
    {
      honeytokenId: uuidv4(),
      podId: 'pod-devtools-g9h0i1',
      namespace: 'development',
      type: 'decoy_credential',
      filePath: '/root/.kube/config',
      deploymentTimestamp: new Date().toISOString(),
      status: 'active',
      accessCount: 0,
    },
    // Data namespace
    {
      honeytokenId: uuidv4(),
      podId: 'pod-postgres-j2k3l4',
      namespace: 'data',
      type: 'decoy_secret',
      filePath: '/var/secrets/db-master-password',
      deploymentTimestamp: new Date().toISOString(),
      status: 'active',
      accessCount: 0,
    },
    {
      honeytokenId: uuidv4(),
      podId: 'pod-redis-m5n6o7',
      namespace: 'data',
      type: 'decoy_file',
      filePath: '/etc/redis/tls-cert.pem',
      deploymentTimestamp: new Date().toISOString(),
      status: 'active',
      accessCount: 0,
    },
  ];

  for (const ht of honeytokens) {
    registry.addEntry(ht);
    await broadcaster.broadcastHoneytokenRegistryChange(ht);
    console.log(`   🍯 Deployed: ${ht.type} → ${ht.podId}`);
  }

  // Push health status
  await broadcaster.broadcastHealthStatusChange({
    componentName: 'Tetragon_Monitor',
    status: 'healthy',
    lastSuccessfulCheckTimestamp: new Date().toISOString(),
  });
  await broadcaster.broadcastHealthStatusChange({
    componentName: 'Koney_Deployer',
    status: 'healthy',
    lastSuccessfulCheckTimestamp: new Date().toISOString(),
  });
  await broadcaster.broadcastHealthStatusChange({
    componentName: 'Dynatrace_MCP_Server',
    status: 'healthy',
    lastSuccessfulCheckTimestamp: new Date().toISOString(),
  });
  await broadcaster.broadcastHealthStatusChange({
    componentName: 'Vertex_AI_Trainer',
    status: 'healthy',
    lastSuccessfulCheckTimestamp: new Date().toISOString(),
  });

  await metricsClient.flush();
  console.log('   ✅ Metrics pushed to Dynatrace');
  console.log('');

  await sleep(2000);

  // ── Step 2: Simulate attacks across multiple namespaces ──
  console.log('⚔️  Step 2: Simulating attacks across namespaces...');
  console.log('');

  // Prepare Gemini and Gist for forensic reports
  const { createGeminiClientWithFallback: createGemini } = await import('../src/agent/gemini-report-generator.js');
  const gemini = createGemini();
  const gistToken = process.env.GITHUB_GIST_TOKEN;

  let geminiAnalysis = '';
  try {
    geminiAnalysis = await gemini(`Analyze a multi-namespace Kubernetes security incident involving honeytoken access from suspicious processes. Provide: 1) Summary 2) Attacker intent 3) Recommended follow-up actions`);
  } catch {
    geminiAnalysis = '[Gemini unavailable — using fallback report]';
  }

  console.log(`   [debug] gistToken set: ${!!gistToken}, geminiAvailable: ${!geminiAnalysis.includes('[Gemini unavailable')}`);
  console.log('');

  // Define multiple attack scenarios across namespaces
  const attackScenarios = [
    {
      label: 'Production — Critical reverse shell',
      event: {
        eventId: uuidv4(),
        processId: 31337,
        processBinaryPath: '/tmp/.hidden/reverse-shell',
        userId: 0,
        podId: 'pod-payment-7f8d9c',
        namespace: 'production',
        honeytokenPath: '/var/run/secrets/kubernetes.io/serviceaccount/decoy-token',
        accessType: 'read' as const,
        timestamp: new Date().toISOString(),
      },
      podContext: {
        namespace: 'production',
        namespaceClassification: 'production' as const,
        serviceCriticality: 4,
        davisAnomalyScore: 0.85,
        anomalyWindowMinutes: 10,
      },
      honeytokenIdx: 0,
    },
    {
      label: 'Staging — Suspicious credential scan',
      event: {
        eventId: uuidv4(),
        processId: 8821,
        processBinaryPath: '/usr/bin/curl',
        userId: 1000,
        podId: 'pod-api-stg-a3b4c5',
        namespace: 'staging',
        honeytokenPath: '/var/run/secrets/kubernetes.io/serviceaccount/stg-token',
        accessType: 'read' as const,
        timestamp: new Date(Date.now() + 5000).toISOString(),
      },
      podContext: {
        namespace: 'staging',
        namespaceClassification: 'non-production' as const,
        serviceCriticality: 2,
        davisAnomalyScore: 0.55,
        anomalyWindowMinutes: 5,
      },
      honeytokenIdx: 3,
    },
    {
      label: 'Data — Database credential exfil attempt',
      event: {
        eventId: uuidv4(),
        processId: 4455,
        processBinaryPath: '/tmp/exfil-agent',
        userId: 0,
        podId: 'pod-postgres-j2k3l4',
        namespace: 'data',
        honeytokenPath: '/var/secrets/db-master-password',
        accessType: 'read' as const,
        timestamp: new Date(Date.now() + 10000).toISOString(),
      },
      podContext: {
        namespace: 'data',
        namespaceClassification: 'production' as const,
        serviceCriticality: 5,
        davisAnomalyScore: 0.92,
        anomalyWindowMinutes: 3,
      },
      honeytokenIdx: 6,
    },
    {
      label: 'Development — Low-severity file stat',
      event: {
        eventId: uuidv4(),
        processId: 12099,
        processBinaryPath: '/usr/bin/find',
        userId: 1001,
        podId: 'pod-devtools-g9h0i1',
        namespace: 'development',
        honeytokenPath: '/root/.kube/config',
        accessType: 'stat' as const,
        timestamp: new Date(Date.now() + 15000).toISOString(),
      },
      podContext: {
        namespace: 'development',
        namespaceClassification: 'non-production' as const,
        serviceCriticality: 1,
        davisAnomalyScore: 0.2,
        anomalyWindowMinutes: 30,
      },
      honeytokenIdx: 5,
    },
    {
      label: 'Staging — Worker pod write attempt',
      event: {
        eventId: uuidv4(),
        processId: 6677,
        processBinaryPath: '/bin/sh',
        userId: 0,
        podId: 'pod-worker-stg-d6e7f8',
        namespace: 'staging',
        honeytokenPath: '/tmp/.aws/credentials',
        accessType: 'write' as const,
        timestamp: new Date(Date.now() + 20000).toISOString(),
      },
      podContext: {
        namespace: 'staging',
        namespaceClassification: 'non-production' as const,
        serviceCriticality: 3,
        davisAnomalyScore: 0.7,
        anomalyWindowMinutes: 8,
      },
      honeytokenIdx: 4,
    },
  ];

  // Process each attack scenario
  for (const scenario of attackScenarios) {
    console.log(`   ─── ${scenario.label} ───`);

    const attackEvent = scenario.event;
    console.log(`   ⚠️  Attack: PID ${attackEvent.processId} ${attackEvent.accessType} ${attackEvent.honeytokenPath}`);

    // Assess threat
    const classification = classifyThreat(scenario.podContext);
    const assessment: ThreatAssessment = {
      assessmentId: uuidv4(),
      accessEventId: attackEvent.eventId,
      classification,
      inputs: {
        namespaceClassification: scenario.podContext.namespaceClassification,
        serviceCriticality: scenario.podContext.serviceCriticality,
        davisAnomalyScore: scenario.podContext.davisAnomalyScore,
      },
      assessmentTimestamp: new Date().toISOString(),
      assessmentLatencyMs: Math.floor(Math.random() * 5) + 1,
    };

    console.log(`   🎯 Classification: ${classification.toUpperCase()}`);

    // Broadcast access event
    await broadcaster.broadcastAccessEvent(attackEvent, classification);

    // Execute response
    const plan = generateResponsePlan(assessment, {
      namespace: attackEvent.namespace,
      podId: attackEvent.podId,
    });

    const responseResult = await executeResponse(plan, assessment, {
      isolatePod: async (podId) => {
        console.log(`   🔒 Pod ${podId} isolated`);
      },
      blockIp: async (podId) => {
        console.log(`   🚫 IP blocked for ${podId}`);
      },
      deployHoneytokens: async (ns, count) => {
        console.log(`   🍯 ${count} additional honeytokens deployed in ${ns}`);
      },
      sendAlert: async () => {},
      auditLog,
    });

    // Broadcast response actions
    for (const action of responseResult.actions) {
      await broadcaster.broadcastResponseAction(action);
    }

    // Update registry
    registry.updateStatus(honeytokens[scenario.honeytokenIdx].honeytokenId, 'triggered');
    await broadcaster.broadcastHoneytokenRegistryChange({
      ...honeytokens[scenario.honeytokenIdx],
      status: 'triggered',
    });

    // Generate forensic report
    const report = await reportGenerator.generate({
      accessEvent: attackEvent,
      threatAssessment: assessment,
      responseActions: responseResult.actions,
    });

    // Publish gist
    let gistUrl = '';
    if (gistToken && geminiAnalysis) {
      try {
        const { publishToGist } = await import('../src/utils/gist-publisher.js');
        const gist = await publishToGist(
          `incident-${report.reportId}`,
          `# Incident Report: ${scenario.label}\n\n${geminiAnalysis}`,
          gistToken
        );
        gistUrl = gist.url;
        console.log(`   📎 Report: ${gistUrl}`);
      } catch (error) {
        console.log(`   ⚠️  Gist failed: ${error instanceof Error ? error.message : error}`);
      }
    }

    await broadcaster.broadcastForensicReport(report, { gistUrl: gistUrl || undefined });

    // Broadcast incident timeline
    const finalOutcome = classification === 'low' ? 'false_positive' as const
      : classification === 'critical' ? 'escalated' as const
      : 'contained' as const;

    await broadcaster.broadcastIncidentTimeline({
      incidentId: uuidv4(),
      timestamp: attackEvent.timestamp,
      threatClassification: classification,
      affectedPodId: attackEvent.podId,
      namespace: attackEvent.namespace,
      responseActions: responseResult.actions.map(a => ({
        actionType: a.actionType,
        outcome: a.result,
      })),
      finalOutcome,
    });

    console.log(`   ✅ Incident processed: ${finalOutcome}`);
    console.log('');

    await sleep(1500);
  }

  // ── Step 3: Submit learning metrics ──
  console.log('🧬 Step 3: Submitting learning metrics to Vertex AI...');

  await broadcaster.broadcastLearningMetrics({
    modelVersionId: vertexTrainer.getCurrentModelVersion().versionId,
    validationAccuracy: vertexTrainer.getCurrentModelVersion().validationAccuracy,
    trainingDatasetSize: vertexTrainer.getDatasetSize(),
    trainingStatus: 'idle',
  });

  console.log('   ✅ Learning metrics submitted');

  // ── Flush all data to Dynatrace ──
  console.log('');
  console.log('📤 Flushing all data to Dynatrace...');
  await metricsClient.flush();
  await logClient.flush();

  console.log('   ✅ All data pushed to Dynatrace');
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   ✅ Demo complete! Check your Dynatrace Dashboard          ║');
  console.log(`║   ${DYNATRACE_ENV_URL}                                      `);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runLiveDemo().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
