const Relay = require("./relay");

class RelayTree {
    constructor() {
        this.root = null;
        this.relays = new Map();
        this.leaves = [];
        this.nextLeaf = 0;
    }

    createTree(depth) {
        if (!Number.isInteger(depth) || depth < 0) {
            throw new Error("Depth must be a non-negative integer");
        }

        // Stop old tree from retaining client references
        for (const relay of this.relays.values()) {
            for (const client of relay.clients) {
                if (client.readyState === 1) {
                    client.close(1000, "Tree recreated");
                }
            }
        }

        this.relays.clear();
        this.leaves = [];
        this.nextLeaf = 0;

        this.root = this.buildTree(0, 0, depth);

        return this.getTree();
    }

    buildTree(level, index, maxDepth) {
        const id = `relay-${level}-${index}`;

        const relay = new Relay(id, level);
        this.relays.set(id, relay);

        if (level === maxDepth) {
            this.leaves.push(relay);
            return relay;
        }

        const left = this.buildTree(
            level + 1,
            index * 2,
            maxDepth
        );

        const right = this.buildTree(
            level + 1,
            index * 2 + 1,
            maxDepth
        );

        relay.addChild(left);
        relay.addChild(right);

        return relay;
    }

    getTree() {
        if (!this.root) {
            return null;
        }

        return {
            depth: this.leaves[0].level,
            root: this.root.id,
            relayCount: this.relays.size,
            leafCount: this.leaves.length,
            topology: this.root.getInfo(),
            relays: this.getRelays()
        };
    }

    getRelays() {
        return Array.from(this.relays.values())
            .map(relay => relay.getInfo());
    }

    getLeaves() {
        return this.leaves.map(leaf => leaf.getInfo());
    }

    subscribe(client) {
        if (!this.root || this.leaves.length === 0) {
            throw new Error("Tree has not been created");
        }

        const leaf = this.leaves[
            this.nextLeaf % this.leaves.length
        ];

        this.nextLeaf++;

        leaf.addClient(client);

        return leaf;
    }

    broadcast(message) {
        if (!this.root) {
            throw new Error("Tree has not been created");
        }

        this.root.broadcast(message);
    }
}

module.exports = RelayTree;