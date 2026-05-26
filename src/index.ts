/**
 * ebeecontrol - Autonomous deception engine for Kubernetes honeytoken deployment and monitoring.
 *
 * Application entry point that instantiates all components, wires dependencies,
 * connects event flow, and starts scheduled operations.
 *
 * Validates: Requirements 8.1, 8.2
 */

import { loadConfig, EbeecontrolConfig } from './config';
import { DynatraceClient, FetchFn } from './dynatrace/client';
import { createKoneyDeployer, KoneyDeployer } from './koney/deployer';
import { createTetragonMonitor, TetragonMonitor } from './tetragon/monitor';
import { createHoneytokenRegistry, HoneytokenRegistry } from './agent/registry';
import { createAuditLog, AuditLog } from './agent/audit-log';
import { VertexAiTrainer } from './vertex/trainer';
import { createEventBroadcaster, EventBroadcaster } from './dynatrace-ingestion/event-broadcaster';
import { createHealthMonitor, HealthMonitor } from './agent/health-monitor';
import { createOrchestrator, Orchestrator } from './agent/orchestrator';
import { createDeploymentOrchestrator, DeploymentOrchestrator } from './agent/deployment-orchestrator';
import { createLearningFeedbackLoop, LearningFeedbackLoop } from './agent/learning-feedback';
import { createReportGenerator, ReportGenerator } from './agent/report-generator';
import { DynatraceMetricsIngestionClient } from './dynatrace-ingestion/metrics-client';
import { DynatraceLogIngestionClient } from './dynatrace-ingestion/log-client';
import { rankServices } from './utils/ranking';

/**
 * All instantiated components of the ebeecontrol system.
 */
export interface AgentComponents {
  config: EbeecontrolConfig;
  dynatraceClient: DynatraceClient;
  koneyDeployer: KoneyDeployer;
  tetragonMonitor: TetragonMonitor;
  registry: HoneytokenRegistry;
  auditLog: AuditLog;
  vertexAiTrainer: VertexAiTrainer;
  eventBroadcaster: EventBroadcaster;
  healthMonitor: HealthMonitor;
  orchestrator: Orchestrator;
  deploymentOrchestrator: DeploymentOrchestrator;
  learningFeedbackLoop: LearningFeedbackLoop;
  reportGenerator: ReportGenerator;
  metricsClient: DynatraceMetricsIngestionClient;
  logClient: DynatraceLogIngestionClient;
}

/**
 * Agent lifecycle handle returned by startAgent().
 */
export interface AgentHandle {
  components: AgentComponents;
  stop: () => Promise<void>;
}

/**
 * Creates and wires all system components with proper configuration.
 *
 * Dependency wiring:
 * Orchestrator → DynatraceClient → KoneyDeployer → TetragonMonitor →
 * Registry → AuditLog → VertexAiTrainer → EventBroadcaster → HealthMonitor
 *
 * Event flow:
 * Tetragon → Dynatrace → Agent → Response → Learning → Dynatrace Ingestion
 */
