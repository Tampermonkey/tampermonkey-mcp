# Build

```bash
npm install
npm run all
```

# MCP Server capabilities

```bash
curl -X POST http://localhost:4001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "clientInfo": {
        "name": "curl-client",
        "version": "1.0.0"
      },
      "capabilities": {}
    }
  }'
```

# test stdio

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test-client","version":"1.0.0"},"capabilities":{}}}' | npx -y tampermonkey-mcp
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | npx -y tampermonkey-mcp
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tampermonkey.list","arguments":{"pattern":""}}}' | npx -y tampermonkey-mcp
```

# use

```bash
npm install -g claude

// either use your local checkout
npm run watch
claude mcp add --transport http --scope project tampermonkey http://localhost:4001/mcp

// or the npm package
npm install -g tampermonkey-mcp@latest
claude mcp add --transport stdio --scope project tampermonkey -- npx -y tampermonkey-mcp

// more browser control needed?
npm install -g chrome-devtools-mcp@latest
claude mcp add --transport stdio --scope project chrome-devtools-mcp -- npx -y chrome-devtools-mcp@latest --slim --no-usage-statistics --auto-connect --browser-url http://127.0.0.1:9222
// Open chrome://inspect/#remote-debugging
// [x] Allow remote debugging for this browser instance
```

# AI tool configuration

```bash
{
  "mcpServers": {
    "tampermonkey": {
      "command": "npx",
      "args": [
        "-y",
        "tampermonkey-mcp@latest"
      ]
    }
  }
}
```

# Tampermonkey MCP Server Architecture

## Overview

This project implements an MCP (Model Context Protocol) server that allows AI assistants to read and modify Tampermonkey userscripts via the Tampermonkey Editors browser extension.

## Architecture Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI Assistant                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ MCP Protocol (stdio transport)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         tampermonkey_mcp (MCP Server)                       │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  server.ts                    │  Main entry point                     │  │
│  │                               │  - HTTP or stdio transport            │  │
│  │                               │  - MCP middleware                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                  │                                          │
│                                  ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  tampermonkey.ts              │  MCP Tool Definitions                 │  │
│  │                               │  - tampermonkey.get-connection-code   │  │
│  │                               │  - tampermonkey.list                  │  │
│  │                               │  - tampermonkey.get                   │  │
│  │                               │  - tampermonkey.patch                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                  │                                          │
│                                  ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  tampermonkey-ws-client.ts    │  WebSocket Server                     │  │
│  │                               │  - Connection code generation         │  │
│  │                               │  - Authentication handshake           │  │
│  │                               │  - Message relay to extension         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ WebSocket (local, port derived from code)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Tampermonkey Editors Extension                            │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Service Worker               │  Receives connection code,            │  │
│  │                               │  establishes WebSocket connection     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                  │                                          │
│                                  │ Chrome Extension Messaging               │
│                                  ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Content Script               │  Bridges extension ↔ Tampermonkey     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                  │                                          │
│                                  ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Tampermonkey                 │  Userscript storage & execution       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Connection Flow

1. **MCP Server starts** - Creates WebSocket server on a random available port
2. **Connection code generated** - Format: `<base32(port - 1024)><auth_token><echo_token>`
3. **User calls `tampermonkey.get-connection-code`** - Gets the connection code
4. **User enters code in Tampermonkey Editors** - Extension parses code to get port and auth
5. **Extension connects to MCP server** - WebSocket handshake with authentication
6. **MCP tools become available** - list, get, patch can now be called

## Authentication Protocol

```
Extension                              MCP Server
    │                                      │
    │───── auth (token) ──────────────────>│
    │                                      │
    │<──── auth (echo_token) ──────────────│
    │                                      │
    │───── auth (echo_token) ─────────────>│
    │                                      │
    │<──── authOK ─────────────────────────│
    │                                      │
    │<───── pings (every 15s) ─────────────│  (keep-alive)
    │───── pongs ─────────────────────────>│
    │                                      │
    │<───── commands (list/get/patch) ─────│
    │───── responses ─────────────────────>│
```

## MCP Tools

### `tampermonkey.get-connection-code`
* **Purpose**: Initialize connection by getting the WebSocket connection code.
* **Required**: Must be called first to start the WebSocket server.
* **Output**: Connection code to enter in Tampermonkey Editors.

### `tampermonkey.list`
* **Purpose**: List all available userscripts.
* **Input**: Optional filter by name pattern or include URL pattern.
* **Output**: Array of userscript metadata (name, namespace, path, requires).

### `tampermonkey.get`
* **Purpose**: Get content of a specific userscript.
* **Input**: `path` (from list), optional `ifNotModifiedSince` timestamp.
* **Output**: Script content, lastModified timestamp, or error.

### `tampermonkey.patch`
* **Purpose**: Update userscript content.
* **Input**: `path`, `value` (new content), optional `lastModified` for optimistic locking.
* **Output**: Success confirmation or error.

### `tampermonkey.put`
* **Purpose**: Create a new userscript with the given name and namespace.
* **Input**: `value` (new script), optional `lastModified`.
* **Output**: Success confirmation, path of created script, or error.
* **Requires**: Tampermonkey Editors 1.0.6+

### `tampermonkey.delete`
* **Purpose**: Delete an existing userscript.
* **Input**: `path` (from list).
* **Output**: Success confirmation or error.
* **Requires**: Tampermonkey Editors 1.0.6+