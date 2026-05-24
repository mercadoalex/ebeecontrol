# Implementation Plan: ebeecontrol

## Overview

Implement the ebeecontrol autonomous deception engine as a TypeScript application. The system orchestrates honeytoken deployment and monitoring in Kubernetes environments using a Gemini-powered agent, eBPF-based detection (Tetragon), decoy deployment (Koney), observability context (Dynatrace MCP Server), adaptive learning (Vertex AI), and a real-time WebSocket-based operational dashboard. Implementation follows the component architecture defined in the design, building from core data models and utilities up through each subsystem, then wiring everything together with the orchestrator and dashboard.

## Tasks

- [x] 1. Set up project structure, core types, and shared utilities
  - [x] 1.1 Initialize TypeScript project with configuration and dependencies
    - Create `package.json` with dependencies: `fast-check`, `ws`, `express`, `uuid`, `vitest`
    - Create `tsconfig.json` with strict mode enabled
    - Create directory structure: `src/`, `src/types/`, `src/agent/`, `src/tetragon/`, `src/koney/`, `src/dynatrace/`, `src/vertex/`, `src/dashboard/`, `src/utils/`, `tests/`
    - _Requirements: 1.1, 2.1, 3.1, 8.1_

  - [x] 1.2 Define core TypeScript interfaces and data models
    - Create `src/types/index.ts` with all interfaces from the design: `AccessEvent`, `HighRiskService`, `PodContext`, `ThreatAssessment`, `HoneytokenRegistryEntry`, `ForensicReport`, `AuditLogEntry`, `ResponseAction`, `PlacementModel`, `OutcomeData`, `EbeecontrolConfig`
    - Create `src/types/dashboard.ts` with dashboard-specific types: `DashboardHoneytokenEntry`, `DashboardAccessEvent`, `DashboardResponseAction`, `DashboardHealthStatus`, `DashboardComponentHealth`, `DashboardLearningMetrics`, `DashboardForensicReportSummary`, `DashboardIncidentEntry`, `WebSocketMessage`, `DashboardFullState`, `ConnectionStatus`, `PaginatedResult`, `ReportFilter`, `IncidentTimelineFilter`
    - _Requirements: 2.7, 3.2, 4.3, 5.4, 6.2, 6.3, 8.6, 9.1, 9.3, 9.5, 9.7, 9.9, 9.11, 9.13_

  - [x] 1.3 Implement configuration loader with defaults and validation
    - Create `src/config.ts` implementing `EbeecontrolConfig` with all default values from the design
    - Validate configurable intervals (discovery 5-1440 min, retraining 1-168 hours, health check interval)
    - _Requirements: 8.2, 8.3, 7.3_

  - [x] 1.4 Implement exponential backoff utility
    - Create `src/utils/retry.ts` with `computeBackoffDelay(attempt: number): number` returning 2^(n+1) seconds
    - Implement generic `retryWithBackoff` function accepting max retries, delay strategy, and async operation
    - Implement `retryWithFixedInterval` for fixed-interval retry patterns
    - _Requirements: 1.3, 1.6_

  - [x]* 1.5 Write property test for exponential backoff computation
    - **Property 1: Exponential Backoff Computation**
    - **Validates: Requirements 1.3**

  - [x] 1.6 Implement service ranking utility
    - Create `src/utils/ranking.ts` with `rankServices(services: HighRiskService[]): HighRiskService[]`
    - Sort descending by risk score, alphabetical by service name as tiebreaker
    - _Requirements: 1.4_

  - [x]* 1.7 Write property test for service ranking order
    - **Property 2: Service Ranking Order**
    - **Validates: Requirements 1.4**

