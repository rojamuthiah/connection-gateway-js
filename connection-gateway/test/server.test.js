const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { performance } = require("node:perf_hooks");
const WebSocket = require("ws");
const { createServer } = require("../src/server");

let gateway;
let baseUrl;
let websocketUrl;

before(async () => {
    gateway = createServer({ port: 0, cpuWorkMs: 500 });
    await new Promise((resolve, reject) => {
        gateway.server.once("error", reject);
        gateway.server.listen(0, "127.0.0.1", resolve);
    });

    const { port } = gateway.server.address();
    baseUrl = `http://127.0.0.1:${port}`;
    websocketUrl = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
    for (const socket of gateway.websocketServer.clients) {
        socket.terminate();
    }

    await new Promise((resolve, reject) => {
        gateway.websocketServer.close(error => error ? reject(error) : resolve());
    });
    await new Promise((resolve, reject) => {
        gateway.server.close(error => error ? reject(error) : resolve());
    });
});

async function connect() {
    const socket = new WebSocket(websocketUrl);
    await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
    });
    return socket;
}

function receiveJson(socket) {
    return new Promise((resolve, reject) => {
        socket.once("message", data => {
            try {
                resolve(JSON.parse(data.toString()));
            } catch (error) {
                reject(error);
            }
        });
        socket.once("error", reject);
    });
}

function sendJson(socket, payload) {
    socket.send(JSON.stringify(payload));
}

function assertNoMessage(socket, durationMs = 50) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off("message", onMessage);
            resolve();
        }, durationMs);

        function onMessage(data) {
            clearTimeout(timer);
            reject(new Error(`Unexpected WebSocket message: ${data.toString()}`));
        }

        socket.once("message", onMessage);
    });
}

test("creates channels and rejects duplicate IDs", async () => {
    const response = await fetch(`${baseUrl}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: "stream-101" })
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
        status: "created",
        channelId: "stream-101"
    });

    const duplicateResponse = await fetch(`${baseUrl}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: "stream-101" })
    });
    assert.equal(duplicateResponse.status, 409);
});

test("broadcasts normal and bad publishes to other channel subscribers only", async () => {
    const publisher = await connect();
    const secondSubscriber = await connect();

    try {
        sendJson(publisher, {
            type: "subscribe",
            channelId: "stream-101"
        });
        const subscribed = await receiveJson(publisher);
        assert.equal(subscribed.type, "subscribed");
        assert.equal(subscribed.channelId, "stream-101");
        assert.match(subscribed.connectionId, /^conn-/);

        sendJson(secondSubscriber, {
            type: "subscribe",
            channelId: "stream-101"
        });
        const secondSubscribed = await receiveJson(secondSubscriber);
        assert.equal(secondSubscribed.type, "subscribed");
        assert.notEqual(secondSubscribed.connectionId, subscribed.connectionId);

        const secondMessage = receiveJson(secondSubscriber);
        const noPublisherEcho = assertNoMessage(publisher);
        sendJson(publisher, {
            type: "publish_normal",
            channelId: "stream-101",
            message: "Hello everyone!"
        });

        const expectedMessage = {
            type: "message",
            channelId: "stream-101",
            message: "Hello everyone!"
        };
        assert.deepEqual(await secondMessage, expectedMessage);
        await noPublisherEcho;

        const publishStartedAt = performance.now();
        const secondBadMessage = receiveJson(secondSubscriber);
        const noBadPublisherEcho = assertNoMessage(publisher);
        sendJson(publisher, {
            type: "publish_bad",
            channelId: "stream-101",
            message: "EXPENSIVE"
        });
        assert.deepEqual(await secondBadMessage, {
            type: "message",
            channelId: "stream-101",
            message: "EXPENSIVE"
        });
        assert.ok(performance.now() - publishStartedAt >= 450);
        await noBadPublisherEcho;
    } finally {
        publisher.close();
        secondSubscriber.close();
    }
});

test("rejects bad publishes when no other subscriber can be selected", async () => {
    const response = await fetch(`${baseUrl}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: "stream-102" })
    });
    assert.equal(response.status, 201);

    const publisher = await connect();
    try {
        sendJson(publisher, {
            type: "subscribe",
            channelId: "stream-102"
        });
        await receiveJson(publisher);

        sendJson(publisher, {
            type: "publish_bad",
            channelId: "stream-102",
            message: "EXPENSIVE"
        });

        assert.deepEqual(await receiveJson(publisher), {
            type: "error",
            error: "No other subscribers are available for bad-message work"
        });
    } finally {
        publisher.close();
    }
});

test("blocks other channels while publish_bad runs on the shared event loop", async () => {
    const response = await fetch(`${baseUrl}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: "stream-104" })
    });
    assert.equal(response.status, 201);

    const secondChannelResponse = await fetch(`${baseUrl}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: "stream-105" })
    });
    assert.equal(secondChannelResponse.status, 201);

    const publisher = await connect();
    const selectedSubscriber = await connect();
    const otherChannelPublisher = await connect();
    const otherChannelSubscriber = await connect();

    try {
        sendJson(publisher, { type: "subscribe", channelId: "stream-104" });
        const publisherSubscription = await receiveJson(publisher);
        sendJson(selectedSubscriber, { type: "subscribe", channelId: "stream-104" });
        const selectedSubscription = await receiveJson(selectedSubscriber);

        for (const socket of [otherChannelPublisher, otherChannelSubscriber]) {
            sendJson(socket, { type: "subscribe", channelId: "stream-105" });
            await receiveJson(socket);
        }

        const selectedMessage = receiveJson(selectedSubscriber);
        const otherChannelMessage = receiveJson(otherChannelSubscriber);
        const badPublishStartedAt = performance.now();

        sendJson(publisher, {
            type: "publish_bad",
            channelId: "stream-104",
            message: "EXPENSIVE"
        });
        sendJson(otherChannelPublisher, {
            type: "publish_normal",
            channelId: "stream-105",
            message: "Channel B continues after the shared loop is released"
        });
        assert.deepEqual(await otherChannelMessage, {
            type: "message",
            channelId: "stream-105",
            message: "Channel B continues after the shared loop is released"
        });
        assert.ok(performance.now() - badPublishStartedAt >= 450);

        assert.deepEqual(await selectedMessage, {
            type: "message",
            channelId: "stream-104",
            message: "EXPENSIVE"
        });

        assert.equal(
            gateway.channelManager.selectBadWorkRecipient(
                "stream-104",
                publisherSubscription.connectionId
            ),
            selectedSubscription.connectionId
        );
    } finally {
        publisher.close();
        selectedSubscriber.close();
        otherChannelPublisher.close();
        otherChannelSubscriber.close();
    }
});

test("rejects publishing before subscribing", async () => {
    const socket = await connect();

    try {
        sendJson(socket, {
            type: "publish_normal",
            channelId: "stream-101",
            message: "not subscribed"
        });

        assert.deepEqual(await receiveJson(socket), {
            type: "error",
            error: "Subscribe to the channel before publishing"
        });
    } finally {
        socket.close();
    }
});
