# Relay Tree (JavaScript)

An HTTP and WebSocket server that creates and inspects a binary relay tree,
assigns WebSocket clients to leaf relays, and broadcasts published messages
through the tree. This app is separate from the `connection-gateway` benchmark.

## Requirements

- Git
- Node.js 20 or newer
- npm (included with Node.js)

## Clone and install

Clone the repository and enter the Relay Tree app:

```powershell
git clone --branch main --single-branch https://github.com/rojamuthiah/connection-gateway-js.git
cd connection-gateway-js\relay-tree
npm ci
Copy-Item .env.example .env
```

If you already cloned the repository, start from its root and run:

```powershell
cd relay-tree
npm ci
Copy-Item .env.example .env
```

Edit `.env` to change the listening port. The default is `8080`:

```dotenv
PORT=8080
```

## Run

For development with automatic restart on source changes:

```powershell
npm run dev
```

For a regular start:

```powershell
npm start
```

The server listens on `http://localhost:8080` and accepts WebSocket
connections at `ws://localhost:8080/ws` by default. Keep the terminal open
while using the API and stop the process with `Ctrl+C`.

If port `8080` is already in use, change `PORT` in `.env`. If both apps in this
repository are running, give them different ports; for example, use `8081` for
Relay Tree while Connection Gateway uses `8080`.

## API

### Create or replace the tree

`POST /tree/create` accepts JSON with an integer `depth` from 0 to 10:

```json
{
  "depth": 2
}
```

Example PowerShell request:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8080/tree/create `
  -ContentType 'application/json' `
  -Body '{"depth":2}'
```

The server returns `201 Created` with the depth, root relay ID, relay and leaf
counts, topology, and relay information. Creating a tree again replaces the
current tree and closes its connected clients.

### Inspect the tree

- `GET /tree` returns the complete tree. It returns `404` until a tree exists.
- `GET /tree/relays` lists all relays, including parent/child IDs and client
  counts.
- `GET /tree/leaves` lists leaf relays.
- `GET /health` returns the server health and current tree information.

### Subscribe and publish

After creating a tree, connect a WebSocket client to `ws://localhost:8080/ws`.
The server assigns each new connection to a leaf relay. Send a non-empty
message to `POST /publish` as plain text:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8080/publish `
  -ContentType 'text/plain' `
  -Body 'Hello from Relay Tree'
```

Messages are broadcast through the relay tree to connected WebSocket clients.
Publishing before creating the tree returns a service-unavailable response.

## Postman

Import [`relay-tree.postman_collection.json`](./relay-tree.postman_collection.json)
into Postman. It includes requests for creating and inspecting the tree,
checking health, and publishing a message. The collection's default base URL is
`http://localhost:8080`.

## Tests

The Relay Tree package does not currently define an automated test script.
Validate the JavaScript syntax with:

```powershell
node --check src/server.js
node --check src/relayTree.js
node --check src/relay.js
```

## Local files

`.env` and `node_modules/` are excluded from Git by the repository-level
`.gitignore`. Keep secrets and machine-specific settings in `.env`, not in
`.env.example`.
