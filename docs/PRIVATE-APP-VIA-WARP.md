# Setup Private connection between client machines and private intranet Apps

## Prerequisites

- Cloudflare tunnel installed (`nbiot-detector` tunnel)

## Assumption

- You use K3S as K8s-distro, which default service CIDR range is 10.43.0.0/16
- You installed cilium as CNI, install Experimental CRDs

  - `kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.1/experimental-install.yaml`

- Note: I installed the Standard Gateway API CRDs (standard-install.yaml), which only includes stable resources like Gateway and HTTPRoute. However, Cilium's controller requires the Experimental CRDs (which include TLSRoute, TCPRoute, etc.) to function correctly, even if you aren't using them.

## The Architecture
- Cloudflare Tunnel: Routes the private traffic to your cluster.
- Cloudflare DNS Policy: Points app.tuan-lnm.org to the Gateway's IP Address.
- K8s Gateway: Receives traffic on port 80 (or 443).
- HTTPRoute: Matches the host app.tuan-lnm.org and forwards it to app:8000.

## Step 1: Configure the Private App

### 1.1 Advertise the Private Network
1. Find out the internal IP of your vault service. (e.g., if running in Docker, it might be on a network like 172.18.0.5, or if on the host, 192.168.1.50).

2. In your Tunnel configuration, go to the `CIDR Routes` (successor to `private hostnames`) tab.

3. Add the CIDR (IP Range) that contains your app.
- In this case, we will add `10.43.0.0/16` (default services CIDR range of K3S)
- This tells Cloudflare: "If a WARP user asks for an IP in this range, send the traffic through this tunnel."

### 1.2 Configure WARP Client Split Tunneling
You need to make sure the WARP client knows to send traffic for that private IP through the tunnel.

1. Go to Team & Resources > Dev > Device Profiles.
2. Select your profile and go to Split Tunnels.
3. Ensure your private IP range (e.g., `10.43.0.0/16`) is Included in the tunnel. If you are using "Exclude" mode, you should remove `10.0.0.0/8` range

## Step 2: Configure the K8s Gateway API

### 2.1 Create the Gateway (The Listener)

First, you need a Gateway that listens for traffic. This effectively replaces the "LoadBalancer" or "Ingress Controller" entry point.

Note: Ensure your Gateway API CRDs are installed.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: internal-gateway
  namespace: kube-system
spec:
  gatewayClassName: cilium
  listeners:
  - name: http
    protocol: HTTP
    port: 80
    allowedRoutes:
      namespaces:
        from: All
```

### 2.2 Create the HTTPRoute (The Logic)

This is where you solve the Port 8000 problem. You tell the Gateway: "When you see `app.tuan-lnm.org`, send it to the Nbiot-detector-app service on port 8000

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: nbiot-detector-route
  namespace: nbiot-detector     # Same namespace as your nbiot-detector service
spec:
  parentRefs:
  - name: internal-gateway
    namespace: kube-system
  hostnames:
  - "app.tuan-lnm.org"
  rules:
  - backendRefs:
    - name: nbiot-detector      # Your Nbiot-detector Service Name
      port: 8000                # <--- The translation happens here!
```

### 2.3 Connect Cloudflare to the Gateway

Now you need to tell Cloudflare to send traffic to this Gateway.

Find the Gateway Service IP:

```sh
$ kubectl get svc -n kube-system cilium-gateway-internal-gateway
NAME                              TYPE           CLUSTER-IP    EXTERNAL-IP     PORT(S)                      AGE
cilium-gateway-internal-gateway   LoadBalancer   10.43.5.225   192.168.1.200   80:30832/TCP,443:30916/TCP   3d18h
```

Since you are on k3s/Cilium, the Gateway will likely be assigned a LoadBalancer IP or a ClusterIP (or both).

1. Go to Zero Trust Dashboard > Traffic Policies > Firewall Policies > DNS.

2. Create a new policy:
- Name: Resolve APP Private
- Rule: Domain is app.tuan-lnm.org
- Action: Override
- Override IP: 10.43.5.225