export function createComponents(
  configOverrides?: Partial<EbeecontrolConfig>,
  fetchFn?: FetchFn
): AgentComponents {
  // Load and validate configuration
  const config = loadConfig(configOverrides as any);

  // Default fetch function (no-op for testing; real implementation would use node-fetch)
  const fetch: FetchFn = fetchFn ?? (async () => ({ ok: true, status: 200, json: async () => ({}) }));

  // Instantiate core components
  const dynatraceClient = new DynatraceClient(
    { endpointUrl: config.notifications.channelEndpoint || 'http://localhost:8080' },
    fetch
  );

  const koneyDeployer = createKoneyDeployer();
  const tetragonMonitor = createTetragonMonitor();
  const registry = createHoneytokenRegistry();
  const auditLog = createAuditLog({ retentionDays: config.auditLog.retentionDays });

  const vertexAiTrainer = new VertexAiTrainer({
    retrainingIntervalHours: config.learning.retrainingIntervalHours,
    minimumOutcomeRecords: config.learning.minimumOutcomeRecords,
  });

  // Instantiate Dynatrace ingestion clients
  const metricsClient = new DynatraceMetricsIngestionClient(config.dynatraceIngestion, fetch);
  const logClient = new DynatraceLogIngestionClient(config.dynatraceIngestion, fetch);

  // Wire event broadcaster to ingestion clients
  const eventBroadcaster = createEventBroadcaster(metricsClient, logClient);

  // Wire health monitor with component health checks
  const healthMonitor = createHealthMonitor({
    checkIntervalSeconds: config.healthCheck.intervalSeconds,
    componentTimeoutSeconds: config.healthCheck.componentTimeoutSeconds,
  });

  // Register component health checks
  healthMonitor.registerComponent({
    name: 'Tetragon_Monitor',
    check: async () => { await tetragonMonitor.getRegisteredPaths(); },
  });

  healthMonitor.registerComponent({
    name: 'Koney_Deployer',
    check: async () => { await koneyDeployer.getDeploymentStatus('health-check'); },
  });

  healthMonitor.registerComponent({
    name: 'Dynatrace_MCP_Server',
    check: async () => { await dynatraceClient.getPodContext('health-check', 'default'); },
  });

  healthMonitor.registerComponent({
    name: 'Vertex_AI_Trainer',
    check: async () => { vertexAiTrainer.getTrainingStatus(); },
  });

  // Wire orchestrator for discovery cycle scheduling
  const orchestrator = createOrchestrator(
    { discoveryIntervalMinutes: config.discovery.intervalMinutes },
    {
      queryHighRiskServices: () => dynatraceClient.queryHighRiskServices(),
      rankServices,
    }
  );

  // Wire deployment orchestrator
  const deploymentOrchestrator = createDeploymentOrchestrator({
    deployer: koneyDeployer,
    registry,
    tetragonMonitor,
  });

  // Wire learning feedback loop
  const learningFeedbackLoop = createLearningFeedbackLoop(vertexAiTrainer, auditLog);

  // Wire report generator (using a mock Gemini function; real implementation would call Gemini API)
  const reportGenerator = createReportGenerator(
    async (prompt: string) => `Forensic report generated for: ${prompt.substring(0, 50)}...`
  );

  return {
    config,
    dynatraceClient,
    koneyDeployer,
    tetragonMonitor,
    registry,
    auditLog,
    vertexAiTrainer,
    eventBroadcaster,
    healthMonitor,
    orchestrator,
    deploymentOrchestrator,
    learningFeedbackLoop,
    reportGenerator,
    metricsClient,
    logClient,
  };
}

/**
 * Starts the ebeecontrol agent with all components wired and scheduled operations running.
 *
 * Starts:
 * 1. Discovery cycle scheduler (configurable interval, default 60 min)
 * 2. Health monitor (configurable interval, default 30s)
 * 3. Dynatrace ingestion flush timers (configurable interval, default 5s)
 *
 * @param configOverrides - Optional partial config to override defaults
 * @param fetchFn - Optional fetch function for HTTP calls (useful for testing)
 * @returns An AgentHandle with components and a stop function
 */
export async function startAgent(
  configOverrides?: Partial<EbeecontrolConfig>,
  fetchFn?: FetchFn
): Promise<AgentHandle> {
  const components = createComponents(configOverrides, fetchFn);

  // Start Tetragon monitor
  await components.tetragonMonitor.start();

  // Start discovery cycle scheduler
  components.orchestrator.start();

  // Start health monitor
  components.healthMonitor.start();

  // Start Dynatrace ingestion flush timers
  components.metricsClient.startPeriodicFlush();
  components.logClient.startPeriodicFlush();

  return {
    components,
    stop: async () => stopAgent(components),
  };
}

/**
 * Stops the ebeecontrol agent, clearing all scheduled operations and releasing resources.
 */
export async function stopAgent(components: AgentComponents): Promise<void> {
  // Stop scheduled operations
  components.orchestrator.stop();
  components.healthMonitor.stop();
  components.metricsClient.stopPeriodicFlush();
  components.logClient.stopPeriodicFlush();

  // Stop Tetragon monitor
  await components.tetragonMonitor.stop();
}

// Auto-start when running as main process
const isMainModule = typeof require !== 'undefined' && require.main === module;
if (isMainModule || process.argv[1]?.endsWith('index.js')) {
  console.log('🐝 eBeeControl starting...');

  startAgent()
    .then((handle) => {
      console.log('🐝 eBeeControl agent is running');
      console.log(`   Discovery cycle: every ${handle.components.config.discovery.intervalMinutes} minutes`);
      console.log(`   Health check: every ${handle.components.config.healthCheck.intervalSeconds} seconds`);
      console.log('   Press Ctrl+C to stop');

      // Handle graceful shutdown
      const shutdown = async () => {
        console.log('\n🐝 eBeeControl shutting down...');
        await handle.stop();
        console.log('🐝 eBeeControl stopped');
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((error) => {
      console.error('🐝 eBeeControl failed to start:', error);
      process.exit(1);
    });
}
