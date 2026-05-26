# eBeeControl - Terraform Variables

variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "ebeecontrol"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone for the GKE cluster"
  type        = string
  default     = "us-central1-a"
}

variable "cluster_name" {
  description = "Name of the GKE cluster"
  type        = string
  default     = "ebeecontrol-cluster"
}

variable "node_count" {
  description = "Number of nodes in the node pool"
  type        = number
  default     = 2
}

variable "min_node_count" {
  description = "Minimum number of nodes for autoscaling"
  type        = number
  default     = 1
}

variable "max_node_count" {
  description = "Maximum number of nodes for autoscaling"
  type        = number
  default     = 4
}

variable "machine_type" {
  description = "Machine type for GKE nodes"
  type        = string
  default     = "e2-medium"
}

variable "namespace" {
  description = "Kubernetes namespace for eBeeControl"
  type        = string
  default     = "ebeecontrol"
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "1.0.0"
}

variable "dynatrace_metrics_endpoint" {
  description = "Dynatrace Metrics API v2 endpoint URL"
  type        = string
  default     = ""
}

variable "dynatrace_log_endpoint" {
  description = "Dynatrace Log Ingestion API endpoint URL"
  type        = string
  default     = ""
}

variable "dynatrace_api_token" {
  description = "Dynatrace API token (sensitive)"
  type        = string
  sensitive   = true
  default     = ""
}
