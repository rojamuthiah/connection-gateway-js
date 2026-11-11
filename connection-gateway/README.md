# Connection Gateway (JavaScript)

A standalone HTTP and WebSocket app for the channel-based connection gateway
benchmark. It is separate from the `relay-tree` app in this repository.

## Requirements

- Git
- Node.js 20 or newer
- npm (included with Node.js)

## Clone and install

Clone the repository and enter the app directory:

```powershell
git clone https://github.com/rojamuthiah/connection-gateway-js.git
cd connection-gateway-js\connection-gateway
```

Install the exact dependency versions from the lockfile and create your local
environment file:

```powershell
npm ci
Copy-Item .env.example .env
```

`npm ci` is the reproducible install command. Use `npm install` if you
intentionally need to update dependencies.

## Configure

Edit `.env` as needed:

```dotenv
CONNECTION_GATEWAY_PORT=8080
CONNECTION_GATEWAY_BAD_WORK_MS=250
```

- `CONNECTION_GATEWAY_PORT` sets the HTTP and WebSocket listening port
  (default `8080`).
- `CONNECTION_GATEWAY_BAD_WORK_MS` sets the synchronous CPU workload duration
  for `publish_bad` (default `250`; allowed range `1`–`10000` milliseconds).

The local `.env` file and generated logs are git-ignored.

## Run

Start with automatic restart when source files change:

```powershell
npm run dev
```

Or start without watch mode:

```powershell
npm start
```

The server prints its listening port when it starts. Keep this terminal open
while making requests. Stop the server with `Ctrl+C`.

The default endpoints are:

- HTTP: `http://localhost:8080`
- WebSocket: `ws://localhost:8080/ws`

If port 8080 is already in use, set another `CONNECTION_GATEWAY_PORT` value in
`.env` and use that port in your client.

## Test

From `connection-gateway/`, run the automated integration tests:

```powershell
npm test
```

The tests start a temporary server on an available port and verify channel
creation, subscriptions, publisher-excluding broadcasts, `publish_bad` event
loop blocking, and error cases. They do not require the development server to
be running.

## Try the API manually

### 1. Create a channel over HTTP

Create a channel before subscribing. Using PowerShell:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8080/channels `
  -ContentType 'application/json' `
  -Body '{"channelId":"stream-101"}'
```

Successful response (`201 Created`):

```json
{
  "status": "created",
  "channelId": "stream-101"
}
```

Channel IDs must be unique while the server is running; creating the same ID
again returns `409 Conflict`. Channels are held in memory and are removed when
the server restarts.

The Postman collection
[`connection-gateway.postman_collection.json`](./connection-gateway.postman_collection.json)
contains this HTTP **Create channel** request only. Import it into Postman and
send the request before testing WebSockets.

### 2. Connect and subscribe over WebSocket

Open two WebSocket clients to `ws://localhost:8080/ws` (for example, two
Postman WebSocket request tabs). In **both** clients, send this text frame:

```json
{"type":"subscribe","channelId":"stream-101"}
```

Each connection receives a response with its own server-generated connection
ID:

```json
{
  "type": "subscribed",
  "channelId": "stream-101",
  "connectionId": "conn-..."
}
```

Clients cannot choose their connection IDs. A connection must subscribe to a
channel before publishing to it.

### 3. Publish

From one subscribed client, send a normal message:

```json
{"type":"publish_normal","channelId":"stream-101","message":"Hello everyone!"}
```

Or send a benchmark message:

```json
{"type":"publish_bad","channelId":"stream-101","message":"EXPENSIVE"}
```

Other subscribers receive:

```json
{"type":"message","channelId":"stream-101","message":"Hello everyone!"}
```

The publisher does not receive its own broadcast. For `publish_bad`, the server
selects the first open subscriber other than the publisher as the logical
benchmark recipient. The selected subscriber does not run code independently:
the configured CPU workload runs synchronously on Node.js's shared event loop.
It therefore delays processing on every channel until the workload completes.
At least one other subscriber must be present for a bad publish; otherwise the
publisher receives a `type: "error"` response and nothing is published.

Invalid protocol requests also receive a JSON response with `type: "error"` and
an explanatory `error` field.

## Logs

The server creates and appends structured JSON log entries to:

```text
logs/connection-gateway.log
```

The log records HTTP request metadata, channel and WebSocket lifecycle events,
publish outcomes, and bad-work details. It does not record message contents.
The log file is generated locally and is not committed to Git. To follow it
live in PowerShell:

```powershell
Get-Content .\logs\connection-gateway.log -Wait
```
