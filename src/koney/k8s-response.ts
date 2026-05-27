/**
 * Real Kubernetes Response Actions
 *
 * Implements pod isolation (NetworkPolicy) and IP blocking
 * using the @kubernetes/client-node library.
 */

import * as k8s from '@kubernetes/client-node';

/**
 * Creates real Kubernetes response action functions.
 * Uses in-cluster config when running inside K8s, or kubeconfig locally.
 */
export function createK8sResponseActions() {
  const kc = new k8s.KubeConfig();

  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }

  const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

  return {
    /**
     * Isolates a pod by creating a deny-all NetworkPolicy targeting it.
     */
    async isolatePod(podId: string): Promise<void> {
      const namespace = 'default'; // TODO: resolve from registry
      const policyName = `ebeecontrol-isolate-${podId.substring(0, 20)}`;

      const policy: k8s.V1NetworkPolicy = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: {
          name: policyName,
          namespace,
          labels: {
            'app.kubernetes.io/managed-by': 'ebeecontrol',
            'ebeecontrol.io/action': 'pod-isolation',
            'ebeecontrol.io/target-pod': podId,
          },
        },
        spec: {
          podSelector: {
            matchLabels: {
              'statefulset.kubernetes.io/pod-name': podId,
            },
          },
          policyTypes: ['Ingress', 'Egress'],
          ingress: [], // deny all ingress
          egress: [],  // deny all egress
        },
      };

      try {
        await networkingApi.createNamespacedNetworkPolicy({ namespace, body: policy });
        console.log(`[K8s] Pod ${podId} isolated via NetworkPolicy ${policyName}`);
      } catch (error: any) {
        if (error?.body?.reason === 'AlreadyExists') {
          console.log(`[K8s] Pod ${podId} already isolated`);
          return;
        }
        throw error;
      }
    },

    /**
     * Blocks traffic from/to a pod by creating a restrictive NetworkPolicy.
     * In a real implementation, this would block the source IP at the ingress controller level.
     */
    async blockIp(podId: string): Promise<void> {
      const namespace = 'default';
      const policyName = `ebeecontrol-block-${podId.substring(0, 20)}`;

      const policy: k8s.V1NetworkPolicy = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: {
          name: policyName,
          namespace,
          labels: {
            'app.kubernetes.io/managed-by': 'ebeecontrol',
            'ebeecontrol.io/action': 'ip-block',
            'ebeecontrol.io/target-pod': podId,
          },
        },
        spec: {
          podSelector: {
            matchLabels: {
              'statefulset.kubernetes.io/pod-name': podId,
            },
          },
          policyTypes: ['Ingress'],
          ingress: [], // deny all ingress (blocks attacker IP)
        },
      };

      try {
        await networkingApi.createNamespacedNetworkPolicy({ namespace, body: policy });
        console.log(`[K8s] IP blocked for pod ${podId} via NetworkPolicy ${policyName}`);
      } catch (error: any) {
        if (error?.body?.reason === 'AlreadyExists') {
          console.log(`[K8s] IP already blocked for pod ${podId}`);
          return;
        }
        throw error;
      }
    },
  };
}
