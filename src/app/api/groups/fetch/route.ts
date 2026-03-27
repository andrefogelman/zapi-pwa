import { NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";

interface ZapiGroup {
  phone: string;
  name: string;
}

interface ZapiGroupMetadata {
  phone: string;
  subject: string;
  subjectOwner: string;
  lid?: string;
  creation?: number;
  participants?: Array<{ phone: string; admin?: boolean }>;
}

export async function GET() {
  try {
    const config = await getZapiConfig();
    const baseUrl = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.client_token) {
      headers["Client-Token"] = config.client_token;
    }

    // 1. List all groups
    const groupsRes = await fetch(`${baseUrl}/groups`, { headers });
    if (!groupsRes.ok) {
      return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
    }
    const groups: ZapiGroup[] = await groupsRes.json();

    // 2. Get metadata for each group (with details like subjectOwner, lid)
    const results = await Promise.allSettled(
      groups.map(async (g) => {
        const metaRes = await fetch(`${baseUrl}/group-metadata/${g.phone}`, { headers });
        if (!metaRes.ok) return { phone: g.phone, subject: g.name, subjectOwner: "", lid: "" };
        const meta: ZapiGroupMetadata = await metaRes.json();
        // Convert phone format: "120363419888732115-group" → "120363419888732115@g.us"
        const groupId = g.phone.replace("-group", "@g.us").replace(/^(\d+)-(\d+)$/, "$1-$2@g.us");
        return {
          group_id: groupId,
          subject: meta.subject || g.name,
          subject_owner: meta.subjectOwner ? `${meta.subjectOwner}@s.whatsapp.net` : "",
          group_lid: meta.lid || "",
        };
      })
    );

    const fetched = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    return NextResponse.json({ groups: fetched });
  } catch (error) {
    console.error("Groups fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
  }
}
