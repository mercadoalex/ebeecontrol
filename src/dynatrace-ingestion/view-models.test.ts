/**
 * Unit tests for dashboard view models and state management.
 *
 * Validates: Requirements 9.1, 9.5, 9.7, 9.8, 9.17
 */

import { describe, it, expect } from 'vitest';
import {
  toHealthStatusViewModel,
  getEmptyStateMessage,
  toResponseActionViewModel,
  DashboardSection,
} from './view-models';
import {
  ComponentHealthMetricPayload,
  ResponseActionLogPayload,
} from '../types/dynatrace-ingestion';

describe('HealthStatusViewModel', () => {
  it('should map healthy status to correct icon and label', () => {
    const payload: ComponentHealthMetricPayload = {
      componentName: 'Tetragon_Monitor',
      status: 'healthy',
      lastSuccessfulCheckTimestamp: '2024-01-15T10:00:00.000Z',
    };

    const vm = toHealthStatusViewModel(payload);

    expect(vm.componentName).toBe('Tetragon_Monitor');
    expect(vm.status).toBe('healthy');
    expect(vm.statusIcon).toBe('✅');
    expect(vm.statusLabel).toBe('Healthy');
    expect(vm.lastSuccessfulCheckTimestamp).toBe('2024-01-15T10:00:00.000Z');
  });

  it('should map unhealthy status to correct icon and label', () => {
    const payload: ComponentHealthMetricPayload = {
      componentName: 'Koney_Deployer',
      status: 'unhealthy',
      lastSuccessfulCheckTimestamp: '2024-01-15T09:55:00.000Z',
    };

    const vm = toHealthStatusViewModel(payload);

    expect(vm.statusIcon).toBe('❌');
    expect(vm.statusLabel).toBe('Unhealthy');
  });

  it('should map degraded status to correct icon and label', () => {
    const payload: ComponentHealthMetricPayload = {
      componentName: 'Vertex_AI_Trainer',
      status: 'degraded',
      lastSuccessfulCheckTimestamp: '2024-01-15T09:50:00.000Z',
    };

    const vm = toHealthStatusViewModel(payload);

    expect(vm.statusIcon).toBe('⚠️');
    expect(vm.statusLabel).toBe('Degraded');
  });

  it('should produce distinct icons for each status', () => {
    const statuses: ComponentHealthMetricPayload['status'][] = ['healthy', 'unhealthy', 'degraded'];
    const icons = statuses.map(status =>
      toHealthStatusViewModel({
        componentName: 'Tetragon_Monitor',
        status,
        lastSuccessfulCheckTimestamp: '2024-01-15T10:00:00.000Z',
      }).statusIcon
    );

    const uniqueIcons = new Set(icons);
    expect(uniqueIcons.size).toBe(3);
  });

  it('should produce distinct labels for each status', () => {
    const statuses: ComponentHealthMetricPayload['status'][] = ['healthy', 'unhealthy', 'degraded'];
    const labels = statuses.map(status =>
      toHealthStatusViewModel({
        componentName: 'Tetragon_Monitor',
        status,
        lastSuccessfulCheckTimestamp: '2024-01-15T10:00:00.000Z',
      }).statusLabel
    );

    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(3);
  });
});

describe('Empty State Messages', () => {
  const sections: DashboardSection[] = [
    'honeytoken_registry',
    'access_event_feed',
    'response_actions',
    'forensic_reports',
    'incident_timeline',
  ];

  it('should return a non-empty message for each section', () => {
    for (const section of sections) {
      const message = getEmptyStateMessage(section);
      expect(message).toBeTruthy();
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it('should return distinct messages for each section', () => {
    const messages = sections.map(s => getEmptyStateMessage(s));
    const uniqueMessages = new Set(messages);
    expect(uniqueMessages.size).toBe(sections.length);
  });
});

describe('ResponseActionViewModel', () => {
  it('should transform a pod_isolation action correctly', () => {
    const payload: ResponseActionLogPayload = {
      actionId: 'action-001',
      actionType: 'pod_isolation',
      target: 'pod-abc123',
      triggeringClassification: 'critical',
      timestamp: '2024-01-15T10:05:00.000Z',
      outcome: 'success',
    };

    const vm = toResponseActionViewModel(payload);

    expect(vm.actionId).toBe('action-001');
    expect(vm.actionType).toBe('pod_isolation');
    expect(vm.actionTypeLabel).toBe('Pod Isolation');
    expect(vm.target).toBe('pod-abc123');
    expect(vm.triggeringClassification).toBe('critical');
    expect(vm.classificationLabel).toBe('Critical');
    expect(vm.timestamp).toBe('2024-01-15T10:05:00.000Z');
    expect(vm.outcome).toBe('success');
    expect(vm.outcomeLabel).toBe('Success');
  });

  it('should transform an ip_block action correctly', () => {
    const payload: ResponseActionLogPayload = {
      actionId: 'action-002',
      actionType: 'ip_block',
      target: '192.168.1.100',
      triggeringClassification: 'high',
      timestamp: '2024-01-15T10:06:00.000Z',
      outcome: 'failure',
    };

    const vm = toResponseActionViewModel(payload);

    expect(vm.actionTypeLabel).toBe('IP Block');
    expect(vm.classificationLabel).toBe('High');
    expect(vm.outcomeLabel).toBe('Failure');
  });

  it('should transform an additional_honeytokens action correctly', () => {
    const payload: ResponseActionLogPayload = {
      actionId: 'action-003',
      actionType: 'additional_honeytokens',
      target: 'ns-production',
      triggeringClassification: 'medium',
      timestamp: '2024-01-15T10:07:00.000Z',
      outcome: 'pending',
    };

    const vm = toResponseActionViewModel(payload);

    expect(vm.actionTypeLabel).toBe('Additional Honeytokens');
    expect(vm.classificationLabel).toBe('Medium');
    expect(vm.outcomeLabel).toBe('Pending');
  });

  it('should handle low classification', () => {
    const payload: ResponseActionLogPayload = {
      actionId: 'action-004',
      actionType: 'pod_isolation',
      target: 'pod-xyz',
      triggeringClassification: 'low',
      timestamp: '2024-01-15T10:08:00.000Z',
      outcome: 'success',
    };

    const vm = toResponseActionViewModel(payload);

    expect(vm.classificationLabel).toBe('Low');
  });
});
