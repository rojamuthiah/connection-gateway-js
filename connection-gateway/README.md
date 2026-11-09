# Connection Gateway (JavaScript)

This is a standalone channel-based gateway app. It uses HTTP to create channels
and WebSocket connections to subscribe and publish.

## Run

From this directory, copy `.env.example` to `.env`, then run:

```sh
npm install
npm start
```

The Postman collection is `connection-gateway.postman_collection.json`. Import
it into Postman to create a channel and view the WebSocket connection and
message examples.

The server listens on port `8080` by default. Set `PORT` in `.env` to override
it. `CPU_WORK_MS` controls how long a `publish_bad` request runs synchronous
CPU work; it defaults to 250 milliseconds and is limited to 1–10,000.

## Protocol

Create a channel with `POST /channels` and a JSON body:

```json
{"channelId":"stream-101"}
```

The server responds with `201 Created` and
`{"status":"created","channelId":"stream-101"}`. Channel IDs must be unique.

Connect to `ws://localhost:8080/ws`. The server generates a connection ID when
each WebSocket connects; clients cannot choose or override it.

Subscribe to an existing channel:

```json
{"type":"subscribe","channelId":"stream-101"}
```

The server replies with `type: "subscribed"`, the channel ID, and the
server-generated connection ID. A connection must subscribe before it can
publish to that channel.

Publish a normal message:

```json
{"type":"publish_normal","channelId":"stream-101","message":"Hello everyone!"}
```

Publish a benchmark message:

```json
{"type":"publish_bad","channelId":"stream-101","message":"EXPENSIVE"}
```

Both publish types are broadcast to every other subscriber of the channel as
`{"type":"message","channelId":"...","message":"..."}`. The publishing
connection is excluded from the broadcast. For `publish_bad`, the server picks
the first open subscriber other than the publisher as the designated benchmark
recipient, then runs the configured CPU workload synchronously in the server's
message handler. Node.js connections do not have separate processes or event
loops, so this blocks the shared event loop and delays work for every channel
until the CPU workload finishes. The selected subscriber is a logical
benchmark target; it does not execute code independently. If no other
subscriber is available, the publisher receives an error and no workload or
broadcast is started.

Invalid JSON or protocol operations receive a JSON message with `type: "error"`
and an explanatory `error` field.
