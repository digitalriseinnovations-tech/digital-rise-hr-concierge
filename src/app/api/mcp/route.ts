import { NextResponse } from "next/server";
import { isValidCopilotApiKey } from "@/lib/concierge/copilot-auth";
import { MCP_TOOLS, executeMcpTool } from "@/lib/concierge/mcp-tools";

/**
 * /api/mcp — a Streamable HTTP MCP server (protocol per modelcontextprotocol.io),
 * exposing the SAME read-only HR service functions as the REST Copilot
 * endpoints under /api/integrations/copilot/*. This is an ADAPTER, not a
 * second HR integration architecture — every tool call in mcp-tools.ts
 * delegates to the exact library functions the employee chat UI and those
 * REST endpoints already use.
 *
 * Stateless by design (no Mcp-Session-Id issued): every tool call carries
 * its own employee_code + email, verified fresh each time via the same
 * two-factor identifyCopilotEmployee() check the REST layer uses — there
 * is no session to hijack and no way for a caller to address another
 * employee's data directly.
 *
 * Transport scope deliberately minimal: this server only ever produces a
 * single JSON-RPC response per POST (no server-initiated messages), so it
 * always responds with a single `application/json` body rather than
 * negotiating a `text/event-stream` — a spec-compliant simplification for
 * a server with nothing to push. GET/DELETE (session resumption/teardown)
 * are not supported, since this server keeps no session state to resume
 * or tear down.
 */

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "digital-rise-hr-concierge", version: "1.0.0" };

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function POST(request: Request) {
  if (!isValidCopilotApiKey(request)) {
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }

  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: invalid JSON.");
  }

  const { id, method, params } = body;

  // Notifications (no `id`) never get a response body — per JSON-RPC 2.0
  // and the MCP spec's Streamable HTTP transport, the server replies 202
  // with an empty body for any POST that is entirely notifications.
  const isNotification = id === undefined;

  switch (method) {
    case "initialize": {
      const result = {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
      return isNotification ? new NextResponse(null, { status: 202 }) : rpcResult(id, result);
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return new NextResponse(null, { status: 202 });

    case "ping":
      return isNotification ? new NextResponse(null, { status: 202 }) : rpcResult(id, {});

    case "tools/list": {
      const tools = MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
      return rpcResult(id, { tools });
    }

    case "tools/call": {
      const toolName = typeof params?.name === "string" ? params.name : "";
      const toolArgs = (params?.arguments as Record<string, unknown>) ?? {};
      const outcome = await executeMcpTool(toolName, toolArgs);
      const content = [{ type: "text", text: JSON.stringify(outcome.ok ? outcome.data : { error: outcome.error }) }];
      return rpcResult(id, { content, isError: !outcome.ok });
    }

    default:
      return isNotification ? new NextResponse(null, { status: 202 }) : rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function GET() {
  return NextResponse.json({ error: "This MCP server is stateless — GET (session resumption) is not supported." }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json({ error: "This MCP server is stateless — DELETE (session teardown) is not supported." }, { status: 405 });
}
