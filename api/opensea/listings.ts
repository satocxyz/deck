// api/opensea/listings.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const querySchema = z.object({
  chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
  collection: z.string().min(1),
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(20))
    .optional(),
});

const chainSlug: Record<string, string> = {
  base: "base",
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  optimism: "optimism",
};

function extractEthPrice(order: any): number | null {
  const val = order.price?.current?.value;
  const decimals = order.price?.current?.decimals;

  if (val && decimals != null) {
    try {
      const bn = BigInt(val);
      const denom = 10n ** BigInt(decimals);
      return Number(bn) / Number(denom);
    } catch {
      return null;
    }
  }

  return null;
}

function extractExpiration(order: any): number | null {
  const endTime = order.protocol_data?.parameters?.endTime;
  if (endTime) {
    const n = Number(endTime);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  const parse = querySchema.safeParse(req.query);
  if (!parse.success) {
    return res.status(400).json({
      ok: false,
      message: "Invalid query params",
      issues: parse.error.issues,
    });
  }

  const { chain, collection } = parse.data;
  const limit = parse.data.limit ?? 3;

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      message: "Missing OPENSEA_API_KEY",
    });
  }

  const chainParam = chainSlug[chain];

  const url = `https://api.opensea.io/api/v2/listings/collection/${collection}?limit=${limit}&chain=${chainParam}&sort=PRICE&order=ASC`;

  try {
    const resp = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
      },
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("OpenSea listings error", resp.status, txt);
      return res.status(502).json({
        ok: false,
        message: "Failed to fetch best listings",
        status: resp.status,
      });
    }

    const json = await resp.json();
    const rows: any[] = json.listings ?? [];

    // Enrich each listing with metadata
    const enriched = await Promise.all(
      rows.slice(0, limit).map(async (order) => {
        const parameters = order.protocol_data?.parameters;
        const offer = parameters?.offer?.[0];
        const maker = parameters?.offerer ?? null;

        const tokenId = offer?.identifierOrCriteria ?? null;
        const contract = offer?.token ?? null;

        let name: string | null = null;
        let imageUrl: string | null = null;

        if (tokenId && contract) {
          try {
            const metaRes = await fetch(
              `${process.env.VERCEL_URL}/api/opensea/nft-details?chain=${chain}&contract=${contract}&identifier=${tokenId}`,
            );

            if (metaRes.ok) {
              const meta = await metaRes.json();
              name = meta.name ?? null;
              imageUrl = meta.image_url ?? meta.image ?? null;
            }
          } catch (err) {
            console.error("Metadata fetch failed", err);
          }
        }

        const priceEth = extractEthPrice(order);
        const expiration = extractExpiration(order);

        return {
          id: order.order_hash,
          priceEth,
          priceFormatted:
            priceEth != null
              ? priceEth >= 1
                ? priceEth.toFixed(3)
                : priceEth.toFixed(4)
              : "0",
          maker,
          expirationTime: expiration,
          protocolAddress: order.protocol_address ?? null,
          tokenId,
          name,
          imageUrl,
        };
      }),
    );

    return res.status(200).json({
      ok: true,
      listings: enriched.filter((x) => x != null),
    });
  } catch (err) {
    console.error("Unexpected error", err);
    return res.status(500).json({
      ok: false,
      message: "Unexpected error while fetching best listings",
    });
  }
}
