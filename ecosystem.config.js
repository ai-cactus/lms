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
            script: "/home/homepc/lms2/start-tunnel.sh",
            interpreter: "none"
        }
    ]
};
