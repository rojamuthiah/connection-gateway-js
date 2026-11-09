/**
 * A relay-tree node. Clients attached here receive messages broadcast to this
 * node and all of its descendants.
 */
class Relay {
    constructor(id, level) {
        this.id = id;
        this.level = level;

        this.parent = null;
        this.children = [];
        this.clients = new Set();
    }

    setParent(parent) {
        this.parent = parent;
    }

    addChild(child) {
        this.children.push(child);
        child.setParent(this);
    }

    addClient(client) {
        this.clients.add(client);
    }

    removeClient(client) {
        this.clients.delete(client);
    }

    broadcast(message) {
        // Forward only to open clients, then continue through the subtree.
        for (const client of this.clients) {
            if (client.readyState === 1) {
                client.send(message);
            }
        }

        for (const child of this.children) {
            child.broadcast(message);
        }
    }

    getInfo() {
        // Return identifiers rather than object references so the result is JSON-safe.
        return {
            id: this.id,
            level: this.level,
            parent: this.parent?.id ?? null,
            children: this.children.map(child => child.id),
            clientCount: this.clients.size
        };
    }
}

module.exports = Relay;