3. Save the policy.

### 2.4 Troubleshooting / Local Workaround

Update `/etc/hosts` so that Local DNS Resolver can resolve `app.tuan-lnm.org` to `10.43.5.225`

```bash
echo '10.43.5.225 app.tuan-lnm.org' >> /etc/hosts
```

## Step 3: Configure Let's Encrypt SSL certificate (Optional)

Because my app (app.tuan-lnm.org) is hidden behind a private network, Let's Encrypt cannot reach it to perform the standard verification (HTTP-01 challenge).

Instead, you must use the DNS-01 Challenge.

How DNS-01 Works for Private Apps:

- Cert-Manager (in your cluster): Asks Let's Encrypt for a certificate.
- Let's Encrypt: Says "Prove you own tuan-lnm.org by creating a specific TXT record in your DNS."
- Cert-Manager: Uses your Cloudflare API Token to automatically create that TXT record in your Cloudflare DNS.
- Let's Encrypt: Sees the record, verifies you own the domain, and issues the certificate.
- Result: You get a valid public certificate for a private internal IP.

To integrate HashiCorp to manage password, you will need to integrate cert-manager with Vault using the Kubernetes Auth Method.

Here is the architecture:

- Vault: Stores the Cloudflare API Token as a secret (e.g., secret/cloudflare-token).
- Cert-Manager: Authenticates to Vault using its Kubernetes Service Account.
- Vault: Verifies the Service Account and returns the API token.
- Cert-Manager: Uses the token to talk to Cloudflare DNS.

### 3.1 Install cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io 
helm install  cert-manager jetstack/cert-manager  --namespace cert-manager  --create-namespace  --version v1.19.2  --set crds.enabled=true
 ```

### 3.2 Enable Kubernetes Auth in Vault

You need to tell Vault to trust your Kubernetes cluster's Service Account tokens.

1. Log into your Vault (via CLI):

```bash
# Example if using CLI from your local machine (port-forwarded)
$ kubectl exec -it vault-0 -n vault -- sh  

/ $ export VAULT_ADDR='http://127.0.0.1:8200'
/ $ export VAULT_SKIP_VERIFY=true
/ $ vault login <your-root-token>
```

2. Enable the Auth Method

```bash
/ $ vault auth enable kubernetes
```

3. Configure the Kubernetes Config
- Vault needs to know how to talk to the K8s API to verify tokens.
- (Note: If Vault is running inside the same cluster, you can use the local service account token.)

```bash
vault write auth/kubernetes/config \
    kubernetes_host="https://$KUBERNETES_PORT_443_TCP_ADDR:443" \
    token_reviewer_jwt="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
    kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
    issuer="https://kubernetes.default.svc.cluster.local"
```

4. Enable the Engine
```bash
vault secrets enable -path=secret -version=2 kv
```

### 3.3 Create a Policy and Role

Vault needs a policy that allows reading the secret, and a role that binds that policy to cert-manager.
1. Create the Policy (cert-manager-policy.hcl)

```terraform
# Allow writing the secret data
path "secret/data/cloudflare-token" {
  capabilities = ["create", "update", "read"]
}

# Allow reading the metadata (required for some CLI checks)
path "secret/metadata/cloudflare-token" {
  capabilities = ["list", "read"]
}
```

2. Apply policy

```bash
/ $ vault policy write cert-manager-policy cert-manager-policy.hcl
```

3. Create role

```bash
/ $ vault write auth/kubernetes/role/cert-manager \
        bound_service_account_names=cert-manager \
        bound_service_account_namespaces=cert-manager \
        policies=cert-manager-policy \
        ttl=24h
