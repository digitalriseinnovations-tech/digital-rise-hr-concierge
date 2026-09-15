"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const DELIVERY_MODES = ["virtual", "in_person", "hybrid"] as const;
const REGISTRATION_STATUSES = ["requested", "confirmed", "waitlisted", "declined", "cancelled", "completed"] as const;
const HR_REQUEST_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

interface ProgramInput {
  name: string;
  description: string;
  durationLabel: string;
  deliveryMode: string;
  location: string;
  eligibility: string;
  requiresManagerApproval: boolean;
  seatsTotal: string;
  nextCohortStart: string;
  mandatory: boolean;
}

function validateProgram(input: ProgramInput) {
  if (!input.name || input.name.trim().length < 2) throw new Error("Program name is required.");
  if (input.deliveryMode && !DELIVERY_MODES.includes(input.deliveryMode as any)) throw new Error("Invalid delivery mode.");
}

export async function createTrainingProgram(input: ProgramInput) {
  await requirePermission("hr_learning.edit");
  validateProgram(input);

  const seatsTotal = input.seatsTotal ? parseInt(input.seatsTotal, 10) : null;
  const supabase = await createClient();
  const { error } = await supabase.from("training_programs").insert({
    name: input.name.trim(),
    description: input.description || null,
    duration_label: input.durationLabel || null,
    delivery_mode: input.deliveryMode || null,
    location: input.location || null,
    eligibility: input.eligibility || null,
    requires_manager_approval: input.requiresManagerApproval,
    seats_total: seatsTotal,
    seats_available: seatsTotal,
    next_cohort_start: input.nextCohortStart || null,
    mandatory: input.mandatory,
    active: true,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/hr-learning");
}

export async function updateTrainingProgram(id: string, input: ProgramInput) {
  await requirePermission("hr_learning.edit");
  validateProgram(input);

  const seatsTotal = input.seatsTotal ? parseInt(input.seatsTotal, 10) : null;
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_programs")
    .update({
      name: input.name.trim(),
      description: input.description || null,
      duration_label: input.durationLabel || null,
      delivery_mode: input.deliveryMode || null,
      location: input.location || null,
      eligibility: input.eligibility || null,
      requires_manager_approval: input.requiresManagerApproval,
      seats_total: seatsTotal,
      next_cohort_start: input.nextCohortStart || null,
      mandatory: input.mandatory,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/hr-learning");
}

export async function setTrainingProgramActive(id: string, active: boolean) {
  await requirePermission("hr_learning.edit");
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_programs")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/hr-learning");
}

export async function updateTrainingRegistrationStatus(id: string, status: string) {
  await requirePermission("hr_learning.edit");
  if (!REGISTRATION_STATUSES.includes(status as any)) throw new Error("Invalid status.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_registrations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/hr-learning");
}

export async function updateHrRequestStatus(id: string, status: string) {
  await requirePermission("hr_learning.edit");
  if (!HR_REQUEST_STATUSES.includes(status as any)) throw new Error("Invalid status.");
  const user = await requirePermission("hr_learning.edit");
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
  revalidatePath("/hr-learning");
}
