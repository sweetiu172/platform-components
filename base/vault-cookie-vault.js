export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only intercept the OIDC Authorize endpoint
    if (url.pathname.includes("/v1/identity/oidc/provider/grafana-provider/authorize")) {

      const cookies = request.headers.get("Cookie") || "";
      const match = cookies.match(/(?:token|vault-token)=([^;]+)/);
      let token = match ? match[1] : null;

      // --- PHASE 1: Attempt to use the token if we have one ---
      if (token) {
        const newRequest = new Request(request);
        newRequest.headers.set("X-Vault-Token", token);

        const response = await fetch(newRequest);

        // SUCCESS: Vault returns JSON code -> Redirect to Grafana
        if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
          const data = await response.json();
          if (data.code) {
            const redirectUriString = url.searchParams.get("redirect_uri");
            if (redirectUriString) {
              const targetUrl = new URL(redirectUriString);
              targetUrl.searchParams.set("code", data.code);
              const state = data.state || url.searchParams.get("state");
              if (state) targetUrl.searchParams.set("state", state);
              return Response.redirect(targetUrl.toString(), 302);
            }
          }
        }

        // FAILURE: Token is expired (403) -> Fall through to "Mini Dex" UI
        if (response.status === 403) {
          token = null; // Treat as if we have no token
        } else {
          // Some other error? Pass it through for debugging
          return response;
        }
      }

      // --- PHASE 2: The "Mini Dex" UI (Login Waiter) ---
      // If we are here, we either had no cookie OR the cookie was expired.

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Vault Login Required</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f4f5f7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 100%; }
            .btn { background: #000; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold; display: inline-block; margin-top: 20px; transition: background 0.2s; }
            .btn:hover { background: #333; }
            .status { margin-top: 15px; font-size: 14px; color: #666; min-height: 20px; }
            .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #ccc; border-top-color: #333; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; vertical-align: middle; }
            @keyframes spin { to { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            <h2>Authentication Required</h2>
            <p>Your session has expired or you are not logged in.</p>
            
            <a href="https://vault.tuan-lnm.org/ui/" target="_blank" class="btn" onclick="startPolling()">Log In to Vault</a>
            
            <div class="status" id="statusText"></div>
          </div>

          <script>
            // 1. Check if we already have a valid token (Self-Healing)
            function findVaultToken() {
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('vault-')) {
                  try {
                    const data = JSON.parse(localStorage.getItem(key));
                    // Ensure token exists and starts with 'hvs.' (Namespace tokens might differ, adjust if needed)
                    if (data && data.token) {
                      return data.token;
                    }
                  } catch (e) {}
                }
              }
              return null;
            }

            // 2. The Loop: Checks every 1 second for a login event
            function checkLogin() {
              const token = findVaultToken();
              if (token) {
                document.getElementById('statusText').innerHTML = '<div class="spinner"></div> Login detected! Redirecting...';
                
                // Set the cookie so the Worker can see it on reload
                document.cookie = "token=" + token + "; path=/; domain=.tuan-lnm.org; Secure; SameSite=None";
                
                // Reload the page. The Worker will catch the cookie and forward to Grafana.
                setTimeout(() => window.location.reload(), 1000);
                return true;
              }
              return false;
            }

            function startPolling() {
              document.getElementById('statusText').innerText = "Waiting for login in new tab...";
              setInterval(checkLogin, 1000);
            }

            // Check immediately on load (in case they just logged in and came back)
            if (!checkLogin()) {
              // Optional: Auto-start polling if we suspect they might be logging in
            }
          </script>
        </body>
        </html>
      `;

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return fetch(request);
  },
};