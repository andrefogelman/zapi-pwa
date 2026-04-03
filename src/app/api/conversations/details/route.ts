import { NextRequest, NextResponse } from "next/server";
import { fetchLastMessages, fetchPhotos } from "@/lib/wacli-api";

// Fetches details (last messages + photos) for a small batch of chats
// Called multiple times by the frontend with chunks of ~20 chats
export async function POST(request: NextRequest) {
  try {
    const { chatJids, phones } = await request.json() as {
      chatJids: string[];
      phones: string[];
    };

    const [lastMessages, photos] = await Promise.all([
      chatJids?.length > 0
        ? fetchLastMessages(chatJids).catch(() => ({}))
        : Promise.resolve({}),
      phones?.length > 0
        ? fetchPhotos(phones).catch(() => ({}))
        : Promise.resolve({}),
    ]);

    return NextResponse.json({ lastMessages, photos });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
