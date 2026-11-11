require("dotenv").config();

const { createHash } = require("node:crypto");
const http = require("node:http");
const { performance } = require("node:perf_hooks");
const express = require("express");
const WebSocket = require("ws");
const ChannelManager = require("./channelManager");
const Logger = require("./logger");

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
    port = readIntegerSetting(
        process.env.CONNECTION_GATEWAY_PORT,
        DEFAULT_PORT,
        "CONNECTION_GATEWAY_PORT",
        0,
        65535
    ),
    cpuWorkMs = readIntegerSetting(
        process.env.CONNECTION_GATEWAY_BAD_WORK_MS,
        DEFAULT_CPU_WORK_MS,
        "CONNECTION_GATEWAY_BAD_WORK_MS",
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
    const logger = new Logger();

    server.once("close", () => {
        logger.close();
    });

    app.use((req, res, next) => {
        const startedAt = performance.now();

        res.once("finish", () => {
            logger.info("http_request", {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                durationMs: Math.round(performance.now() - startedAt)
            });
        });

        next();
    });

    app.use(express.json({ limit: "64kb" }));

    app.post("/channels", (req, res) => {
        const { channelId } = req.body ?? {};

        if (typeof channelId !== "string" || channelId.trim().length === 0) {
            return res.status(400).json({
                error: "channelId must be a non-empty string"
            });
        }

        if (!channelManager.createChannel(channelId)) {
            logger.warn("channel_creation_rejected", {
                channelId,
                reason: "already_exists"
            });
            return res.status(409).json({
                error: "channel already exists"
            });
        }

        logger.info("channel_created", { channelId });
        return res.status(201).json({
            status: "created",
            channelId
        });
    });

    websocketServer.on("connection", socket => {
        const connectionId = channelManager.addConnection(socket);
        logger.info("websocket_connected", { connectionId });

        socket.on("message", (data, isBinary) => {
            if (isBinary) {
                logger.warn("websocket_message_rejected", {
                    connectionId,
                    reason: "binary_message"
                });
                sendError(socket, "Only JSON text messages are supported");
                return;
            }

            let request;
            try {
                request = JSON.parse(data.toString());
            } catch {
                logger.warn("websocket_message_rejected", {
                    connectionId,
                    reason: "invalid_json"
                });
                sendError(socket, "Message must contain valid JSON");
                return;
            }

            if (!request || typeof request !== "object" || Array.isArray(request)) {
                logger.warn("websocket_message_rejected", {
                    connectionId,
                    reason: "message_not_object"
                });
                sendError(socket, "Message must be a JSON object");
                return;
            }

            const { type, channelId } = request;
            if (typeof channelId !== "string" || channelId.trim().length === 0) {
                logger.warn("websocket_message_rejected", {
                    connectionId,
                    reason: "invalid_channel_id"
                });
                sendError(socket, "channelId must be a non-empty string");
                return;
            }

            if (type === "subscribe") {
                if (!channelManager.subscribe(connectionId, channelId)) {
                    logger.warn("subscription_rejected", {
                        connectionId,
                        channelId,
                        reason: "channel_not_found"
                    });
                    sendError(socket, "Channel does not exist");
                    return;
                }

                logger.info("connection_subscribed", { connectionId, channelId });
                sendJson(socket, {
                    type: "subscribed",
                    channelId,
                    connectionId
                });
                return;
            }

            if (type !== "publish_normal" && type !== "publish_bad") {
                logger.warn("websocket_message_rejected", {
                    connectionId,
                    channelId,
                    reason: "unsupported_type"
                });
                sendError(socket, "type must be subscribe, publish_normal, or publish_bad");
                return;
            }

            if (!channelManager.isSubscribed(connectionId, channelId)) {
                logger.warn("publish_rejected", {
                    connectionId,
                    channelId,
                    type,
                    reason: "not_subscribed"
                });
                sendError(socket, "Subscribe to the channel before publishing");
                return;
            }

            if (typeof request.message !== "string" || request.message.length === 0) {
                logger.warn("publish_rejected", {
                    connectionId,
                    channelId,
                    type,
                    reason: "invalid_message"
                });
                sendError(socket, "message must be a non-empty string");
                return;
            }

            if (type === "publish_bad") {
                const selectedConnectionId = channelManager.selectBadWorkRecipient(
                    channelId,
                    connectionId
                );

                if (!selectedConnectionId) {
                    logger.warn("publish_rejected", {
                        connectionId,
                        channelId,
                        type,
                        reason: "no_other_subscribers"
                    });
                    sendError(socket, "No other subscribers are available for bad-message work");
                    return;
                }

                logger.info("bad_work_started", {
                    connectionId,
                    channelId,
                    selectedSubscriberId: selectedConnectionId,
                    durationMs: cpuWorkMs
                });
                // Select a recipient for the benchmark, but execute on Node's shared event loop.
                runCpuWork(cpuWorkMs);
                logger.info("bad_work_completed", {
                    connectionId,
                    channelId,
                    selectedSubscriberId: selectedConnectionId,
                    durationMs: cpuWorkMs
                });
            } else {
                logger.info("message_published", {
                    connectionId,
                    channelId,
                    type
                });
            }

            channelManager.broadcast(channelId, {
                type: "message",
                channelId,
                message: request.message
            }, connectionId);
        });

        socket.on("close", () => {
            channelManager.removeConnection(connectionId);
            logger.info("websocket_disconnected", { connectionId });
        });

        socket.on("error", error => {
            console.error(`WebSocket error for ${connectionId}:`, error);
            logger.error("websocket_error", {
                connectionId,
                message: error.message
            });
        });
    });

    return { app, server, websocketServer, channelManager, logger, port };
}

if (require.main === module) {
    const gateway = createServer();
    gateway.server.listen(gateway.port, () => {
        const listeningPort = gateway.server.address().port;
        console.log(`Connection Gateway listening on port ${listeningPort}`);
        gateway.logger.info("server_started", { port: listeningPort });
    });
}

module.exports = { createServer };
