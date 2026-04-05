import { NextRequest, NextResponse } from "next/server";
import { getZapiBase } from "@/lib/zapi";

export async function POST(request: NextRequest) {
  try {
    const { recipient, contentType, content, mediaUrl, mediaFilename, messageId } = await request.json();
    if (!recipient) {
      return NextResponse.json({ error: "recipient and content required" }, { status: 400 });
    }

    const { baseUrl, headers } = await getZapiBase();

    let endpoint: string;
    let body: Record<string, unknown>;

    switch (contentType) {
      case "image":
        endpoint = "/send-image";
        body = { phone: recipient, image: mediaUrl, caption: content };
        break;
      case "document": {
        const ext = (mediaFilename || "file").split(".").pop() || "pdf";
        endpoint = `/send-document/${ext}`;
        body = { phone: recipient, document: mediaUrl, fileName: mediaFilename, caption: content };
        break;
      }
      case "audio":
        endpoint = "/send-audio";
        body = { phone: recipient, audio: mediaUrl };
        break;
      case "video":
        endpoint = "/send-video";
        body = { phone: recipient, video: mediaUrl, caption: content };
        break;
      default:
        endpoint = "/send-text";
        body = { phone: recipient, message: content };
    }

    if (messageId) body.messageId = messageId;

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const result = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: result.error || "send failed" }, { status: 500 });
    }

    return NextResponse.json({ status: "sent", messageId: result.messageId || result.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
