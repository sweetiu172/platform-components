# Allow writing the secret data
path "secret/data/cloudflare-token" {
  capabilities = ["create", "update", "read"]
}

# Allow reading the metadata (required for some CLI checks)
path "secret/metadata/cloudflare-token" {
  capabilities = ["list", "read"]
}