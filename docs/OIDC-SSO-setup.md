

# Configure Vault authentication
vault auth enable userpass

vault write auth/userpass/users/simon \
    password="[PASSWORD]" \
    token_ttl="1h"


vault write identity/entity \
    name="simon" \
    disabled=false

ENTITY_ID=$(vault read -field=id identity/entity/name/simon)

vault write identity/group \
    name="engineering" \
    member_entity_ids="$ENTITY_ID"

GROUP_ID=$(vault read -field=id identity/group/name/engineering)

USERPASS_ACCESSOR=$(vault auth list -detailed -format json | jq -r '.["userpass/"].accessor')

vault write identity/entity-alias \
    name="simon" \
    canonical_id="$ENTITY_ID" \
    mount_accessor="$USERPASS_ACCESSOR"


# Create a Vault OIDC client

vault write identity/oidc/assignment/grafana \
    entity_ids="${ENTITY_ID}" \
    group_ids="${GROUP_ID}"


vault write identity/oidc/key/grafana-key \
    allowed_client_ids="*" \
    verification_ttl="2h" \
    rotation_period="1h" \
    algorithm="RS256"


vault write identity/oidc/client/argocd \
    redirect_uris="https://argocd.tuan-lnm.org/api/dex/callback" \
    assignments="argocd" \
    key="argocd-key" \
    id_token_ttl="30m" \
    access_token_ttl="1h"

vault write identity/oidc/client/grafana \
    key="grafana-key" \
    redirect_uris="https://grafana.tuan-lnm.org/login/generic_oauth" \
    assignments="grafana" \
    id_token_ttl="30m" \
    access_token_ttl="1h"

CLIENT_ID=$(vault read -field=client_id identity/oidc/client/argocd)

# Create a Vault OIDC provider

USER_SCOPE_TEMPLATE='{"username": {{identity.entity.name}}}'

vault write identity/oidc/scope/user \
    description="The user scope provides claims using Vault identity enti metadata" \
    template="$(echo ${USER_SCOPE_TEMPLATE} | base64)"

GROUPS_SCOPE_TEMPLATE='{"groups": {{identity.entity.groups.names}}}'

vault write identity/oidc/scope/groups \
    description="The groups scope" \
    template="$(echo ${GROUPS_SCOPE_TEMPLATE} | base64)"


 vault write identity/oidc/provider/argocd-provider \
    issuer="$(echo $VAULT_ADDR)" \
    allowed_client_ids="${CLIENT_ID}" \
    scopes_supported="groups,user"

<!-- vault write identity/oidc/provider/grafana-provider \
    issuer="$(echo $VAULT_ADDR)" \
    allowed_client_ids="${CLIENT_ID}" \
    scopes_supported="groups,user" -->

# Configure ArgoCD OIDC auth

ISSUER=$(curl --header "X-Vault-Token: $VAULT_TOKEN" --request GET \
    --header "X-Vault-Namespace: $VAULT_NAMESPACE" \
    $VAULT_ADDR/v1/identity/oidc/provider/argocd-provider/.well-known/openid-configuration | jq -r .issuer)

CLIENT_SECRET=$(vault read -field=client_secret identity/oidc/client/argocd)

# Configure ArgoCD OIDC auth
kubectl edit cm argocd-cm -n argocd

```txt
data:
  url: https://argocd.tuan-lnm.org
  dex.config: |
    connectors:
    - type: oidc
      id: vault
      name: Vault
      config:
        issuer: https://vault.tuan-lnm.org/v1/identity/oidc/provider/argocd-provider
        clientID: ''
        clientSecret: ''
        # Vault uses 'groups' claim for RBAC usually
        scopes: ["openid", "email", "groups"]
        getUserInfo: true
```

kubectl edit cm argocd-rbac-cm -n argocd
```txt
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-rbac-cm
  namespace: argocd
data:
  policy.csv: |
    g, engineering, role:admin
```
