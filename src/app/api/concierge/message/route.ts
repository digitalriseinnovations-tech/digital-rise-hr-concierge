import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, getEmployeeById, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { startConversation, runConciergeTurn } from "@/lib/concierge/orchestrator";
import { isRateLimited } from "@/lib/concierge/rate-limit";

interface MessageBody {
  conversationId?: string;
  message?: string;
}

const MAX_MESSAGE_LENGTH = 2000;

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Session expired. Please verify your identity again." }, { status: 401 });
  }

  if (isRateLimited(`message:${session.employeeId}`)) {
    return NextResponse.json({ error: "Please slow down a little — try again in a minute." }, { status: 429 });
  }

  let body: MessageBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Please enter a message." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "That message is too long." }, { status: 400 });
  }

  // Always resolve identity fresh from the DB — the session token carries
  // only an employeeId, never a name or any other field.
  const employee = await getEmployeeById(session.employeeId);
  if (!employee) {
    return NextResponse.json({ error: "We couldn't find your employee record. Please verify your identity again." }, { status: 401 });
  }

  let conversationId = body.conversationId;
  if (!conversationId) {
    try {
      conversationId = await startConversation(employee.id);
    } catch {
      // startConversation() already logged the real Supabase diagnostic
      // server-side (see orchestrator.ts) — the browser only ever gets
      // this generic message, never the underlying error detail. Returning
      // valid JSON here (instead of letting the exception reach Next.js's
      // own generic error handler) is what lets the frontend show a real
      // message instead of a misleading "Network error".
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
