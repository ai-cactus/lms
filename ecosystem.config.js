
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
            name: "lms-staging",
            script: "npm",
            args: "start",
            cwd: "/home/homepc/lms2",
            env: {
                NODE_ENV: "production",
                PORT: 3001
            }
        },
        {
            name: "lms-production",
            script: "npm",
            args: "start",
            cwd: "/home/homepc/lms2/production",
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
