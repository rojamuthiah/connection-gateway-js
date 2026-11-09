require("dotenv").config();

const { createHash } = require("node:crypto");
const http = require("node:http");
const { performance } = require("node:perf_hooks");
const express = require("express");
const WebSocket = require("ws");
const ChannelManager = require("./channelManager");

const DEFAULT_PORT = 8080;
const DEFAULT_CPU_WORK_MS = 250;
const MAX_CPU_WORK_MS = 10_000;

function readIntegerSetting(value, fallback, name, min, max) {
    const setting = value === undefined ? fallback : Number(value);

    if (!Number.isInteger(setting) || setting < min || setting > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }

    return setting;
}

function runCpuWork(durationMs) {
    const deadline = performance.now() + durationMs;
    let digest = Buffer.from("connection-gateway");

    // This synchronous loop intentionally blocks the shared Node.js event loop.
    while (performance.now() < deadline) {
        digest = createHash("sha256").update(digest).digest();
    }
}

function sendJson(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) {
        return;
    }

    socket.send(JSON.stringify(payload), error => {
        if (error) {
            console.error("Failed to send WebSocket response:", error);
        }
    });
}

function sendError(socket, message) {
    sendJson(socket, {
        type: "error",
        error: message
    });
}

function createServer({
    port = readIntegerSetting(process.env.PORT, DEFAULT_PORT, "PORT", 0, 65535),
    cpuWorkMs = readIntegerSetting(
        process.env.CPU_WORK_MS,
        DEFAULT_CPU_WORK_MS,
        "CPU_WORK_MS",
        1,
        MAX_CPU_WORK_MS
    )
} = {}) {
    const app = express();
    const server = http.createServer(app);
    const websocketServer = new WebSocket.Server({
        server,
        path: "/ws"
    });
    const channelManager = new ChannelManager();

    app.use(express.json({ limit: "64kb" }));

    app.post("/channels", (req, res) => {
        const { channelId } = req.body ?? {};

        if (typeof channelId !== "string" || channelId.trim().length === 0) {
            return res.status(400).json({
                error: "channelId must be a non-empty string"
            });
        }

        if (!channelManager.createChannel(channelId)) {
            return res.status(409).json({
                error: "channel already exists"
            });
        }

        return res.status(201).json({
            status: "created",
            channelId
        });
    });

    websocketServer.on("connection", socket => {
        const connectionId = channelManager.addConnection(socket);

        socket.on("message", (data, isBinary) => {
            if (isBinary) {
                sendError(socket, "Only JSON text messages are supported");
                return;
            }

            let request;
            try {
                request = JSON.parse(data.toString());
            } catch {
                sendError(socket, "Message must contain valid JSON");
                return;
            }

            if (!request || typeof request !== "object" || Array.isArray(request)) {
                sendError(socket, "Message must be a JSON object");
                return;
            }

            const { type, channelId } = request;
            if (typeof channelId !== "string" || channelId.trim().length === 0) {
                sendError(socket, "channelId must be a non-empty string");
                return;
            }

            if (type === "subscribe") {
                if (!channelManager.subscribe(connectionId, channelId)) {
                    sendError(socket, "Channel does not exist");
                    return;
                }

                sendJson(socket, {
                    type: "subscribed",
                    channelId,
                    connectionId
                });
                return;
            }

            if (type !== "publish_normal" && type !== "publish_bad") {
                sendError(socket, "type must be subscribe, publish_normal, or publish_bad");
                return;
            }

            if (!channelManager.isSubscribed(connectionId, channelId)) {
                sendError(socket, "Subscribe to the channel before publishing");
                return;
            }

            if (typeof request.message !== "string" || request.message.length === 0) {
                sendError(socket, "message must be a non-empty string");
                return;
            }

            if (type === "publish_bad") {
                const selectedConnectionId = channelManager.selectBadWorkRecipient(
                    channelId,
                    connectionId
                );

                if (!selectedConnectionId) {
                    sendError(socket, "No other subscribers are available for bad-message work");
                    return;
                }

                // Select a recipient for the benchmark, but execute on Node's shared event loop.
                runCpuWork(cpuWorkMs);
            }

            channelManager.broadcast(channelId, {
                type: "message",
                channelId,
                message: request.message
            }, connectionId);
        });

        socket.on("close", () => {
            channelManager.removeConnection(connectionId);
        });

        socket.on("error", error => {
            console.error(`WebSocket error for ${connectionId}:`, error);
        });
    });

    return { app, server, websocketServer, channelManager, port };
}

if (require.main === module) {
    const gateway = createServer();
    gateway.server.listen(gateway.port, () => {
        console.log(`Connection Gateway listening on port ${gateway.server.address().port}`);
    });
}

module.exports = { createServer };
