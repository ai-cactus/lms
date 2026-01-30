module.exports = {
    apps: [{
        name: "lms2",
        script: "npm",
        args: "start",
        env: {
            NODE_ENV: "production",
            PORT: 3000
        }
    }]
}
