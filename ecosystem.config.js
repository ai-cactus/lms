module.exports = {
    apps: [
        {
            name: "lms2-app",
            script: "npm",
            args: "run dev",
            env: {
                NODE_ENV: "development",
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
