# Platform Components (Home Lab)

This repository contains the Infrastructure as Code (IaC) Helm charts and manifests for core platform components in a Kubernetes home lab environment. The architecture focuses on GitOps (Argo CD), unified identity/secrets (Vault), and deep observability (Prometheus/Loki).

## 🧩 Components Overview

![Architecture Overview](./docs/overall%20architecture.png)

### Identity, Secrets & Base Infra
*   **[HashiCorp Vault](./vault):** The central secret manager and OIDC Identity Provider (IdP) for the lab. Runs in HA (Raft) mode using the `local-hdd` storage class, with TLS enabled.
*   **[Base System](./base):** Contains foundational cluster resources including `storageclass.yaml`, `cert.yaml`, `clusterissuer.yaml` for cert-manager, and `external-secrets.yaml` for integrating External Secrets Operator with Vault.

### Continuous Delivery
*   **[Argo CD](./argo-cd):** Declarative, GitOps continuous delivery tool. Configured for high availability (except Redis) and uses Vault as its OIDC provider for Single Sign-On (SSO).

### Observability (Monitoring & Logging)
*   **[Kube Prometheus Stack](./kube-prometheus-stack):** Provides comprehensive monitoring. Includes Prometheus (50Gi storage) and Grafana (20Gi storage). Grafana uses Vault for OAuth SSO.
*   **[Loki](./loki):** Log aggregation system running in `SingleBinary` mode on a 20Gi local volume.
*   **[Promtail](./promtail):** Agent that gathers logs from Kubernetes nodes/pods and ships them to the `loki-logging-gateway`.

### Autoscaling
*   **[KEDA](./keda):** Kubernetes Event-driven Autoscaling. Deploys the KEDA operator and metrics API server to allow scaling workloads based on external metrics.

### Networking & Remote Access
*   **[Cloudflare Tunnel](./cloudflare-tunnel-remote):** Deploys `cloudflared` to securely expose internal services or the Kubernetes API to the internet via Cloudflare without opening incoming firewall ports.
*   **`cloudflare-k8s-auth.sh`**: Helper script to generate an `ExecCredential` token using Cloudflare Access, standardizing secure `kubectl` access from outside the network.

## 🚀 Quick Start & Deployment

Most components should be deployed and managed via **Argo CD** once it's bootstrapped. 

### Bootstrapping Vault & Argo CD
1. **Vault:**
   ```bash
   helm install vault ./vault -f vault/override-values.yml -n vault
   ```
   *(Ensure the `vault-tls` secret exists before deploying).*

2. **Argo CD:**
   ```bash
   helm install argocd ./argo-cd -f argo-cd/values.extended.yaml -n argocd
   ```

### SSO Setup
To configure Vault as the OIDC provider for Argo CD and Grafana, refer to **`docs/OIDC-SSO-setup.md`** and the `vault-oidc.hcl` configuration.

## 📄 Documentation Reference
For technical specifics, storage requirements, and internal lab routing details, refer to the **[GEMINI.md](./GEMINI.md)** context file.
