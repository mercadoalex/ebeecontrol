#!/bin/bash
# eBeeControl — Install Tetragon on GKE
# Tetragon provides eBPF-based kernel-level monitoring for honeytoken access detection

set -e

echo "🐝 Installing Tetragon on the cluster..."

# Add Cilium Helm repo
helm repo add cilium https://helm.cilium.io
helm repo update

# Install Tetragon
helm install tetragon cilium/tetragon \
  --namespace kube-system \
  --set tetragon.grpc.enabled=true \
  --set tetragon.grpc.address="localhost:54321" \
  --set tetragon.exportFilename="/var/run/cilium/tetragon/tetragon.log"

echo "⏳ Waiting for Tetragon to be ready..."
kubectl rollout status daemonset/tetragon -n kube-system --timeout=120s

echo "✅ Tetragon installed successfully"
echo ""
echo "Apply the honeytoken tracing policy:"
echo "  kubectl apply -f k8s/tetragon/honeytoken-tracing-policy.yaml"
echo ""
echo "Verify events:"
echo "  kubectl logs -n kube-system -l app.kubernetes.io/name=tetragon -c export-stdout -f"
