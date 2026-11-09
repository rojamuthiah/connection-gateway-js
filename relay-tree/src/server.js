require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const RelayTree = require("./relayTree");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    path: "/ws"
});

const relayTree = new RelayTree();
const port = Number(process.env.PORT ?? 8080);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
}

app.use(express.json());
app.use(express.text({
    type: "text/plain",
    limit: "1mb"
}));

// Create tree
app.post("/tree/create", (req, res) => {
    try {
        const { depth } = req.body;

        if (!Number.isInteger(depth) || depth < 0 || depth > 10) {
            return res.status(400).json({
                error: "depth must be an integer between 0 and 10"
            });
        }

        const tree = relayTree.createTree(depth);

        return res.status(201).json({
            message: "Tree created successfully",
            ...tree
        });
    } catch (error) {
        return res.status(500).json({
            error: error.message
        });
    }
});

// View complete tree
app.get("/tree", (req, res) => {
    const tree = relayTree.getTree();

    if (!tree) {
        return res.status(404).json({
            error: "Tree not created"
        });
    }

    res.json(tree);
});

// View all relays
app.get("/tree/relays", (req, res) => {
    res.json(relayTree.getRelays());
});

// View leaves
app.get("/tree/leaves", (req, res) => {
    res.json(relayTree.getLeaves());
});

// Health
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        ...relayTree.getTree()
    });
});

// Publish
app.post("/publish", (req, res) => {
    const message = typeof req.body === "string"
        ? req.body
        : req.body?.message;

    if (typeof message !== "string" || message.length === 0) {
        return res.status(400).json({
            error: "message is required"
        });
    }

    try {
        relayTree.broadcast(message);

        res.status(202).json({
            status: "accepted"
        });
    } catch (error) {
        res.status(503).json({
            error: error.message
        });
    }
});

// WebSocket subscription
wss.on("connection", (ws) => {
    try {
        const leaf = relayTree.subscribe(ws);

        console.log(`Client subscribed to ${leaf.id}`);

        ws.on("close", () => {
            leaf.removeClient(ws);
            console.log(`Client disconnected from ${leaf.id}`);
        });

        ws.on("error", (error) => {
            console.error("WebSocket error:", error.message);
        });
    } catch (error) {
        ws.close(1013, "Relay tree unavailable");
    }
});

server.listen(port, () => {
    console.log(`Node.js relay server running on port ${port}`);
});