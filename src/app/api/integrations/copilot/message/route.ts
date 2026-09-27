import { NextResponse } from "next/server";
import { isValidCopilotApiKey, identifyCopilotEmployee } from "@/lib/concierge/copilot-auth";
import { startConversation, runConciergeTurn } from "@/lib/concierge/orchestrator";
import { isRateLimited } from "@/lib/concierge/rate-limit";

interface CopilotMessageBody {
  employee_code?: string;
  email?: string;
  conversationId?: string;
  message?: string;
}

const MAX_MESSAGE_LENGTH = 2000;

/**
 * POST /api/integrations/copilot/message
 * Header: X-Copilot-Api-Key: <COPILOT_INTEGRATION_API_KEY>
 * Body: { employee_code, email, message, conversationId? }
 *
 * The core of the Copilot integration boundary: routes straight into the
 * SAME runConciergeTurn() the employee-facing chat UI uses — every
 * existing safety property (deterministic confirmation fast-path, the
 * test-runtime Anthropic guard, the leave/escalation/training
 * confirmation-before-write architecture, idempotency) applies here
 * automatically, because it's the identical function, not a reimplementation.
 */
export async function POST(request: Request) {
  if (!isValidCopilotApiKey(request)) {
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }

  let body: CopilotMessageBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const employee = await identifyCopilotEmployee(body.employee_code ?? null, body.email ?? null);
  if (!employee) {
    return NextResponse.json({ error: "We couldn't verify those details." }, { status: 401 });
  }

  if (isRateLimited(`copilot-message:${employee.id}`)) {
    return NextResponse.json({ error: "Please slow down a little — try again in a minute." }, { status: 429 });
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Please enter a message." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "That message is too long." }, { status: 400 });
  }

  let conversationId = body.conversationId;
  if (!conversationId) {
    try {
      conversationId = await startConversation(employee.id);
    } catch {
      return NextResponse.json({ error: "Unable to start the conversation. Please try again." }, { status: 500 });
    }
  }

  const result = await runConciergeTurn({
    conversationId,
    employeeId: employee.id,
    employeeFirstName: employee.firstName,
    employeeFullName: employee.fullName,
    userMessage: message,
  });

  return NextResponse.json({
    conversationId,
    reply: result.reply,
    usedKnowledge: result.usedKnowledge,
    escalated: result.escalated,
  });
}
