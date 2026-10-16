import { cookies } from "next/headers";
import Link from "next/link";
import { verifySessionToken, getEmployeeById, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { ChatPanel } from "@/components/concierge/ChatPanel";
import { getMyLeaveBalance } from "@/lib/concierge/leave";
import { getMyTraining } from "@/lib/concierge/training";
import { getMyHrRequests } from "@/lib/concierge/hr-requests";
import {
  CalendarCheck,
  GraduationCap,
  Compass,
  LifeBuoy,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";

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

const TODAY_LABEL = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });

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
      <div className="relative mb-8 overflow-hidden rounded-3xl bg-brand-gradient px-7 py-8 text-white shadow-glow sm:px-9">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-white/10" />
        <div className="absolute -bottom-16 left-1/3 h-40 w-40 rounded-full bg-white/5" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">{TODAY_LABEL.format(new Date())}</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight sm:text-4xl">
            Good {timeOfDayGreeting()}, {firstName}.
          </h1>
          <p className="mt-2 max-w-md text-sm text-white/75">
            AIVA is ready to help — ask a question below, or jump straight into leave, learning and support.
          </p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <HomeCard
          href="/concierge/my-hr"
          label="My Leave"
          value={balance ? `${balance.remainingDays} days remaining` : "View balance"}
          icon={CalendarCheck}
          tint="indigo"
        />
        <HomeCard
          href="/concierge/my-learning"
          label="My Learning & Growth"
          value={activeTraining > 0 ? `${activeTraining} in progress` : "Training, mentorship & coaching"}
          icon={GraduationCap}
          tint="violet"
        />
        <HomeCard href="/concierge/getting-started" label="Getting Started" value="Onboarding help" icon={Compass} tint="sky" />
        <HomeCard
          href="/concierge/support"
          label="HR Support"
          value={openRequests > 0 ? `${openRequests} open request${openRequests === 1 ? "" : "s"}` : "Speak with HR"}
          icon={LifeBuoy}
          tint="rose"
        />
      </div>

      <ChatPanel suggestedPrompts={SUGGESTED_PROMPTS} />
    </div>
  );
}

const TINTS = {
  indigo: "bg-indigo-50 text-indigo-600",
  violet: "bg-violet-50 text-violet-600",
  sky: "bg-sky-50 text-sky-600",
  rose: "bg-rose-50 text-rose-600",
} as const;

function HomeCard({
  href,
  label,
  value,
  icon: Icon,
  tint,
}: {
  href: string;
  label: string;
  value: string;
  icon: LucideIcon;
  tint: keyof typeof TINTS;
}) {
  return (
    <Link
      href={href}
      className="group relative rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-card-hover"
    >
      <ArrowUpRight className="absolute right-3.5 top-3.5 h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${TINTS[tint]}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-800">{value}</div>
    </Link>
  );
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
