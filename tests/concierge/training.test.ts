import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  listTrainingPrograms,
  getTrainingProgramByName,
  getMyTraining,
  findExistingRegistration,
  computeEnrollmentToken,
  verifyEnrollmentToken,
  enrollInTraining,
  type TrainingProgram,
} from "../../src/lib/concierge/training";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Ephemeral test-only programs — deliberately NOT the real seeded catalogue
// (Emerging Leaders / Strategic Leadership / AI & Digital Productivity /
// Cybersecurity Awareness), so a seat-decrement or waitlist test can never
// leave the shared demo project's real seat counts permanently mutated.
// Deleting a program cascades to any registration created against it
// (training_registrations.program_id -> on delete cascade), so afterAll
// only needs to delete the programs themselves.

let jamesId: string | null = null;
let priyaId: string | null = null;
let cappedProgramId: string | null = null; // seats_total=2, seats_available=2, direct
let fullProgramId: string | null = null; // seats_total=1, seats_available=0, direct
let approvalProgramId: string | null = null; // requires_manager_approval=true
let uncappedProgramId: string | null = null; // no seat cap, direct

beforeAll(async () => {
  if (!client) return;
  const { data: employees } = await client.from("employees").select("id, employee_code").in("employee_code", ["NSG-1005", "NSG-1006"]);
  jamesId = employees?.find((e) => e.employee_code === "NSG-1005")?.id ?? null;
  priyaId = employees?.find((e) => e.employee_code === "NSG-1006")?.id ?? null;

  const { data: programs } = await client
    .from("training_programs")
    .insert([
      { name: "TEST — Capped Direct Program", requires_manager_approval: false, seats_total: 2, seats_available: 2, active: true },
      { name: "TEST — Full Direct Program", requires_manager_approval: false, seats_total: 1, seats_available: 0, active: true },
      { name: "TEST — Approval Required Program", requires_manager_approval: true, active: true },
      { name: "TEST — Uncapped Direct Program", requires_manager_approval: false, active: true },
    ])
    .select("id, name");

  cappedProgramId = programs?.find((p) => p.name === "TEST — Capped Direct Program")?.id ?? null;
  fullProgramId = programs?.find((p) => p.name === "TEST — Full Direct Program")?.id ?? null;
  approvalProgramId = programs?.find((p) => p.name === "TEST — Approval Required Program")?.id ?? null;
  uncappedProgramId = programs?.find((p) => p.name === "TEST — Uncapped Direct Program")?.id ?? null;
});

afterAll(async () => {
  if (!client) return;
  const ids = [cappedProgramId, fullProgramId, approvalProgramId, uncappedProgramId].filter(Boolean) as string[];
  if (ids.length > 0) {
    await client.from("training_programs").delete().in("id", ids);
  }
});

describe("listTrainingPrograms / getTrainingProgramByName — real seeded catalogue, read-only", () => {
  it.skipIf(!hasCreds)("lists the seeded active programs, including the known Northstar Global catalogue", async () => {
    const programs = await listTrainingPrograms();
    const names = programs.map((p) => p.name);
    expect(names).toContain("Emerging Leaders Program");
    expect(names).toContain("Cybersecurity Awareness");
  });

  it.skipIf(!hasCreds)("finds a program by case-insensitive partial name match", async () => {
    const program = await getTrainingProgramByName("emerging leaders");
    expect(program?.name).toBe("Emerging Leaders Program");
    expect(program?.requiresManagerApproval).toBe(true);
  });

  it.skipIf(!hasCreds)("returns null for a program that doesn't exist", async () => {
    const program = await getTrainingProgramByName("Definitely Not A Real Program XYZ");
    expect(program).toBeNull();
  });
});

describe("computeEnrollmentToken / verifyEnrollmentToken — bound to exact employee+program", () => {
  it("the same employee+program always produces the same token", () => {
    expect(computeEnrollmentToken("emp-1", "prog-1")).toBe(computeEnrollmentToken("emp-1", "prog-1"));
  });

  it("a token does NOT verify for a different program", () => {
    const token = computeEnrollmentToken("emp-1", "prog-1");
    expect(verifyEnrollmentToken(token, "emp-1", "prog-2")).toBe(false);
  });

  it("a token does NOT verify for a different employee", () => {
    const token = computeEnrollmentToken("emp-1", "prog-1");
    expect(verifyEnrollmentToken(token, "emp-2", "prog-1")).toBe(false);
  });

  it("an empty/undefined token never verifies", () => {
    expect(verifyEnrollmentToken(undefined, "emp-1", "prog-1")).toBe(false);
    expect(verifyEnrollmentToken("", "emp-1", "prog-1")).toBe(false);
  });
});

