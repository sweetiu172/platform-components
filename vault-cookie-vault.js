export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only run this logic on the OIDC Authorize endpoint
    if (url.pathname.includes("/v1/identity/oidc/provider/grafana-provider/authorize")) {
      
      const cookies = request.headers.get("Cookie") || "";
      
      // Look for the "token" cookie (the one we set in the browser)
      // Note: Adjust "token" if your browser uses "vault-token"
      const match = cookies.match(/token=([^;]+)/);

      if (match && match[1]) {
        // Create a new request with the header injected
        const newRequest = new Request(request);
        newRequest.headers.set("X-Vault-Token", match[1]);
        
        // Forward the modified request to Vault
        return fetch(newRequest);
      }
    }

    // Pass all other traffic through untouched
    return fetch(request);
  },
};