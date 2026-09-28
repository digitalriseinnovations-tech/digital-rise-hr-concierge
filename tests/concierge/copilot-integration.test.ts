import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { GET as employeeContextGET } from "../../src/app/api/integrations/copilot/employee-context/route";
import { GET as leaveBalanceGET } from "../../src/app/api/integrations/copilot/leave-balance/route";
import { GET as leaveRequestsGET } from "../../src/app/api/integrations/copilot/leave-requests/route";
import { GET as myTrainingGET } from "../../src/app/api/integrations/copilot/my-training/route";
import { GET as hrPolicyGET } from "../../src/app/api/integrations/copilot/hr-policy/route";
import { POST as mcpPOST, GET as mcpGET } from "../../src/app/api/mcp/route";

/**
 * Phase 2 (REST) + Phase 3 (MCP) — read-only Copilot integration surface.
 * Calls route handlers directly (no dev server / no network hop) — same
 * approach tests/concierge/training-progress.test.ts already uses for
 * executeTool(), which sidesteps the whole "which process is actually
 * running" class of bug documented in tests/platform/live-server-test-
 * safety.test.ts. No Anthropic call is reachable from any test here
 * (tools/list, tools/call for the six read-only tools, and every REST GET
 * below only ever reach deterministic Supabase reads).
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const API_KEY = "test-copilot-key-for-vitest-only";
const ORIGINAL_KEY = process.env.COPILOT_INTEGRATION_API_KEY;

const SARAH = { employee_code: "NSG-1001", email: "sarah.ahmed@northstarglobal.com" };
const DANIEL = { employee_code: "NSG-1002", email: "daniel.carter@northstarglobal.com" };

beforeAll(() => {
  process.env.COPILOT_INTEGRATION_API_KEY = API_KEY;
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.COPILOT_INTEGRATION_API_KEY;
  else process.env.COPILOT_INTEGRATION_API_KEY = ORIGINAL_KEY;
});

function copilotUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

describe("REST Copilot endpoints — authentication", () => {
  it.skipIf(!hasCreds)("missing API key -> 401", async () => {
    const res = await employeeContextGET(new Request(copilotUrl("/api/integrations/copilot/employee-context", SARAH)));
    expect(res.status).toBe(401);
  });

  it.skipIf(!hasCreds)("wrong API key -> 401", async () => {
    const res = await employeeContextGET(
      new Request(copilotUrl("/api/integrations/copilot/employee-context", SARAH), { headers: { "X-Copilot-Api-Key": "wrong-key" } }),
    );
    expect(res.status).toBe(401);
  });

  it("unset COPILOT_INTEGRATION_API_KEY fails closed, never bypassed", async () => {
    delete process.env.COPILOT_INTEGRATION_API_KEY;
    const res = await employeeContextGET(
      new Request(copilotUrl("/api/integrations/copilot/employee-context", SARAH), { headers: { "X-Copilot-Api-Key": "anything" } }),
    );
    expect(res.status).toBe(401);
    process.env.COPILOT_INTEGRATION_API_KEY = API_KEY;
  });

  it.skipIf(!hasCreds)("correct API key but wrong email for the given code -> 401 (invalid employee identity)", async () => {
    const res = await employeeContextGET(
      new Request(copilotUrl("/api/integrations/copilot/employee-context", { employee_code: SARAH.employee_code, email: "wrong@example.com" }), {
        headers: { "X-Copilot-Api-Key": API_KEY },
      }),
    );
    expect(res.status).toBe(401);
  });

  it.skipIf(!hasCreds)("cross-employee: Sarah's code with Daniel's email -> 401, never returns either employee's data", async () => {
    const res = await employeeContextGET(
      new Request(copilotUrl("/api/integrations/copilot/employee-context", { employee_code: SARAH.employee_code, email: DANIEL.email }), {
        headers: { "X-Copilot-Api-Key": API_KEY },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("REST Copilot endpoints — read-only data, correctly scoped", () => {
  it.skipIf(!hasCreds)("employee-context resolves the real seeded employee", async () => {
    const res = await employeeContextGET(
      new Request(copilotUrl("/api/integrations/copilot/employee-context", SARAH), { headers: { "X-Copilot-Api-Key": API_KEY } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.firstName).toBe("Sarah");
  });

  it.skipIf(!hasCreds)("leave-balance returns a shaped result for the real employee", async () => {
    const res = await leaveBalanceGET(
      new Request(copilotUrl("/api/integrations/copilot/leave-balance", SARAH), { headers: { "X-Copilot-Api-Key": API_KEY } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.found).toBe("boolean");
  });

  it.skipIf(!hasCreds)("leave-requests returns an array scoped to this employee", async () => {
    const res = await leaveRequestsGET(
      new Request(copilotUrl("/api/integrations/copilot/leave-requests", SARAH), { headers: { "X-Copilot-Api-Key": API_KEY } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.requests)).toBe(true);
  });

  it.skipIf(!hasCreds)("my-training returns an array with the derived overdue flag present per entry", async () => {
    const res = await myTrainingGET(
      new Request(copilotUrl("/api/integrations/copilot/my-training", SARAH), { headers: { "X-Copilot-Api-Key": API_KEY } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.registrations)).toBe(true);
    for (const entry of body.registrations) {
      expect(typeof entry.overdue).toBe("boolean");
    }
  });

  it.skipIf(!hasCreds)("hr-policy searches the real knowledge base and returns a shaped result", async () => {
    const res = await hrPolicyGET(
      new Request(copilotUrl("/api/integrations/copilot/hr-policy", { ...SARAH, query: "annual leave" }), {
        headers: { "X-Copilot-Api-Key": API_KEY },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.found).toBe("boolean");
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

describe("MCP /api/mcp — transport", () => {
  function mcpRequest(body: unknown, apiKey: string | null = API_KEY): Request {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["X-Copilot-Api-Key"] = apiKey;
    return new Request("http://localhost/api/mcp", { method: "POST", headers, body: JSON.stringify(body) });
  }

  it("unauthorized request (missing API key) -> 401, before any JSON-RPC handling", async () => {
    const res = await mcpPOST(mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, null));
    expect(res.status).toBe(401);
  });

  it("unauthorized request (wrong API key) -> 401", async () => {
    const res = await mcpPOST(mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, "wrong-key"));
    expect(res.status).toBe(401);
  });

  it("GET is not supported (stateless server) -> 405", async () => {
    const res = await mcpGET();
    expect(res.status).toBe(405);
  });

  it("initialize returns protocolVersion and serverInfo", async () => {
    const res = await mcpPOST(mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("digital-rise-hr-concierge");
    expect(typeof body.result.protocolVersion).toBe("string");
  });

  it("notifications/initialized (no id) gets 202 with no JSON-RPC body", async () => {
    const res = await mcpPOST(mcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
  });

  it("tools/list returns exactly the six expected read-only tools, nothing more", async () => {
    const res = await mcpPOST(mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names: string[] = body.result.tools.map((t: { name: string }) => t.name);
    expect(new Set(names)).toEqual(
      new Set(["get_employee_profile", "get_leave_balance", "get_leave_requests", "get_hr_policy", "get_my_training", "get_training_status"]),
    );
    // No write-capable tool name under any spelling.
    for (const name of names) {
      expect(/submit|create|enroll|approve|escalate/i.test(name)).toBe(false);
    }
  });

  it("unknown method -> JSON-RPC error, not a crash", async () => {
    const res = await mcpPOST(mcpRequest({ jsonrpc: "2.0", id: 3, method: "not/a/real/method" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });
});

describe("MCP tools/call — real employee data, identity-gated", () => {
  function callTool(name: string, args: Record<string, unknown>) {
    return mcpPostHelper({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name, arguments: args } });
  }

  async function mcpPostHelper(body: unknown) {
    const res = await mcpPOST(new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Copilot-Api-Key": API_KEY },
      body: JSON.stringify(body),
    }));
    return res.json();
  }

  it.skipIf(!hasCreds)("get_employee_profile resolves the real seeded employee", async () => {
    const body = await callTool("get_employee_profile", { employee_code: SARAH.employee_code, email: SARAH.email });
    const content = JSON.parse(body.result.content[0].text);
    expect(body.result.isError).toBe(false);
    expect(content.firstName).toBe("Sarah");
  });

  it.skipIf(!hasCreds)("get_leave_balance defaults to annual and returns a shaped result", async () => {
    const body = await callTool("get_leave_balance", { employee_code: SARAH.employee_code, email: SARAH.email });
    const content = JSON.parse(body.result.content[0].text);
    expect(body.result.isError).toBe(false);
    expect(typeof content.found).toBe("boolean");
  });

  it.skipIf(!hasCreds)("get_my_training and get_training_status agree on entry count when program_name is omitted", async () => {
    const all = await callTool("get_my_training", { employee_code: SARAH.employee_code, email: SARAH.email });
    const status = await callTool("get_training_status", { employee_code: SARAH.employee_code, email: SARAH.email });
    const allContent = JSON.parse(all.result.content[0].text);
    const statusContent = JSON.parse(status.result.content[0].text);
    expect(statusContent.registrations.length).toBe(allContent.registrations.length);
  });

  it.skipIf(!hasCreds)("get_hr_policy searches real knowledge base content", async () => {
    const body = await callTool("get_hr_policy", { employee_code: SARAH.employee_code, email: SARAH.email, query: "leave" });
    const content = JSON.parse(body.result.content[0].text);
    expect(typeof content.found).toBe("boolean");
  });

  it.skipIf(!hasCreds)("invalid employee identity (wrong email) -> isError true, no data leaked", async () => {
    const body = await callTool("get_leave_balance", { employee_code: SARAH.employee_code, email: "wrong@example.com" });
    expect(body.result.isError).toBe(true);
    const content = JSON.parse(body.result.content[0].text);
    expect(content.error).toBeTruthy();
  });

  it.skipIf(!hasCreds)("cross-employee access prevention: Sarah's code with Daniel's email -> isError true", async () => {
    const body = await callTool("get_leave_requests", { employee_code: SARAH.employee_code, email: DANIEL.email });
    expect(body.result.isError).toBe(true);
  });

  it.skipIf(!hasCreds)("unknown tool name -> isError true, not a crash", async () => {
    const body = await callTool("delete_everything", { employee_code: SARAH.employee_code, email: SARAH.email });
    expect(body.result.isError).toBe(true);
  });
});
