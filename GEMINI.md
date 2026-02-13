# Platform Components (Home Lab)

This repository contains the Infrastructure as Code (IaC) configuration for core platform components in a Kubernetes home lab environment. The primary components are **Argo CD** for GitOps-based continuous delivery and **HashiCorp Vault** for secret management and identity provision (OIDC).

## Components

### 1. HashiCorp Vault (`/vault`)
*   **Purpose:** Secret management and OIDC Identity Provider.
*   **Configuration:**
    *   **High Availability (HA):** Configured to run in HA mode using Raft storage, but currently scaled to 1 replica (typical for home lab resource saving).
    *   **Storage:** Uses persistent volume claims (PVC) with the `local-hdd` storage class (10Gi).
    *   **Security:** TLS is enabled. The configuration expects a Kubernetes secret named `vault-tls` containing `tls.crt` and `tls.key` to be present.
    *   **Image:** Uses `hashicorp/vault:1.21.2`.
*   **Key File:** `vault/override-values.yml` (Custom Helm values).

### 2. Argo CD (`/argo-cd`)
*   **Purpose:** Declarative, GitOps continuous delivery tool for Kubernetes.
*   **Configuration:**
    *   **High Availability:**
        *   **Redis:** `redis-ha` is explicitly **disabled** (uses standard Redis).
        *   **Controller/Server:** Autoscaling enabled with a minimum of 1 replica.
    *   **Authentication:** Configured to use Vault as an OIDC provider for Single Sign-On (SSO).
    *   **Server Mode:** Runs with `--insecure` flag (TLS likely terminated at Ingress or handled externally).
*   **Key File:** `argo-cd/values.extended.yaml` (Custom Helm values).

### 3. Kube Prometheus Stack (`/kube-prometheus-stack`)
*   **Purpose:** Comprehensive monitoring stack (Prometheus + Grafana).
*   **Configuration:**
    *   **Prometheus:**
        *   Requests: 200m CPU / 400Mi RAM.
        *   Storage: 50Gi `local-hdd`.
    *   **Grafana:**
        *   Storage: 20Gi `local-hdd` (StatefulSet).
        *   **Authentication:** Generic OAuth enabled, pointing to Vault (`https://vault.tuan-lnm.org`).
        *   **Role Mapping:** Maps Vault group `admin-group` to Grafana `Admin` role.
        *   **Datasources:** Pre-configured with Loki.
*   **Key File:** `kube-prometheus-stack/override-values.yaml`.

### 4. Loki (`/loki`)
*   **Purpose:** Log aggregation system.
*   **Configuration:**
    *   **Mode:** `SingleBinary` (Monolithic deployment).
    *   **Storage:** Filesystem storage on a 20Gi `local-hdd` PVC. No object storage (Minio disabled).
    *   **Tracing:** Enabled.
*   **Key File:** `loki/override-values.yaml`.

## Key Files & Documentation

*   **`OIDC-SSO-setup.md`**: A step-by-step guide on configuring Vault to act as an OIDC provider for Argo CD. It includes commands for enabling userpass auth, creating entities/groups, and configuring the Argo CD ConfigMaps (`argocd-cm`, `argocd-rbac-cm`).
*   **`vault-oidc.hcl`**:  HCL configuration file related to the Vault OIDC setup.
*   **`vault/override-values.yml`**: The Helm values file used to deploy Vault with the specific lab configuration (HA, Raft, TLS).
*   **`argo-cd/values.extended.yaml`**: The Helm values file used to deploy Argo CD with HA and autoscaling enabled.


## Deployment & Usage

### Deploying Vault
The Vault chart is located in the `vault/` directory. Deploy it using Helm with the custom overrides:

```bash
helm install vault ./vault -f vault/override-values.yml -n vault
```

*Note: Ensure the `vault-tls` secret exists in the target namespace before deploying.*

### Deploying Argo CD
The Argo CD chart is located in the `argo-cd/` directory. Deploy it using Helm with the extended values:

```bash
helm install argocd ./argo-cd -f argo-cd/values.extended.yaml -n argocd
```

### Deploying Monitoring Stack
```bash
helm install kube-prometheus-stack ./kube-prometheus-stack -f kube-prometheus-stack/override-values.yaml -n monitoring
```

### Deploying Logging Stack (Loki)
```bash
helm install loki ./loki -f loki/override-values.yaml -n logging
```

### Configuring OIDC SSO
Follow the instructions in `OIDC-SSO-setup.md` to:
1.  Configure Vault Authentication (Userpass).
2.  Create Vault Identity Entities and Groups.
3.  Register Argo CD as an OIDC Client in Vault.
4.  Update `argocd-cm` and `argocd-rbac-cm` in Kubernetes to point to the Vault OIDC provider.
