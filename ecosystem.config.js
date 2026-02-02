module.exports = {
    apps: [
        {
            name: "lms2-app",
            script: "npm",
            args: "start",
            env: {
                NODE_ENV: "production",
                PORT: 3000
            }
        },
        {
            name: "tunnel",
            script: "/usr/bin/cloudflared",
            args: "tunnel --url http://localhost:80",
            interpreter: "none"
        }
    ]
};