- [x] 2. Implement threat classification engine
  - [x] 2.1 Implement threat classification function
    - Create `src/agent/threat-classifier.ts` with `classifyThreat(context: PodContext): ThreatClassification`
    - Implement classification rules: low (non-production AND anomaly < 0.3 AND criticality 1-2), medium (production OR anomaly 0.3-0.6 OR criticality 3), high (production AND (anomaly 0.6-0.8 OR criticality 4)), critical (production AND (anomaly > 0.8 OR criticality 5))
    - Implement missing field handling: substitute highest-risk defaults (production, 5, 1.0)
    - _Requirements: 4.3, 4.5, 4.6_

  - [x]* 2.2 Write property test for threat classification correctness
    - **Property 10: Threat Classification Correctness**
    - **Validates: Requirements 4.3, 4.6**

  - [x] 2.3 Implement response plan generator
    - Create `src/agent/response-planner.ts` with `generateResponsePlan(assessment: ThreatAssessment): ResponsePlan`
    - For high/critical: include pod isolation and IP block
    - For medium+: include deployment of at least 2 additional honeytokens in same namespace
    - _Requirements: 5.1, 5.2, 5.3_

  - [x]* 2.4 Write property test for response escalation on medium+ threats
    - **Property 11: Response Escalation on Medium+ Threats**
    - **Validates: Requirements 5.2**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Tetragon Monitor component
  - [x] 4.1 Implement access event generation and validation
    - Create `src/tetragon/monitor.ts` implementing `TetragonMonitor` interface
    - Implement `registerHoneytokenPath` and `unregisterHoneytokenPath` for path management
    - Implement access event generation with all required fields (processId, processBinaryPath, userId, podId, namespace, honeytokenPath, accessType, timestamp with ms precision)
    - _Requirements: 3.1, 3.2, 3.4_

  - [x]* 4.2 Write property test for access event field completeness
    - **Property 7: Access Event Field Completeness**
    - **Validates: Requirements 3.2**

  - [x] 4.3 Implement event buffer with bounded capacity
    - Create `src/tetragon/event-buffer.ts` with circular buffer (max 1000 events)
    - Implement FIFO eviction when buffer is full (discard oldest, store new)
    - Track overflow count for warning emission
    - _Requirements: 3.5, 3.6_

  - [x]* 4.4 Write property test for bounded buffer overflow
    - **Property 9: Bounded Buffer Overflow**
    - **Validates: Requirements 3.6**

  - [x] 4.5 Implement event forwarding with retry logic
    - Implement forwarding to Dynatrace MCP Server within 2 seconds
    - On failure: buffer locally, retry at 10-second intervals, max 5 attempts
    - Emit buffer overflow warning on next successful connection if overflow occurred
    - _Requirements: 3.3, 3.5_

  - [x]* 4.6 Write property test for event buffer retry behavior
    - **Property 8: Event Buffer Retry Behavior**
    - **Validates: Requirements 3.5**

- [x] 5. Implement Koney Deployer component
  - [x] 5.1 Implement honeytoken deployment logic
    - Create `src/koney/deployer.ts` implementing `KoneyDeployer` interface
    - Support deployment of 1-5 honeytokens per pod
    - Support types: decoy_secret, decoy_file, decoy_credential
    - Return deployment report with podId, namespace, type, and timestamp
    - _Requirements: 2.1, 2.2, 2.3_

  - [x]* 5.2 Write property test for deployment count invariant
    - **Property 3: Deployment Count Invariant**
    - **Validates: Requirements 2.1**

  - [x]* 5.3 Write property test for deployment report completeness
    - **Property 4: Deployment Report Completeness**
    - **Validates: Requirements 2.3**

  - [x] 5.4 Implement deployment error handling and cleanup
    - Return error with podId, failure reason, and remediation actions on failure
    - Implement partial deployment cleanup (remove artifacts before returning error)
    - Remediation actions: retry_deployment, select_alternative_pod, escalate_to_operator
    - _Requirements: 2.4, 2.5_

  - [x]* 5.5 Write property test for deployment error response completeness
    - **Property 5: Deployment Error Response Completeness**
    - **Validates: Requirements 2.4**

