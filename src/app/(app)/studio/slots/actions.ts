"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { adSlots } from "@/lib/db/schema";

/** Creator per-placement approval (spec §3.3 double opt-in, step 2). */
export async function approveSlot(formData: FormData) {
  const slotId = String(formData.get("slotId") ?? "");
  if (!slotId) return;
  await db
    .update(adSlots)
    .set({ status: "approved", updatedAt: new Date().toISOString() })
    .where(eq(adSlots.id, slotId));
  console.log("[ads] placement_approved", { slotId });
  revalidatePath("/studio/slots");
}

/** Post-hoc reject (ADR-009): hides the ad on future views + logs it. */
export async function rejectSlot(formData: FormData) {
  const slotId = String(formData.get("slotId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!slotId) return;
  await db
    .update(adSlots)
    .set({
      status: "rejected",
      rejectReason: reason || "Rejected by creator",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(adSlots.id, slotId));
  console.log("[ads] placement_rejected", { slotId, reason });
  revalidatePath("/studio/slots");
}

/** Undo a decision back to the review queue. */
export async function resetSlot(formData: FormData) {
  const slotId = String(formData.get("slotId") ?? "");
  if (!slotId) return;
  await db
    .update(adSlots)
    .set({ status: "filled", rejectReason: null, updatedAt: new Date().toISOString() })
    .where(eq(adSlots.id, slotId));
  revalidatePath("/studio/slots");
}
