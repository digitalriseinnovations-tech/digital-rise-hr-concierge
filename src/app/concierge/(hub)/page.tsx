import { cookies } from "next/headers";
import Link from "next/link";
import { verifySessionToken, getEmployeeById, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { ChatPanel } from "@/components/concierge/ChatPanel";
import { getMyLeaveBalance } from "@/lib/concierge/leave";
import { getMyTraining } from "@/lib/concierge/training";
import { getMyHrRequests } from "@/lib/concierge/hr-requests";

const SUGGESTED_PROMPTS = [
  "How many leave days do I have?",
  "I want leave from October 12 to October 15.",
  "What is the status of my leave request?",
  "What is our annual leave policy?",
  "What is our hybrid work policy?",
  "What happens during onboarding?",
  "What benefits are available?",
  "What training programs are available?",
  "I'd like to enroll in a training program.",
  "How does the mentorship program work? I'd like a mentor.",
  "Tell me about executive coaching.",
];

export default async function AskHrPage() {
  // Layout above already guarantees a valid session exists; re-resolve
  // here to get the first name AND live per-employee snapshot data for the
  // home cards below — never trust anything client-supplied for either.
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  const employee = session ? await getEmployeeById(session.employeeId) : null;
  const firstName = employee?.firstName ?? "there";

  const [balance, myTraining, myRequests] = session
    ? await Promise.all([
        getMyLeaveBalance(session.employeeId, "annual"),
        getMyTraining(session.employeeId),
        getMyHrRequests(session.employeeId),
      ])
    : [null, [], []];

  const activeTraining = myTraining.filter((t) => t.status === "confirmed" || t.status === "requested" || t.status === "waitlisted").length;
  const openRequests = myRequests.filter((r) => r.status === "open" || r.status === "in_progress").length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Good {timeOfDayGreeting()}, {firstName}.</h1>
        <p className="mt-1 text-sm text-slate-500">How can I help today?</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <HomeCard
          href="/concierge/my-hr"
          label="My Leave"
          value={balance ? `${balance.remainingDays} days remaining` : "View balance"}
        />
        <HomeCard
          href="/concierge/my-learning"
          label="My Learning"
          value={activeTraining > 0 ? `${activeTraining} in progress` : "Recommended programs"}
        />
        <HomeCard href="/concierge/my-learning" label="Mentorship" value="Explore development support" />
        <HomeCard href="/concierge/my-learning" label="Career Growth" value="Training & coaching" />
        <HomeCard href="/concierge/getting-started" label="Getting Started" value="Onboarding help" />
        <HomeCard
          href="/concierge/support"
          label="HR Support"
          value={openRequests > 0 ? `${openRequests} open request${openRequests === 1 ? "" : "s"}` : "Speak with HR"}
        />
      </div>

      <ChatPanel suggestedPrompts={SUGGESTED_PROMPTS} />
    </div>
  );
}

function HomeCard({ href, label, value }: { href: string; label: string; value: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-1">{label}</div>
      <div className="text-sm text-slate-700">{value}</div>
    </Link>
  );
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
