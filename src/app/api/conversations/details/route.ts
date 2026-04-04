import { NextRequest, NextResponse } from "next/server";
import { fetchLastMessages, fetchPhotos, fetchContactNames } from "@/lib/wacli-api";

// Fetches details (last messages + photos + contact names) for a small batch of chats
export async function POST(request: NextRequest) {
  try {
    const { chatJids, phones } = await request.json() as {
      chatJids: string[];
      phones: string[];
    };

    const [lastMessages, photos, contacts] = await Promise.all([
      chatJids?.length > 0
        ? fetchLastMessages(chatJids).catch(() => ({}))
        : Promise.resolve({}),
      phones?.length > 0
        ? fetchPhotos(phones).catch(() => ({}))
        : Promise.resolve({}),
      chatJids?.length > 0
        ? fetchContactNames(chatJids).catch(() => ({}))
        : Promise.resolve({}),
    ]);

    return NextResponse.json({ lastMessages, photos, contacts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
