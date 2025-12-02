// api/opensea/collection-fees.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, message: "Use GET" });
  }

  const { slug } = req.query;
  if (!slug || typeof slug !== "string") {
    return res.status(400).json({ ok: false, message: "Missing ?slug" });
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: "Missing OPENSEA_API_KEY" });
  }

  const url = `https://api.opensea.io/api/v2/collections/${encodeURIComponent(
    slug,
  )}`;

  const osRes = await fetch(url, {
    headers: { "X-API-KEY": apiKey },
  });

  const json = await osRes.json().catch(() => ({}));

  if (!osRes.ok) {
    console.error("[collection-fees] error", osRes.status, json);
    return res.status(osRes.status).json({
      ok: false,
      message: json?.message || `OpenSea returned ${osRes.status}`,
      raw: json,
    });
  }

  const fees = Array.isArray((json as any).fees) ? (json as any).fees : [];

  // Normalise to basis points
  const normalized = fees
    .filter((f: any) => f && typeof f.recipient === "string")
    .map((f: any) => {
      // docs show "fee": 2.5 meaning 2.5%, i.e. 250 bps
      const percent = Number(f.fee) || 0;
      const bps = Math.round(percent * 100); // 2.5 => 250
      return {
        kind: f.type ?? "unknown",
        recipient: f.recipient as `0x${string}`,
        bps, // basis points
        required: Boolean(f.required),
      };
    });

  return res.status(200).json({
    ok: true,
    collection: json,
    fees: normalized,
  });
}
