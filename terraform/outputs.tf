# eBeeControl - Terraform Outputs

output "cluster_name" {
  description = "GKE cluster name"
  value       = google_container_cluster.ebeecontrol.name
}

output "cluster_endpoint" {
  description = "GKE cluster endpoint"
  value       = google_container_cluster.ebeecontrol.endpoint
  sensitive   = true
}

output "cluster_location" {
  description = "GKE cluster location"
  value       = google_container_cluster.ebeecontrol.location
}

output "kubectl_command" {
  description = "Command to configure kubectl"
  value       = "gcloud container clusters get-credentials ${google_container_cluster.ebeecontrol.name} --zone ${var.zone} --project ${var.project_id}"
}

output "namespace" {
  description = "Kubernetes namespace where eBeeControl is deployed"
  value       = var.namespace
}

output "vpc_name" {
  description = "VPC network name"
  value       = google_compute_network.vpc.name
}