- [x] 6. Implement Dynatrace MCP Server client
  - [x] 6.1 Implement high-risk service discovery client
    - Create `src/dynatrace/client.ts` implementing `DynatraceMcpServer` interface
    - Implement `queryHighRiskServices()` with 30-second timeout
    - Handle empty service list (return empty array, no error)
    - Integrate exponential backoff retry (5 retries starting at 2s)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [x] 6.2 Implement pod context query client
    - Implement `getPodContext(podId, namespace)` with 3-second timeout
    - Return namespace classification, service criticality, and Davis AI anomaly score
    - On timeout: return null to trigger default-to-high classification
    - _Requirements: 4.1, 4.2, 4.5_

  - [x] 6.3 Implement access event subscription and forensic report submission
    - Implement `onAccessEvent(callback)` for receiving forwarded events from Tetragon
    - Implement `submitForensicReport(report)` with 30-second timeout and 5 retries
    - _Requirements: 3.3, 6.4, 6.6_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Honeytoken Registry
  - [x] 8.1 Implement honeytoken registry with CRUD operations
    - Create `src/agent/registry.ts` implementing honeytoken registry
    - Store entries with: honeytokenId, podId, namespace, type, filePath, deploymentTimestamp, status, lastAccessTimestamp, accessCount
    - Implement `addEntry`, `updateStatus`, `getByPod`, `getAll`, `getActive` methods
    - Update registry within 5 seconds of receiving deployment report
    - _Requirements: 2.6, 2.7_

  - [x]* 8.2 Write property test for registry consistency
    - **Property 6: Registry Consistency**
    - **Validates: Requirements 2.6, 2.7**

- [x] 9. Implement Forensic Report Generator
  - [x] 9.1 Implement forensic report generation with Gemini
    - Create `src/agent/report-generator.ts` implementing report generation
    - Generate report containing: access event details, contextual assessment, response actions, chronological timeline, and at least one recommended follow-up action
    - Implement 60-second timeout with 3 retries at 10-second intervals
    - Store reports with unique ID, generation timestamp, and triggering event association
    - Configure retention (default 90 days)
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [x]* 9.2 Write property test for forensic report content completeness
    - **Property 12: Forensic Report Content Completeness**
    - **Validates: Requirements 6.2**

  - [x]* 9.3 Write property test for report storage uniqueness
    - **Property 13: Report Storage Uniqueness**
    - **Validates: Requirements 6.3**

- [x] 10. Implement Vertex AI Trainer client
  - [x] 10.1 Implement outcome data ingestion
    - Create `src/vertex/trainer.ts` implementing `VertexAiTrainer` interface
    - Implement `ingestOutcomeData(data)` with validation for completeness
    - Confirm ingestion by recording dataset entry count
    - Submit within 60 seconds of response sequence completion
    - _Requirements: 7.1, 7.2_

  - [x]* 10.2 Write property test for outcome data validation and ingestion
    - **Property 14: Outcome Data Validation and Ingestion**
    - **Validates: Requirements 7.2**

  - [x] 10.3 Implement model retraining and publishing logic
    - Implement configurable retraining interval (1-168 hours, default 24)
    - Require minimum 50 outcome records since last retraining
    - Evaluate new model against validation set
    - Publish only if new accuracy ≥ current accuracy
    - On failure: retain existing model, log failure, retry at next interval
    - _Requirements: 7.3, 7.4, 7.6_

  - [x]* 10.4 Write property test for model publish guard
    - **Property 15: Model Publish Guard**
    - **Validates: Requirements 7.4**

