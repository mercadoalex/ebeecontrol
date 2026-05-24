/**
 * Dashboard view models and state management.
 *
 * Provides view model transformations for the Dynatrace-native dashboard,
 * including health status display, empty state messages, and response action
 * view model transformations.
 *
 * Validates: Requirements 9.1, 9.5, 9.7, 9.8, 9.17
 */

import {
  ComponentHealthMetricPayload,
  ResponseActionLogPayload,
} from '../types/dynatrace-ingestion';

// --- Health Status View Model ---

export interface HealthStatusViewModel {
  componentName: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  statusIcon: string;
  statusLabel: string;
  lastSuccessfulCheckTimestamp: string;
}

/**
 * Maps a component health status to a distinct icon.
 */
function getStatusIcon(status: 'healthy' | 'unhealthy' | 'degraded'): string {
  switch (status) {
    case 'healthy':
      return '✅';
    case 'unhealthy':
      return '❌';
    case 'degraded':
      return '⚠️';
  }
}

/**
 * Maps a component health status to a distinct human-readable label.
 */
function getStatusLabel(status: 'healthy' | 'unhealthy' | 'degraded'): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'unhealthy':
      return 'Unhealthy';
    case 'degraded':
      return 'Degraded';
  }
}

/**
 * Transforms a ComponentHealthMetricPayload into a HealthStatusViewModel
 * with distinct statusIcon and statusLabel per status value.
 */
export function toHealthStatusViewModel(
  payload: ComponentHealthMetricPayload
): HealthStatusViewModel {
  return {
    componentName: payload.componentName,
    status: payload.status,
    statusIcon: getStatusIcon(payload.status),
    statusLabel: getStatusLabel(payload.status),
    lastSuccessfulCheckTimestamp: payload.lastSuccessfulCheckTimestamp,
  };
}

// --- Empty State Messages ---

export type DashboardSection =
  | 'honeytoken_registry'
  | 'access_event_feed'
  | 'response_actions'
  | 'forensic_reports'
  | 'incident_timeline';

const EMPTY_STATE_MESSAGES: Record<DashboardSection, string> = {
  honeytoken_registry: 'No honeytokens deployed yet. The agent will deploy honeytokens during the next discovery cycle.',
  access_event_feed: 'No access events detected. The system is monitoring for honeytoken access.',
  response_actions: 'No response actions taken. Actions will appear here when threats are detected.',
  forensic_reports: 'No forensic reports generated. Reports are created after threat response sequences.',
  incident_timeline: 'No incidents recorded. The timeline will populate as threats are detected and responded to.',
};

/**
 * Returns the empty state message for a given dashboard section.
 */
export function getEmptyStateMessage(section: DashboardSection): string {
  return EMPTY_STATE_MESSAGES[section];
}

// --- Response Actions View Model ---

export interface ResponseActionViewModel {
  actionId: string;
  actionType: string;
  actionTypeLabel: string;
  target: string;
  triggeringClassification: string;
  classificationLabel: string;
  timestamp: string;
  outcome: string;
  outcomeLabel: string;
}

/**
 * Maps an action type to a human-readable label.
 */
function getActionTypeLabel(actionType: ResponseActionLogPayload['actionType']): string {
  switch (actionType) {
    case 'pod_isolation':
      return 'Pod Isolation';
    case 'ip_block':
      return 'IP Block';
    case 'additional_honeytokens':
      return 'Additional Honeytokens';
  }
}

/**
 * Maps a threat classification to a human-readable label.
 */
function getClassificationLabel(classification: ResponseActionLogPayload['triggeringClassification']): string {
  switch (classification) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'critical':
      return 'Critical';
  }
}

/**
 * Maps an outcome to a human-readable label.
 */
function getOutcomeLabel(outcome: ResponseActionLogPayload['outcome']): string {
  switch (outcome) {
    case 'success':
      return 'Success';
    case 'failure':
      return 'Failure';
    case 'pending':
      return 'Pending';
  }
}

/**
 * Transforms a ResponseActionLogPayload into a ResponseActionViewModel
 * with human-readable labels for display.
 */
export function toResponseActionViewModel(
  payload: ResponseActionLogPayload
): ResponseActionViewModel {
  return {
    actionId: payload.actionId,
    actionType: payload.actionType,
    actionTypeLabel: getActionTypeLabel(payload.actionType),
    target: payload.target,
    triggeringClassification: payload.triggeringClassification,
    classificationLabel: getClassificationLabel(payload.triggeringClassification),
    timestamp: payload.timestamp,
    outcome: payload.outcome,
    outcomeLabel: getOutcomeLabel(payload.outcome),
  };
}
