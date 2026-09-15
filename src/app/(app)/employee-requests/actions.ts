"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const HR_REQUEST_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export async function updateEmployeeRequestStatus(id: string, status: string) {
  const user = await requirePermission("employee_requests.edit");
  if (!HR_REQUEST_STATUSES.includes(status as any)) throw new Error("Invalid status.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("hr_requests")
    .update({
      status,
      handled_by: user.email,
      resolved_at: status === "resolved" || status === "closed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/employee-requests");
}
