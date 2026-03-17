
module.exports = {
    apps: [

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
            cwd: "/home/homepc/lms2-production",
            env: {
                NODE_ENV: "production",
                PORT: 3000
            }
        }
    ]
};
