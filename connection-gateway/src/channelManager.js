const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");

class ChannelManager {
    constructor() {
        this.channels = new Map();
        this.connections = new Map();
        this.subscriptionsByConnection = new Map();
    }

    createChannel(channelId) {
        if (this.channels.has(channelId)) {
            return false;
        }

        this.channels.set(channelId, new Set());
        return true;
    }

    addConnection(socket) {
        const connectionId = `conn-${randomUUID()}`;

        this.connections.set(connectionId, socket);
        this.subscriptionsByConnection.set(connectionId, new Set());

        return connectionId;
    }

    removeConnection(connectionId) {
        const subscriptions = this.subscriptionsByConnection.get(connectionId);
        if (!subscriptions) {
            return;
        }

        for (const channelId of subscriptions) {
            this.channels.get(channelId)?.delete(connectionId);
        }

        this.subscriptionsByConnection.delete(connectionId);
        this.connections.delete(connectionId);
    }

    subscribe(connectionId, channelId) {
        const subscribers = this.channels.get(channelId);
        const subscriptions = this.subscriptionsByConnection.get(connectionId);

        if (!subscribers || !subscriptions) {
            return false;
        }

        subscribers.add(connectionId);
        subscriptions.add(channelId);
        return true;
    }

    isSubscribed(connectionId, channelId) {
        return this.subscriptionsByConnection
            .get(connectionId)
            ?.has(channelId) ?? false;
    }

    selectBadWorkRecipient(channelId, excludedConnectionId) {
        const subscribers = this.channels.get(channelId);
        if (!subscribers) {
            return null;
        }

        return Array.from(subscribers).find(connectionId =>
            connectionId !== excludedConnectionId
            && this.connections.get(connectionId)?.readyState === WebSocket.OPEN
        ) ?? null;
    }

    broadcast(channelId, payload, excludedConnectionId) {
        const subscribers = this.channels.get(channelId);
        if (!subscribers) {
            return;
        }

        const serializedPayload = JSON.stringify(payload);

        for (const connectionId of subscribers) {
            if (connectionId === excludedConnectionId) {
                continue;
            }

            const socket = this.connections.get(connectionId);
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                continue;
            }

            socket.send(serializedPayload, error => {
                if (error) {
                    console.error(`Failed to send to ${connectionId}:`, error);
                }
            });
        }
    }
}

module.exports = ChannelManager;
