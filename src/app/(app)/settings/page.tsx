import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  await requirePermission("*");
  const supabase = await createClient();
  const { data: users } = await supabase.from("finance_users").select("*").order("created_at", { ascending: true });

  return (
    <div>
      <header className="mb-6">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">Admin</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">Settings · Finance Users</h1>
        <p className="text-sm text-slate-500 mt-1">Who has access to this platform.</p>
      </header>

      <div className="section-card overflow-x-auto p-0">
        <table className="table-clean">
          <thead>
            <tr><th>Email</th><th>Name</th><th>Role</th><th>Active</th><th>Added</th></tr>
          </thead>
          <tbody>
            {(users ?? []).map((u: any) => (
              <tr key={u.id}>
                <td className="font-medium text-slate-700">{u.email}</td>
                <td className="text-sm text-slate-600">{u.full_name}</td>
                <td><span className="badge badge-navy uppercase">{u.role}</span></td>
                <td>{u.active ? <span className="badge badge-green">Active</span> : <span className="badge badge-slate">Disabled</span>}</td>
                <td className="text-xs text-slate-500">{new Date(u.created_at).toLocaleDateString("en", { dateStyle: "medium" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500 mt-4">
        To add a new user: create their auth account in Supabase dashboard, then run:<br/>
        <code className="text-[11px] bg-slate-100 px-2 py-1 rounded mt-1 inline-block">{`insert into finance_users (email, full_name, role) values ('them@example.com', 'Their Name', 'finance');`}</code>
      </p>
    </div>
  );
}
