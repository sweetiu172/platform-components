export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only run logic on the OIDC Authorize endpoint
    if (url.pathname.includes("/v1/identity/oidc/provider/grafana-provider/authorize")) {

      const cookies = request.headers.get("Cookie") || "";
      // Regex to find token or vault-token
      const match = cookies.match(/(?:token|vault-token)=([^;]+)/);

      // --- SCENARIO A: Cookie exists (Try to use it) ---
      if (match && match[1]) {
        const newRequest = new Request(request);
        newRequest.headers.set("X-Vault-Token", match[1]);

        const response = await fetch(newRequest);

        // CASE 1: Success! (Vault returns JSON code)
        // Convert the JSON response into a Browser Redirect
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

        // CASE 2: Expired Token! (Vault returns 403)
        // Redirect user to Vault UI to login again
        if (response.status === 403) {
          // Construct a response that clears the bad cookie and redirects
          const vaultLoginUrl = "https://vault.tuan-lnm.org/ui/";

          let failResponse = Response.redirect(vaultLoginUrl, 302);

          // Optional: Clear the bad cookie so the "Self-Healing" script runs again next time
          const newHeaders = new Headers(failResponse.headers);
          newHeaders.append("Set-Cookie", "token=; Path=/; Domain=.tuan-lnm.org; Max-Age=0; Secure; SameSite=None");

          return new Response(failResponse.body, {
            status: 302,
            headers: newHeaders
          });
        }

        return response;
      }

      // --- SCENARIO B: Cookie is MISSING (Cleared cookies / Fresh session) ---
      // Serve the "Self-Healing" HTML page to grab token from LocalStorage
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authenticating...</title>
          <meta http-equiv="refresh" content="5;url=https://vault.tuan-lnm.org/ui/" />
        </head>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
          <h3>Connecting to Vault Identity...</h3>
          <p>Please wait while we check your session.</p>
          <script>
            function findVaultToken() {
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('vault-')) {
                  try {
                    const rawValue = localStorage.getItem(key);
                    const data = JSON.parse(rawValue);
                    // Check for token and ensure it's not expired (basic check)
                    if (data && data.token && data.token.startsWith('hvs.')) {
                      return data.token;
                    }
                  } catch (e) {}
                }
              }
              return null;
            }

            const token = findVaultToken();
            
            if (token) {
              // Found a token! Set cookie and reload to try authenticating
              document.cookie = "token=" + token + "; path=/; domain=.tuan-lnm.org; Secure; SameSite=None";
              window.location.reload();
            } else {
              // No token found (User is logged out). Go to Vault Login.
              window.location.href = "https://vault.tuan-lnm.org/ui/";
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