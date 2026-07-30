import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";

export async function GET() {
  try {
    const allBrands = await db.select().from(brands).all();
    return NextResponse.json({ brands: allBrands });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch brands" }, { status: 500 });
  }
}