describe("enrollInTraining — the one write in this module", () => {
  it.skipIf(!hasCreds)("a program requiring manager/HR approval is NEVER auto-confirmed — always 'requested'", async () => {
    const program: TrainingProgram = {
      id: approvalProgramId!,
      name: "TEST — Approval Required Program",
      description: null,
      durationLabel: null,
      deliveryMode: null,
      location: null,
      eligibility: null,
      requiresManagerApproval: true,
      seatsTotal: null,
      seatsAvailable: null,
      nextCohortStart: null,
      mandatory: false,
    };
    const result = await enrollInTraining(jamesId!, program);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("requested");

    const { data: row } = await client!.from("training_registrations").select("status").eq("id", result.registrationId!).single();
    expect(row?.status).toBe("requested");
  });

  it.skipIf(!hasCreds)("a direct-registration program with an available seat registers as 'confirmed' and atomically decrements seats_available by exactly 1", async () => {
    const program: TrainingProgram = {
      id: cappedProgramId!,
      name: "TEST — Capped Direct Program",
      description: null,
      durationLabel: null,
      deliveryMode: null,
      location: null,
      eligibility: null,
      requiresManagerApproval: false,
      seatsTotal: 2,
      seatsAvailable: 2,
      nextCohortStart: null,
      mandatory: false,
    };
    const result = await enrollInTraining(jamesId!, program);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("confirmed");

    const { data: prog } = await client!.from("training_programs").select("seats_available").eq("id", cappedProgramId!).single();
    expect(prog?.seats_available).toBe(1);
  });

  it.skipIf(!hasCreds)("a direct-registration program with zero seats available registers as 'waitlisted', never over-booked", async () => {
    const program: TrainingProgram = {
      id: fullProgramId!,
      name: "TEST — Full Direct Program",
      description: null,
      durationLabel: null,
      deliveryMode: null,
      location: null,
      eligibility: null,
      requiresManagerApproval: false,
      seatsTotal: 1,
      seatsAvailable: 0,
      nextCohortStart: null,
      mandatory: false,
    };
    const result = await enrollInTraining(jamesId!, program);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("waitlisted");

    const { data: prog } = await client!.from("training_programs").select("seats_available").eq("id", fullProgramId!).single();
    expect(prog?.seats_available).toBe(0); // unchanged — never went negative
  });

  it.skipIf(!hasCreds)("a direct-registration program with no seat cap registers as 'confirmed'", async () => {
    const program: TrainingProgram = {
      id: uncappedProgramId!,
      name: "TEST — Uncapped Direct Program",
      description: null,
      durationLabel: null,
      deliveryMode: null,
      location: null,
      eligibility: null,
      requiresManagerApproval: false,
      seatsTotal: null,
      seatsAvailable: null,
      nextCohortStart: null,
      mandatory: false,
    };
    const result = await enrollInTraining(priyaId!, program);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("confirmed");
  });
});

describe("getMyTraining / findExistingRegistration — identity scoping", () => {
  it.skipIf(!hasCreds)("James's registrations do not include Priya's, and vice versa", async () => {
    const jamesTraining = await getMyTraining(jamesId!);
    const priyaTraining = await getMyTraining(priyaId!);

    expect(jamesTraining.some((t) => t.programId === uncappedProgramId)).toBe(false);
    expect(priyaTraining.some((t) => t.programId === uncappedProgramId)).toBe(true);
    expect(priyaTraining.some((t) => t.programId === cappedProgramId)).toBe(false);
  });

  it.skipIf(!hasCreds)("findExistingRegistration finds James's real registration for the approval-required program", async () => {
    const existing = await findExistingRegistration(jamesId!, approvalProgramId!);
    expect(existing?.status).toBe("requested");
  });

  it.skipIf(!hasCreds)("findExistingRegistration returns null for a program the employee never registered for", async () => {
    const existing = await findExistingRegistration(priyaId!, approvalProgramId!);
    expect(existing).toBeNull();
  });
});
