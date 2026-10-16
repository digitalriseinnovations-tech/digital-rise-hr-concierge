import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, getEmployeeById, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { getMyLatestConversation } from "@/lib/concierge/conversation-history";

// Returns the signed-in employee's own most recent AIVA conversation, if
// any — safe fields only (role, content). Deliberately takes no request
// body/query params: the employeeId comes only from the verified session
// cookie, so there is nothing for a client to tamper with to reach another
// employee's conversation.
export async function GET() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Session expired. Please verify your identity again." }, { status: 401 });
  }

  const employee = await getEmployeeById(session.employeeId);
  if (!employee) {
    return NextResponse.json({ error: "We couldn't find your employee record. Please verify your identity again." }, { status: 401 });
  }

  try {
    const result = await getMyLatestConversation(session.employeeId);
    return NextResponse.json(result);
  } catch {
    // Fail closed to "nothing to resume" rather than leaking any error
    // detail — same posture as every other concierge read in this app.
    return NextResponse.json({ conversationId: null, messages: [] });
  }
}
