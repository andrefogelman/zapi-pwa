import { NextResponse } from "next/server";
import { getQueueLength } from "@/lib/queue";

// Simple status endpoint to check queue
export async function GET() {
  const length = await getQueueLength();
  return NextResponse.json({ queue: length });
}
