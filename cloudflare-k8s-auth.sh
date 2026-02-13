#!/bin/bash
#!/bin/bash

# 1. Try to fetch the token
TOKEN=$(cloudflared access token -app=https://k8s.tuan-lnm.org 2>/dev/null)

# 2. CHECK: Did we actually get a token?
if [ -z "$TOKEN" ]; then
  # If the token is empty, it means your session expired.
  # We print a helpful error message to Stderr (so you see it in the terminal)
  echo "⚠️  Cloudflare Session Expired or Invalid ⚠️" >&2
  echo "--------------------------------------------------------" >&2
  echo "Please run this command to refresh your session:" >&2
  echo "" >&2
  echo "   cloudflared access login https://k8s.tuan-lnm.org" >&2
  echo "" >&2
  echo "--------------------------------------------------------" >&2
  exit 1
fi

# 3. If we have a token, output the format Kubernetes expects
echo '{
  "apiVersion": "client.authentication.k8s.io/v1beta1",
  "kind": "ExecCredential",
  "status": {
    "token": "'"$TOKEN"'"
  }
}'
# echo '{
#   "apiVersion": "client.authentication.k8s.io/v1beta1",
#   "kind": "ExecCredential",
#   "status": {
#     "token": "'"$(cloudflared access token -app=https://k8s.tuan-lnm.org)"'"
#   }
# }'
