import { NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";

interface ZapiGroup {
  phone: string;
  name: string;
  isGroup?: boolean;
}

export async function GET() {
  try {
    const config = await getZapiConfig();
    const baseUrl = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.client_token) {
      headers["Client-Token"] = config.client_token;
    }

    // List all groups with pagination
    const groupsRes = await fetch(`${baseUrl}/groups?page=1&pageSize=500`, { headers });
    if (!groupsRes.ok) {
      return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
    }
    const groups: ZapiGroup[] = await groupsRes.json();

    // Convert phone format and return basic info (fast, no metadata calls)
    const results = groups.map((g) => {
      // "120363419888732115-group" → "120363419888732115@g.us"
      // "5511993604399-1407165018" → "5511993604399-1407165018@g.us"
      const groupId = g.phone.endsWith("-group")
        ? g.phone.replace("-group", "@g.us")
        : `${g.phone}@g.us`;

      return {
        group_id: groupId,
        subject: g.name,
        subject_owner: "",
        group_lid: "",
        _phone: g.phone, // keep original for metadata lookup
      };
    });

    return NextResponse.json({ groups: results });
  } catch (error) {
    console.error("Groups fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
  }
}