```

### 3.4 Create a Secret for Cloudflare API Token

1. Create a Cloudflare API Token
- Go to Cloudflare Dashboard > My Profile > API Tokens.
- Create a token with this permission:
    - Zone > DNS > Edit
    - Zone Resources > Include > All zones (or just tuan-lnm.org)
    - Copy the token.

2. Create a Secret for the Token 

```bash
/ $ vault kv put secret/cloudflare-token token="<YOUR_CLOUDFLARE_API_TOKEN>"
```

### 3.5 Configure Cert-Manager Issuer

The standard cert-manager DNS-01 solver does not natively support fetching the API token directly from Vault for the Cloudflare provider. It expects a Kubernetes Secret.

However, you can use "External Secrets Operator" (ESO) or "Vault Agent Injector" to bridge this gap.

Since cert-manager requires a Kubernetes Secret for the dns01.cloudflare.apiTokenSecretRef field, you cannot bypass the K8s Secret entirely. But you can make it ephemeral and managed by Vault.

The Best Solution: External Secrets Operator (ESO)
- ESO: Watches a ExternalSecret resource.
- ESO: Authenticates to Vault, fetches secret/cloudflare-token.
- ESO: Creates/Updates a standard Kubernetes Secret (cloudflare-api-token-secret) automatically.
- Cert-Manager: Uses that auto-generated secret.

This resource tells cert-manager how to talk to Let's Encrypt and Cloudflare.

1. Install ESO

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace
```

2. Create a SecretStore (Connects ESO to Vault):
```yaml
apiVersion: external-secrets.io/v1
kind: ClusterSecretStore
metadata:
  name: vault-backend
spec:
  provider:
    vault:
      server: "https://vault.vault.svc:8200" # Internal URL
      path: "secret"
      version: "v2"
      caBundle: "<BASE64_CA_BUNDLE_ENCODED>"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "cert-manager" 
          serviceAccountRef:
              name: cert-manager
              namespace: cert-manager
```

3. Create the ExternalSecret

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: cloudflare-token-external
  namespace: cert-manager # Must be where cert-manager runs
spec:
  refreshInterval: "1h"
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: cloudflare-api-token-secret # <--- The K8s Secret name to create
    creationPolicy: Owner
  data:
  - secretKey: api-token # The key inside the K8s secret
    remoteRef:
      key: secret/cloudflare-token # The path in Vault
      property: token # The field in the Vault secret
```

4. Create cluster-issuer.yaml
```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    # The Let's Encrypt Production URL
    server: https://acme-v02.api.letsencrypt.org/directory
    email: lnmtuan1702@gmail.com  # <--- Change this
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
    - dns01:
        cloudflare:
          email: lnmtuan1702@gmail.com
          apiTokenSecretRef:
            name: cloudflare-api-token-secret # <--- Managed by ESO
            key: api-token
      selector:
        dnsZones:
        - "tuan-lnm.org"
```

5. Check if the `cloudflare-api-token-secret` exists

```bash
$ kubectl get secret cloudflare-api-token-secret -n cert-manager
NAME                          TYPE     DATA   AGE
cloudflare-api-token-secret   Opaque   1      43h
```

6. Request the Certificate (via Gateway)

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: private-tls
  namespace: kube-system # Must match Gateway namespace
spec:
  secretName: private-tls-secret # The secret name Gateway will look for
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - "*.tuan-lnm.org"
```

```bash
$ kubectl get certificate -n kube-system
NAME          READY   SECRET               AGE
private-tls   True    private-tls-secret   43h
```

7. Update Gateway to use the Real Cert
```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: internal-gateway
  namespace: kube-system
spec:
  gatewayClassName: cilium
  listeners:
  - name: http
    port: 80
    protocol: HTTP
    allowedRoutes:
      namespaces:
        from: All
  - name: https
    port: 443
    protocol: HTTPS
    tls:
      mode: Terminate
      certificateRefs:
      - name: private-tls-secret
    allowedRoutes:
      namespaces:
        from: All
```

8. Apply Application Route (HTTPS Only)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app-route-https
  namespace: nbiot-detector
spec:
  parentRefs:
  - name: internal-gateway
    namespace: kube-system
    sectionName: https 
  hostnames:
  - "app.tuan-lnm.org"
  rules:
  - backendRefs:
    - name: nbiot-detector
      port: 8000
