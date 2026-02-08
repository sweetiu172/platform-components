# Accessing Kubernetes cluster (k3s) via Cloudflare Tunnel
## Step 1: Setup Cloudflare Tunnel (Dashboard Side)
### Goal: Create the tunnel identity and define where traffic goes.

1. Go to Zero Trust Dashboard > Networks > Connectors.
2. Click Create a Tunnel > Select Cloudflared. 
3. Name it: nbiot-detector.
4. Save and COPY THE TOKEN (starts with eyJh...).
5. Click Next to configure the Public Hostname:
    - Subdomain: k8s
    - Domain: tuan-lnm.org
    - Service Type: HTTPS
    - URL: kubernetes.default.svc:443
6. Crucial Setting:
    - Expand Additional application settings > TLS.
    - Enable No TLS Verify. (This fixes the "Bad Gateway" or certificate errors).
7. Save the Tunnel.

## Step 2: Setup Cloudflare Access (Security Side)
### Goal: Protect k8s.tuan-lnm.org so only YOU can access it.

1. Go to Zero Trust Dashboard > Access > Applications.
2. Click Add an application > Self-hosted.
3. Configure the Application:
    - Application Name: home-lab-proxmox
    - Application Domain: k8s.tuan-lnm.org
    - Session Duration: 24 hours
    - Identity Providers: Select "One-time PIN" (for quick testing) or your Google/Microsoft account.
4. Configure the Policy (The Rule):
    - Policy Name: Allow All (or specific emails)
    - Action: Allow
    - Configure Selector: 
        - Field: Email
        - Operator: @
        - Value: [EMAIL_ADDRESS], [EMAIL_ADDRESS]
5. OIDC Config (Copy these):
    - Go to the Overview or Settings tab of the application.
    - Find the Client ID (Copy this) (aka **Application Audience (AUD)** Tag).
    - Find the Client Secret (You won't need this for the API server, but good to have).
    - Issuer URL: This is usually https://<your-team-name>.cloudflareaccess.com.
6. Save the Application. 

## Step 3: Deploy the Remote Tunnel
### Goal: Run the tunnel inside your cluster so it can talk to the API.

1. Connect to your cluster using your original method (e.g., SSH to master, or local access if available) for this one-time setup.

2. Install via Helm (using the token from Step 1):

```bash
# 1. Add the Helm repo
helm repo add cloudflare https://cloudflare.github.io/helm-charts
helm repo update

# 2. Install the tunnel (Paste your token here)
helm install k8s-tunnel cloudflare/cloudflare-tunnel \
  --namespace cloudflared \
  --create-namespace \
  --set cloudflare.tunnel_token="PASTE_YOUR_TOKEN_HERE" \
  --set cloudflare.replicaCount=2
```

3. Verify the Tunnel:

```bash
# Check the logs to ensure it connected
kubectl logs -n cloudflared -l pod=cloudflared
```

## Step 4: Configure the Kubernetes API Server
### Goal: Configure the Kubernetes API server to use Cloudflare Access for authentication via OIDC.

For K3s clusters
1. Edit the config file (usually `/etc/rancher/k3s/config.yaml`) or the systemd unit (on controlplane nodes).
2. Add the following arguments:
```yaml
# /etc/rancher/k3s/config.yaml
kube-apiserver-arg:
  - "oidc-issuer-url=https://<your-team>.cloudflareaccess.com"
  - "oidc-client-id=<YOUR_AUD_TAG>"
  - "oidc-username-claim=email"
  - "oidc-groups-claim=groups"
```
3. Restart the service: `systemctl restart k3s`
4. Verify the API server is using oidc flags:
```bash
journalctl -u k3s | grep oidc
```

## Step 5: Authorization (RBAC for your Email)
### Goal: Grant access to your email address.
1. Run this command on the cluster (you'll need to use your old admin access or the local admin.conf on the server one last time):

```bash
# Replace 'simonle@tuan-lnm.org' with the EXACT email you use to login to Cloudflare
kubectl create clusterrolebinding oidc-admin-binding \
  --clusterrole=cluster-admin \
  --user=simonle@tuan-lnm.org
```

## Step 6: Connect from your Local Machine
### Goal: Use the new secure tunnel.

1. Install the helper script: Create `cloudflare-k8s-auth.sh`

```bash
#!/bin/bash
# This fetches the JWT token using your active Cloudflare session
TOKEN=$(cloudflared access token -app=https://k8s.tuan-lnm.org)

echo '{
  "apiVersion": "client.authentication.k8s.io/v1beta1",
  "kind": "ExecCredential",
  "status": {
    "token": "'"$TOKEN"'"
  }
}'
```
Make it executable: `chmod +x cloudflare-k8s-auth.sh`

2. Update `~/.kube/config`: Point it to your tunnel and use the script

```yaml
apiVersion: v1
kind: Config
clusters:
- name: cloudflare-oidc-cluster
  cluster:
    # Now we point to the PUBLIC Cloudflare URL
    server: https://k8s.tuan-lnm.org
    # We likely still need this unless you have a valid public cert for the domain
    # or you configured the tunnel to present the public cert.
    insecure-skip-tls-verify: true

users:
- name: cloudflare-oidc-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: /path/to/cloudflare-k8s-auth.sh
      interactiveMode: Never

contexts:
- name: cloudflare-oidc
  context:
    cluster: cloudflare-oidc-cluster
    user: cloudflare-oidc-user

current-context: cloudflare-oidc
```

## Step 7: Test it

0. `cloudflared access login https://k8s.tuan-lnm.org`
1. Turn on Cloudflare WARP on your local machine
2. Login to Cloudflare Zero Trust
3. Run `kubectl get nodes`


## Reference
https://developers.cloudflare.com/cloudflare-one/tutorials/tunnel-kubectl/