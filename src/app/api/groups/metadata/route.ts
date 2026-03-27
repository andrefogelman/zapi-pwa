import { NextRequest, NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";

export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json({ error: "phone param required" }, { status: 400 });
  }

  try {
    const config = await getZapiConfig();
    const baseUrl = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.client_token) {
      headers["Client-Token"] = config.client_token;
    }

    const res = await fetch(`${baseUrl}/group-metadata/${phone}`, { headers });
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch metadata" }, { status: 500 });
    }

    const meta = await res.json();

    const groupId = phone.endsWith("-group")
      ? phone.replace("-group", "@g.us")
      : `${phone}@g.us`;

    return NextResponse.json({
      group_id: groupId,
      subject: meta.subject || "",
      subject_owner: meta.subjectOwner ? `${meta.subjectOwner}@s.whatsapp.net` : "",
      group_lid: meta.lid || "",
    });
  } catch (error) {
    console.error("Group metadata error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
