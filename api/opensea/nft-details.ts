// api/opensea/nft-details.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Returns normalized traits for a single NFT using OpenSea v2 "Get NFT" endpoint.
 * GET /api/opensea/nft-details?chain=base&contract=0x...&identifier=4474
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  const baseUrl = process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "Server misconfigured: OpenSea API key missing" });
  }

  const chain = (req.query.chain as string | undefined) ?? "base";
  const contract = req.query.contract as string | undefined;
  const identifier = req.query.identifier as string | undefined;

  if (chain !== "base" && chain !== "ethereum") {
    return res
      .status(400)
      .json({ error: "Invalid chain. Expected 'base' or 'ethereum'." });
  }

  if (!contract) {
    return res.status(400).json({ error: "Missing contract address" });
  }

  if (!identifier) {
    return res.status(400).json({ error: "Missing token identifier" });
  }

  try {
    // OpenSea v2 "Get NFT" endpoint
    const url = `${baseUrl}/chain/${chain}/contract/${contract}/nfts/${identifier}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("OpenSea nft-details error", response.status, text);
      return res
        .status(502)
        .json({ error: "Failed to fetch NFT details from OpenSea" });
    }

    const json = await response.json();
    // Some OpenSea responses wrap NFT inside "nft", some don't.
    const raw: any = (json as any).nft ?? json;

    const traits: any[] = [];

    // 1) top-level traits (if present)
    if (Array.isArray(raw.traits)) {
      traits.push(...raw.traits);
    }

    // 2) metadata.traits / metadata.attributes (if present)
    const metadata = raw.metadata;
    if (metadata) {
      if (Array.isArray(metadata.traits)) {
        traits.push(...metadata.traits);
      }
      if (Array.isArray(metadata.attributes)) {
        traits.push(...metadata.attributes);
      }
    }

    type NormalizedTrait = { label: string; value: string };

    const normalized: NormalizedTrait[] = traits
      .map((t: any, idx: number) => {
        const rawType =
          t.trait_type ??
          t.type ??
          t.trait ??
          `Trait ${idx + 1}`;
        const rawValue = t.value ?? "";

        const label = String(rawType)
          .replace(/[_-]+/g, " ")
          .trim()
          .replace(/\b\w/g, (c: string) => c.toUpperCase());

        const value = String(rawValue).trim();
        if (!value) return null;

        return { label, value };
      })
      .filter((t): t is NormalizedTrait => t !== null);

    // Deduplicate & limit
    const seen = new Set<string>();
    const result: NormalizedTrait[] = [];
    for (const t of normalized) {
      const key = `${t.label}:${t.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(t);
      if (result.length >= 12) break;
    }

    return res.status(200).json({ traits: result });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/nft-details", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
