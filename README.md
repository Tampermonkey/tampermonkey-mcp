# How to use

First install the following browser extensions:
* [Tampermonkey](https://www.tampermonkey.net/)
* Tampermonkey Editors for [Firefox](https://addons.mozilla.org/de/firefox/addon/tampermonkey-editors/) or [Chrome](https://chrome.google.com/webstore/detail/lieodnapokbjkkdkhdljlllmgkmdokcm)

Then install `tampermonkey-mcp` globally:
```bash
npm install -g tampermonkey-mcp@latest
```

Finally configure your AI assistant to use the `tampermonkey` tool:
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
Your assistant will call `tampermonkey_get_connection_code` and return a connection code that you can enter in the Tampermonkey Editors extension.

# Claude Code configuration example
```
npm install -g @anthropic-ai/claude-code

// either use your local checkout
npm run watch
claude mcp add --transport http --scope project tampermonkey http://localhost:4001/mcp

// or the npm package
npm install -g tampermonkey-mcp@latest
claude mcp add --transport stdio --scope project tampermonkey -- npx -y tampermonkey-mcp

// more browser control needed?
// Open chrome://inspect/#remote-debugging
// [x] Allow remote debugging for this browser instance
// or
chromium --user-data-dir=/tmp/chrome-devtools-mcp-test-profile --remote-debugging-port=9222

npm install -g chrome-devtools-mcp@latest
// install Tampermonkey and Tampermonkey Editors
claude mcp add --transport stdio --scope project chrome-devtools-mcp -- npx -y chrome-devtools-mcp@latest --slim --no-usage-statistics --auto-connect --browser-url http://127.0.0.1:9222
```

# Native messaging

Native mode is an opt-in alternative to entering a connection code after browser restarts. It requires a Tampermonkey Editors release with **Local MCP connection** support. The existing WebSocket/connection-code flow remains available.

Install the package globally in a stable location, then register the helper once for your browser:

```bash
npm install -g tampermonkey-mcp
tampermonkey-mcp --install-native-host firefox
# Or: tampermonkey-mcp --install-native-host chrome
```

In the Editors popup, choose **Local MCP connection → Enable / apply** and grant the optional native-messaging permission. Reading existing userscript source is the default. Select **Allow updates to existing scripts** and apply again if you want source updates. The native connection exposes no create/delete, storage or external-resource operations; patches require the revision from a prior read.

Configure the MCP client to run the globally installed command with `--transport=native`:

```json
{
  "mcpServers": {
    "tampermonkey": {
      "command": "tampermonkey-mcp",
      "args": ["--transport=native"]
    }
  }
}
```

If a Windows MCP client cannot execute npm command shims, use `node` with the absolute path to the globally installed `bin/tampermonkey-mcp`, followed by `--transport=native`. Register from the permanent installation, not a temporary `npx` checkout. The installer records the current absolute Node and package paths so GUI-launched browsers do not need your shell's version-manager PATH. Re-register if you relocate Node or the package.

The browser starts a registered helper over native messaging. Independent MCP clients and that helper share one demand-started local broker; closing a client does not close the browser connection. Editors reconnects after browser/helper restarts without requesting another code. A second browser/profile waits until the first disconnects instead of silently taking over. Interrupted calls are never replayed automatically, because an update may already have reached Tampermonkey.

## Native security boundary

- Disabled by default in Editors and gated by an optional browser permission. Only the extension popup can grant or expand access; content-script/page messages cannot do so. **Disable and forget** clears consent, disconnects the helper and removes the permission.
- The installed host manifest allows only the official Editors extension ID. Browser storage retains only the permission choices, with no reusable pairing secret and no URL-triggered authorization.
- The helper/broker connection uses loopback TLS with a certificate trusted from the private runtime and a random 256-bit bearer token. A process taking over a stale port cannot receive the token without the trusted server key. Browser Origins and unexpected Host headers are rejected.
- Credentials stay in a directory restricted to the current user and SYSTEM on Windows, or owner-only files/directories on Unix. These are OS access controls, not isolation from malware already running as that user or an administrator. The native helper registration and installed package are part of the trusted local application.
- The host/broker/browser enforce bounded messages, source-only paths, write consent and required patch revisions. Helper stdout contains only native protocol frames; no source or credentials are logged. The native mode does not change the existing WebSocket backend's capabilities.

Registration supports Firefox and Chrome on Windows, macOS and Linux. Windows uses only the current user's registry. The private runtime defaults to `%LOCALAPPDATA%/TampermonkeyMCP/native` on Windows or `~/.local/share/tampermonkey-mcp/native` on Unix; `TAMPERMONKEY_NATIVE_DIRECTORY` selects an absolute alternative for development. Do not upload this directory. A corrupt credential file fails explicitly rather than silently replacing trust.

To remove the browser registration, run `tampermonkey-mcp --uninstall-native-host firefox` (or `chrome`). Disable it in Editors first. Unregistering one browser preserves the shared runtime for other registrations. No extension database, browser security preference, remote-debugging mode or keep-awake setting is changed.

## Native validation

```bash
npm run test:native
```

Tests cover framing, permissions, installer plans, real native-helper processes, independent MCP clients, browser disconnection/reconnection, shared cold startup and broker restart, failed-patch non-replay, TLS identity checks and browser-origin rejection. They use isolated temporary runtimes and do not install a host into the test user's browser. The companion Editors tests/build cover its browser API adapter; native host installation and restart behavior in each real browser/OS still require platform acceptance testing.

# Build

```bash
npm install
npm run all
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
│  │                               │  - tampermonkey_get_connection_code   │  │
│  │                               │  - tampermonkey_list                  │  │
│  │                               │  - tampermonkey_get                   │  │
│  │                               │  - tampermonkey_patch                 │  │
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
3. **User calls `tampermonkey_get_connection_code`** - Gets the connection code
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

### `tampermonkey_get_connection_code`
* **Purpose**: Initialize connection by getting the WebSocket connection code.
* **Required**: Must be called first to start the WebSocket server.
* **Output**: Connection code to enter in Tampermonkey Editors.

### `tampermonkey_list`
* **Purpose**: List all available userscripts.
* **Input**: Optional filter by name pattern or include URL pattern.
* **Output**: Array of userscript metadata (name, namespace, path, requires).

### `tampermonkey_get`
* **Purpose**: Get content of a specific userscript.
* **Input**: `path` (from list), optional `ifNotModifiedSince` timestamp.
* **Output**: Script content, lastModified timestamp, or error.

### `tampermonkey_patch`
* **Purpose**: Update userscript content.
* **Input**: `path`, `value` (new content), optional `lastModified` for optimistic locking.
* **Output**: Success confirmation or error.

### `tampermonkey_put`
* **Purpose**: Create a new userscript with the given name and namespace.
* **Input**: `value` (new script), optional `lastModified`.
* **Output**: Success confirmation, path of created script, or error.
* **Requires**: Tampermonkey Editors 1.0.6+ and Tampermonkey 5.6+

### `tampermonkey_delete`
* **Purpose**: Delete an existing userscript.
* **Input**: `path` (from list).
* **Output**: Success confirmation or error.
* **Requires**: Tampermonkey Editors 1.0.6+ and Tampermonkey 5.6+


# Basic testing
## MCP Server capabilities

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

## test stdio

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test-client","version":"1.0.0"},"capabilities":{}}}' | npx -y tampermonkey-mcp
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | npx -y tampermonkey-mcp
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tampermonkey_list","arguments":{"pattern":""}}}' | npx -y tampermonkey-mcp
```
