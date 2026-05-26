# eBeeControl — Deployment Guide

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`) installed
- [Terraform](https://developer.hashicorp.com/terraform/downloads) >= 1.5
- [Helm](https://helm.sh/docs/intro/install/) >= 3.0
- [kubectl](https://kubernetes.io/docs/tasks/tools/) installed
- GCP project with billing enabled

---

## 1. GCP Project Setup

```bash
# Set your project
gcloud config set project ebeecontrol

# Fix quota warning (if it appears)
gcloud auth application-default set-quota-project ebeecontrol

# Enable required APIs
gcloud services enable container.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable aiplatform.googleapis.com

# Authenticate Docker with GCR
gcloud auth configure-docker

# Install GKE auth plugin (required for kubectl)
gcloud components install gke-gcloud-auth-plugin
```

---

## 2. Build Docker Image

**Important:** Build for `linux/amd64` since GKE runs on AMD64 nodes (not ARM).

```bash
cd /Users/alexmarket/Desktop/eBeeControl

# Build for amd64 (required when building on Apple Silicon Mac)
docker buildx build --platform=linux/amd64 --output type=docker -t gcr.io/ebeecontrol/ebeecontrol:1.0.1 .

# Verify architecture is amd64
docker inspect --format='{{.Architecture}}' gcr.io/ebeecontrol/ebeecontrol:1.0.1
# Should output: amd64

# Push to Google Container Registry
docker push gcr.io/ebeecontrol/ebeecontrol:1.0.1

# Verify it's in GCR
gcloud container images list-tags gcr.io/ebeecontrol/ebeecontrol
```

### Common Issue: `exec format error`

If pods show `exec format error` in logs, the image was built for ARM (Apple Silicon). Always use `--platform=linux/amd64` when building on Mac.

---

## 3. Deploy Infrastructure with Terraform

```bash
cd terraform

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Initialize Terraform
terraform init

# Preview changes
terraform plan

# Deploy everything (GKE cluster + VPC + eBeeControl)
terraform apply
```

This creates:
- VPC network with subnets
- GKE cluster with autoscaling node pool (1-4 nodes, e2-medium)
- Network policies enabled
- Workload Identity configured
- eBeeControl deployed via Helm chart
- RBAC (ClusterRole + ClusterRoleBinding)
- Service account
- ConfigMap with agent configuration
- Secret placeholder for Dynatrace API token

---

## 4. Connect to the Cluster

```bash
gcloud container clusters get-credentials ebeecontrol-cluster --zone us-central1-a
```

---

## 5. Verify Deployment

```bash
# Check pod status
kubectl get pods -n ebeecontrol

# Check logs (should show startup message)
kubectl logs -n ebeecontrol -l app.kubernetes.io/name=ebeecontrol --tail=20

# Expected output:
# 🐝 eBeeControl starting...
# 🐝 eBeeControl agent is running
#    Discovery cycle: every 60 minutes
#    Health check: every 30 seconds
#    Press Ctrl+C to stop
```

---

## 6. Configure Dynatrace (Optional)

```bash
# Set the Dynatrace API token secret
kubectl create secret generic ebeecontrol-dynatrace \
  --from-literal=api-token=dt0c01.YOUR_TOKEN_HERE \
  -n ebeecontrol

# Restart to pick up the secret
kubectl rollout restart deployment/ebeecontrol -n ebeecontrol
```

### Getting Dynatrace Credentials

1. Sign up at [dynatrace.com/trial](https://www.dynatrace.com/trial/)
2. Your environment URL: `https://abc12345.live.dynatrace.com`
3. Endpoints:
   - Metrics: `https://abc12345.live.dynatrace.com/api/v2/metrics/ingest`
   - Logs: `https://abc12345.live.dynatrace.com/api/v2/logs/ingest`
4. Create API token: Settings → Access tokens → Generate
   - Scopes: `metrics.ingest`, `logs.ingest`

---

## 7. Update Deployment

```bash
# Build new version
docker buildx build --platform=linux/amd64 --output type=docker -t gcr.io/ebeecontrol/ebeecontrol:1.0.2 .
docker push gcr.io/ebeecontrol/ebeecontrol:1.0.2

# Update the deployment
kubectl set image deployment/ebeecontrol ebeecontrol=gcr.io/ebeecontrol/ebeecontrol:1.0.2 -n ebeecontrol

# Or update via Terraform
# Edit terraform.tfvars: image_tag = "1.0.2"
# terraform apply
```

---

## 8. Monitoring

```bash
# Live logs
kubectl logs -f -n ebeecontrol -l app.kubernetes.io/name=ebeecontrol

# Pod status
kubectl get pods -n ebeecontrol -w

# Describe pod (for debugging)
kubectl describe pod -n ebeecontrol -l app.kubernetes.io/name=ebeecontrol

# Health check
kubectl exec -n ebeecontrol deployment/ebeecontrol -- node -e "console.log('healthy')"
```

---

## 9. Destroy Everything

```bash
cd terraform
terraform destroy
```

This removes:
- GKE cluster and all workloads
- Node pool
- VPC network and subnets
- Firewall rules
- All Kubernetes resources (pods, services, secrets, configmaps)

**Note:** The Docker images in GCR are NOT deleted by Terraform. To clean those up:

```bash
gcloud container images delete gcr.io/ebeecontrol/ebeecontrol:1.0.1 --quiet
gcloud container images delete gcr.io/ebeecontrol/ebeecontrol:1.0.0 --quiet
```

---

## Project Structure

```
eBeeControl/
├── src/                    # TypeScript source code
├── tests/                  # Property-based and integration tests
├── dist/                   # Compiled JavaScript (generated by npm run build)
├── helm/ebeecontrol/       # Helm chart for Kubernetes deployment
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
├── terraform/              # Infrastructure as Code
│   ├── main.tf             # GKE cluster, VPC, Helm release
│   ├── variables.tf        # Configurable inputs
│   ├── outputs.tf          # Cluster endpoint, kubectl command
│   └── terraform.tfvars    # Your environment values (gitignored)
├── Dockerfile              # Multi-stage build (Node 20 Alpine)
├── .dockerignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `exec format error` | Image built for wrong architecture. Rebuild with `--platform=linux/amd64` |
| `ErrImagePull` | Image not pushed to GCR. Run `docker push` |
| `CrashLoopBackOff` | Check logs: `kubectl logs -n ebeecontrol <pod-name>` |
| `gke-gcloud-auth-plugin not found` | Run `gcloud components install gke-gcloud-auth-plugin` |
| `quota project mismatch` | Run `gcloud auth application-default set-quota-project ebeecontrol` |
| Pod starts but exits immediately | Entry point doesn't start a long-running process. Ensure `startAgent()` is called |
| Terraform helm timeout | Image pull failed or pod crashing. Fix the pod first, then `terraform apply` again |

---

## Cost Estimate

With default settings (2x e2-medium nodes, us-central1):
- ~$50-70/month for the GKE cluster
- Minimal GCR storage costs
- **Always run `terraform destroy` when not actively using it**

---

Made with ❤️ by Alex