- [x] 11. Implement Audit Log
  - [x] 11.1 Implement audit log with retention policy
    - Create `src/agent/audit-log.ts` implementing audit logging
    - Each entry: timestamp, decision type, decision rationale, input data summary, outcome
    - Decision types: discovery, deployment, assessment, response, learning, model_update
    - Retain entries for minimum 90 days
    - _Requirements: 8.6_

  - [x]* 11.2 Write property test for audit log entry completeness
    - **Property 18: Audit Log Entry Completeness**
    - **Validates: Requirements 5.4, 7.5, 8.6**

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement Ebeecontrol Agent orchestrator
  - [x] 13.1 Implement discovery cycle with scheduling
    - Create `src/agent/orchestrator.ts` implementing `EbeecontrolAgent` interface
    - Implement `initiateDiscoveryCycle()`: query Dynatrace, rank services, select targets
    - Implement configurable interval (5-1440 min, default 60)
    - Skip initiation if previous cycle not completed
    - Handle empty service list (log and skip without error)
    - _Requirements: 1.1, 1.4, 1.5, 8.1, 8.2_

  - [x]* 13.2 Write property test for discovery scheduling
    - **Property 16: Discovery Scheduling**
    - **Validates: Requirements 8.2**

  - [x] 13.3 Implement deployment orchestration
    - Wire agent to Koney Deployer for honeytoken placement
    - Update registry on successful deployment
    - Register new honeytoken paths with Tetragon Monitor
    - Handle deployment failures with remediation actions
    - _Requirements: 2.1, 2.3, 2.4, 2.6_

  - [x] 13.4 Implement threat assessment workflow
    - On access event: query Dynatrace for pod context within 2 seconds
    - Classify threat using threat classifier
    - Complete classification within 5 seconds of receiving event
    - On context timeout: default to high classification
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

  - [x] 13.5 Implement autonomous response execution
    - Execute response plan based on threat classification
    - Pod isolation via Kubernetes API (10s timeout, 3 retries, 5s interval)
    - IP blocking via network policy (10s timeout, 3 retries, 5s interval)
    - Additional honeytoken deployment for medium+ threats
    - Log all actions with type, target, timestamp, classification, and result
    - Handle isolation failure: alert + retry; exhaustion: critical alert
    - Handle IP block failure: alert + retry
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 13.6 Implement health monitoring and component recovery
    - Create `src/agent/health-monitor.ts` implementing health check logic
    - Check each component at configurable interval (default 30s)
    - Component unhealthy if: error on last check OR no response within 10s
    - On unhealthy: log, retry 3 times at 20s intervals, alert within 60s
    - After retry exhaustion: mark degraded, continue with healthy components, escalation alert
    - Expose health endpoint responding within 5 seconds
    - _Requirements: 8.3, 8.4, 8.5_

  - [x]* 13.7 Write property test for health status computation
    - **Property 17: Health Status Computation**
    - **Validates: Requirements 8.3**

  - [x] 13.8 Implement learning feedback loop
    - Submit outcome data to Vertex AI within 60 seconds of response completion
    - Include: access event, honeytoken type/location, actions taken, effectiveness metrics
    - Apply updated placement model when received
    - Log model updates with version, dataset size, and accuracy
    - _Requirements: 7.1, 7.5, 8.1_

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement Operations Dashboard backend (WebSocket server)
  - [x] 15.1 Implement WebSocket server and connection management
    - Create `src/dashboard/server.ts` with WebSocket server on configurable port (default 8080)
    - Implement connection lifecycle: connect, disconnect, auto-reconnect at 5s intervals
    - On reconnection: send `full_sync` message with complete current state within 10 seconds
    - Track connection status with last successful data timestamp
    - _Requirements: 9.15, 9.16_

  - [x] 15.2 Implement real-time event broadcasting
    - Broadcast honeytoken registry updates within 5 seconds of change
    - Broadcast access events within 3 seconds of generation
    - Broadcast response actions within 5 seconds of initiation, update outcome within 5 seconds of completion
    - Broadcast health status changes within 5 seconds
    - Broadcast new forensic reports within 10 seconds of generation
    - Broadcast learning metrics within 30 seconds of change
    - _Requirements: 9.2, 9.4, 9.6, 9.8, 9.10, 9.12_

  - [x] 15.3 Implement Access Event Feed with bounded capacity
    - Create `src/dashboard/access-event-feed.ts` implementing bounded feed (max 1000 events)
    - Store events in reverse chronological order
    - Evict oldest event when new event arrives at capacity
    - _Requirements: 9.3_

  - [x]* 15.4 Write property test for access event feed bounded capacity and ordering
    - **Property 19: Access Event Feed Bounded Capacity and Ordering**
    - **Validates: Requirements 9.3**

  - [x] 15.5 Implement REST endpoints for historical queries
    - Implement forensic report search with text filter across reportId, podId, namespace (case-insensitive)
    - Implement incident timeline query with filters: date range, threat classification, namespace, response outcome
    - Implement pagination (max 500 entries per page for timeline)
    - _Requirements: 9.9, 9.13, 9.14_

  - [x]* 15.6 Write property test for forensic report search correctness
    - **Property 20: Forensic Report Search Correctness**
    - **Validates: Requirements 9.9**

  - [x]* 15.7 Write property test for incident timeline filter and pagination
    - **Property 21: Incident Timeline Filter and Pagination**
    - **Validates: Requirements 9.14**

