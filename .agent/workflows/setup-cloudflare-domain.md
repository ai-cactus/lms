---
description: How to setup Cloudflare Tunnel with a paid account and domain
---

This workflow guides you through setting up a Cloudflare Tunnel to expose your local Next.js application to the internet using your custom domain. This assumes you have a server (like this one) where the app is running.

# Prerequisites

1.  **Cloudflare Account**: Ensure you have a Cloudflare account.
2.  **Domain Name**: Your domain must be added to your Cloudflare account (DNS pointing to Cloudflare).
3.  **Cloudflared Installed**: You already have the `cloudflared` package in your directory (`cloudflared-linux-amd64.deb`), but we will ensure it's installed and authenticated.

# Step 1: Install Cloudflared (if not already installed)

If `cloudflared` is not running or installed system-wide:

```bash
sudo dpkg -i cloudflared-linux-amd64.deb
```

# Step 2: Authenticate Cloudflared

This connects your server to your Cloudflare account.

1.  Run the login command:
    ```bash
    cloudflared tunnel login
    ```
2.  This will output a URL. Copy it into a browser where you are logged into Cloudflare.
3.  Select your new domain to authorize the tunnel.

# Step 3: Create a Named Tunnel

Instead of a random URL, we create a stable "named" tunnel.

1.  Create the tunnel (replace `lms-tunnel` with a name you like):
    ```bash
    cloudflared tunnel create lms-tunnel
    ```
2.  **SAVE THE OUTPUT**: It will give you a Tunnel ID (UUID) and a path to a credentials file (usually `~/.cloudflared/<UUID>.json`).

# Step 4: Configure DNS for your Domain

Now point your domain (e.g., `example.com`) to this tunnel.

1.  Run the following command (replace `<UUID>` with the ID from Step 3, and `example.com` with your domain):
    ```bash
    cloudflared tunnel route dns lms-tunnel example.com
    ```
    *If you want a subdomain like `app.example.com`, use that instead.*

# Step 5: Configure the Tunnel Locally

Create a configuration file to tell the tunnel where to send traffic.

1.  Create a file named `cloudflared_config.yml` in your project root:
    ```yaml
    tunnel: <UUID>
    credentials-file: /home/homepc/.cloudflared/<UUID>.json
    
    ingress:
      - hostname: example.com
        service: http://localhost:3000
      - service: http_status:404
    ```
    *Replace `<UUID>` and `example.com` with your real values.*
    *Note: We are pointing directly to port 3000 (Next.js) to skip Nginx complexity, but you can point to 80 if you prefer keeping Nginx.*

# Step 6: Update Ecosystem File

Update your `ecosystem.config.js` to run the named tunnel.

1.  Open `ecosystem.config.js`.
2.  Modify the "tunnel" app section:
    ```javascript
    {
        name: "tunnel",
        script: "/usr/bin/cloudflared",
        args: "tunnel run --config /home/homepc/lms2/cloudflared_config.yml", // Point to your new config
        interpreter: "none"
    }
    ```

# Step 7: Restart Services

1.  Build your Next.js app (if needed):
    ```bash
    npm run build
    ```
2.  Restart PM2:
    ```bash
    pm2 restart ecosystem.config.js
    ```

Your app should now be live at `https://example.com` with a valid SSL certificate managed by Cloudflare!
