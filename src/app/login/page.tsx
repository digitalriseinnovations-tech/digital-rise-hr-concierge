import { getProductBranding } from "@/lib/product-mode";
import { LoginForm } from "./login-form";

const branding = getProductBranding();

export const metadata = {
  title: `Sign in — ${branding.pageTitle}`,
  description: `${branding.fullName}. Restricted access.`,
  robots: { index: false, follow: false },
};

// Force per-request rendering rather than build-time static prerendering —
// the same defense-in-depth reasoning as leave-decision/leave-request's own
// `dynamic = "force-dynamic"`: this page's branding depends on
// APP_PRODUCT_MODE, a deployment env var, and this project has already been
// bitten once (the Proxy/Supabase incident) by an env var resolving
// differently at build time vs runtime. Static prerendering isn't wrong
// here in the common case, but this removes the ambiguity entirely.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm branding={branding} />;
}