```

9. Testing connection and validating Let's Encrypt Cert

- Turn on WARP (with Zero Trust Authentication)

```bash
$ curl -v https://app.tuan-lnm.org
* Host app.tuan-lnm.org:443 was resolved.
* IPv6: (none)
* IPv4: 10.43.5.225
*   Trying 10.43.5.225:443...
* Connected to app.tuan-lnm.org (10.43.5.225) port 443
* ALPN: curl offers h2,http/1.1
* (304) (OUT), TLS handshake, Client hello (1):
*  CAfile: /etc/ssl/cert.pem
*  CApath: none
* (304) (IN), TLS handshake, Server hello (2):
* (304) (IN), TLS handshake, Unknown (8):
* (304) (IN), TLS handshake, Certificate (11):
* (304) (IN), TLS handshake, CERT verify (15):
* (304) (IN), TLS handshake, Finished (20):
* (304) (OUT), TLS handshake, Finished (20):
* SSL connection using TLSv1.3 / AEAD-CHACHA20-POLY1305-SHA256 / [blank] / UNDEF
* ALPN: server did not agree on a protocol. Uses default.
* Server certificate:
*  subject: CN=*.tuan-lnm.org
*  start date: Feb 11 15:13:03 2026 GMT
*  expire date: May 12 15:13:02 2026 GMT
*  subjectAltName: host "app.tuan-lnm.org" matched cert's "*.tuan-lnm.org"
*  issuer: C=US; O=Let's Encrypt; CN=R13
*  SSL certificate verify ok.
* using HTTP/1.x
> GET / HTTP/1.1
> Host: app.tuan-lnm.org
> User-Agent: curl/8.7.1
> Accept: */*
> 
* Request completely sent off
< HTTP/1.1 200 OK
< date: Fri, 13 Feb 2026 11:25:16 GMT
< server: envoy
< content-length: 73
< content-type: application/json
< x-envoy-upstream-service-time: 2
< 
* Connection #0 to host app.tuan-lnm.org left intact
{"message":"N-BaIoT Botnet Detector API with LightGBM model is running."}
```

## Technical Decision

### Choosing between ESO and Vault Agent Injector

1. The Core Difference (In Plain English)

- ESO (The "Sync" Approach):
    - It treats Kubernetes Secrets as the destination. It fetches data from Vault and creates a standard Kubernetes Secret inside your namespace. Your application doesn't even know Vault exists; it just consumes the Secret like normal.

    - Best for: Integration with 3rd-party tools (Cert-Manager, Ingress, Helm charts) that expect a K8s Secret.

- Vault Agent Injector (The "Sidecar" Approach):
    - It treats the Pod as the destination. It injects a "sidecar" container into your Pod that authenticates with Vault, fetches the secret, and writes it to a file in shared memory (/vault/secrets/). The secret never becomes a Kubernetes Secret object.

    - Best for: Custom applications where you want maximum security (secrets never touch etcd).

| Feature | External Secrets Operator (ESO) | Vault Agent Injector |
| --- | --- | --- |
| Delivery Mechanism | Creates native Kubernetes Secret resources. | Mounts an in-memory file (tmpfs) to the Pod. |
| Tool Compatibility | High: Works natively with Helm, Ingress, Cert-Manager | Low: Requires apps to read from specific file paths. |
| Security Posture | Moderate: Secrets are stored in ETCD (requires at-rest encryption). | High: Secrets live only in RAM; never touch ETCD. |
| App Modification | None. Apps consume standard K8s secrets. | May require code changes or wrapper scripts to source files. |

2. Technical Debt
- Implement "Encryption at Rest" for ETCD

    Context: While network isolation protects against external threats, the Cloudflare API token remains unencrypted inside the ETCD database. Anyone with host-level access to the control plane nodes or unauthorized ETCD read access could extract the token.

    Action Item: Configure an ETCD Encryption Provider (such as a local KMS provider or integrating ETCD encryption directly with HashiCorp Vault) to ensure all native Kubernetes Secret objects are encrypted at rest on the disk. This will close the internal security gap and align the cluster with strict security best practices.