- [x] 16. Implement Operations Dashboard frontend view models
  - [x] 16.1 Implement dashboard view models and state management
    - Create `src/dashboard/view-models.ts` with view model transformations
    - Implement honeytoken registry view: podId, namespace, type, deploymentTimestamp, status (active/triggered/expired)
    - Implement response actions view: actionType, target, triggeringClassification, timestamp, outcome
    - Implement health status view with distinct statusIcon and statusLabel per status value
    - Implement empty state messages for each section (honeytoken registry, access event feed, response actions, forensic reports, incident timeline)
    - _Requirements: 9.1, 9.5, 9.7, 9.8, 9.17_

  - [x]* 16.2 Write property test for health status distinct indicators
    - **Property 22: Health Status Distinct Indicators**
    - **Validates: Requirements 9.8**

  - [x]* 16.3 Write property test for dashboard empty state messages
    - **Property 23: Dashboard Empty State Messages**
    - **Validates: Requirements 9.17**

  - [x]* 16.4 Write property test for response actions view completeness
    - **Property 24: Response Actions View Completeness**
    - **Validates: Requirements 9.5**

  - [x] 16.5 Implement adaptive learning metrics display
    - Display current model version, validation accuracy, training dataset size, training status (idle/training/failed)
    - _Requirements: 9.11_

  - [x] 16.6 Implement connectivity warning banner
    - Display warning banner on connection loss with last successful data timestamp
    - Retry connection at 5-second intervals
    - Remove banner and synchronize state within 10 seconds of reconnection
    - _Requirements: 9.15, 9.16_

- [x] 17. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Integration wiring and end-to-end flow
  - [x] 18.1 Wire all components into the agent orchestrator
    - Create `src/index.ts` as application entry point
    - Instantiate and wire: EbeecontrolAgent, TetragonMonitor, KoneyDeployer, DynatraceMcpServer client, VertexAiTrainer client, OperationsDashboard server
    - Connect event flow: Tetragon → Dynatrace → Agent → Response → Learning → Dashboard
    - Start discovery cycle scheduler, health monitor, and WebSocket server
    - _Requirements: 8.1, 8.2_

  - [x] 18.2 Implement full workflow cycle integration
    - Wire discovery → deployment → detection → assessment → response → reporting → learning
    - Ensure forensic report generation triggers after response completion
    - Ensure outcome data submission triggers after response completion
    - Ensure dashboard receives all real-time updates through the pipeline
    - _Requirements: 8.1, 6.1, 7.1, 9.2, 9.4, 9.6_

  - [x]* 18.3 Write integration tests for end-to-end workflow
    - Test discovery → deployment → detection → response cycle
    - Test dashboard WebSocket message delivery for each event type
    - Test health endpoint response format and timing
    - _Requirements: 8.1, 9.2, 9.4, 8.3_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design (24 properties total)
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout; all implementations use TypeScript with strict mode
- fast-check is used for all property-based tests
- WebSocket (ws library) is used for real-time dashboard communication
- All retry strategies follow the patterns defined in the design's Error Handling section

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "1.6"] },
    { "id": 3, "tasks": ["1.7", "2.1"] },
    { "id": 4, "tasks": ["2.2", "2.3", "4.1", "5.1", "6.1"] },
    { "id": 5, "tasks": ["2.4", "4.2", "4.3", "5.2", "5.3", "5.4", "6.2", "6.3"] },
    { "id": 6, "tasks": ["4.4", "4.5", "5.5", "8.1"] },
    { "id": 7, "tasks": ["4.6", "8.2", "9.1", "10.1", "11.1"] },
    { "id": 8, "tasks": ["9.2", "9.3", "10.2", "10.3", "11.2"] },
    { "id": 9, "tasks": ["10.4", "13.1"] },
    { "id": 10, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6"] },
    { "id": 11, "tasks": ["13.7", "13.8", "15.1", "15.3"] },
    { "id": 12, "tasks": ["15.2", "15.4", "15.5"] },
    { "id": 13, "tasks": ["15.6", "15.7", "16.1"] },
    { "id": 14, "tasks": ["16.2", "16.3", "16.4", "16.5", "16.6"] },
    { "id": 15, "tasks": ["18.1"] },
    { "id": 16, "tasks": ["18.2"] },
    { "id": 17, "tasks": ["18.3"] }
  ]
}
```
