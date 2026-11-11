const fs = require("node:fs");
const path = require("node:path");

class Logger {
    constructor(logFilePath = path.join(__dirname, "..", "logs", "connection-gateway.log")) {
        fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
        this.logFilePath = logFilePath;
        this.stream = fs.createWriteStream(logFilePath, { flags: "a" });
        this.closePromise = null;

        this.stream.on("error", error => {
            console.error(`Unable to write gateway log file ${logFilePath}:`, error);
        });
    }

    info(event, details = {}) {
        this.write("info", event, details);
    }

    warn(event, details = {}) {
        this.write("warn", event, details);
    }

    error(event, details = {}) {
        this.write("error", event, details);
    }

    write(level, event, details) {
        const entry = JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            event,
            ...details
        });

        this.stream.write(`${entry}\n`);
    }

    close() {
        if (!this.closePromise) {
            this.closePromise = new Promise(resolve => {
                this.stream.end(resolve);
            });
        }

        return this.closePromise;
    }
}

module.exports = Logger;
