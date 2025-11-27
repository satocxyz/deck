// api/opensea/listings.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const querySchema = z.object({
  chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
  collection: z.string().min(1, "Missing collection slug"),
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

type OpenSeaBestListing = {
  order_hash?: string;
  chain?: string;
  protocol_data?: {
    parameters?: {
      offerer?: string;
      offer?: {
        itemType?: number;
        token?: string;
        identifierOrCriteria?: string;
        startAmount?: string;
        endAmount?: string;
      }[];
      consideration?: unknown[];
      startTime?: string;
      endTime?: string; // unix seconds as string
      orderType?: number;
      zone?: string;
      zoneHash?: string;
      salt?: string;
      conduitKey?: string;
      totalOriginalConsiderationItems?: number;
      counter?: number;
    };
    signature?: string | null;
  };
  protocol_address?: string | null;
  remaining_quantity?: number;
  price?: {
    current?: {
      currency?: string;
      decimals?: number;
      value?: string;
    };
  };
  status?: string;
};

function extractEthPrice(order: OpenSeaBestListing): number | null {
  const val = order.price?.current?.value;
  const decimals = order.price?.current?.decimals;

  if (val && decimals != null) {
    try {
      const bn = BigInt(val);
      const denom = 10n ** BigInt(decimals);
      const asNumber = Number(bn) / Number(denom);
      if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
      return asNumber;
    } catch {
      return null;
    }
  }

  return null;
}

function extractExpiration(order: OpenSeaBestListing): number | null {
  const endTime = order.protocol_data?.parameters?.endTime;
  if (!endTime) return null;

  const n = Number(endTime);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
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
      message: "Missing OPENSEA_API_KEY environment variable",
    });
  }

  const chainParam = chainSlug[chain];

  const searchParams = new URLSearchParams({
    limit: String(limit),
    chain: chainParam,
  });

  const url = `https://api.opensea.io/api/v2/listings/collection/${encodeURIComponent(
    collection,
  )}/best?${searchParams.toString()}`;

  try {
    const resp = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error("OpenSea best listings error", resp.status, text);
      return res.status(502).json({
        ok: false,
        message: "Failed to fetch listings from OpenSea",
        statusCode: resp.status,
      });
    }

    const json: any = await resp.json();
    const rawListings: OpenSeaBestListing[] =
      json.listings ?? json.body?.listings ?? [];

    const listings = rawListings
      .map((order) => {
        const priceEth = extractEthPrice(order);
        if (priceEth == null || priceEth <= 0) return null;

        const expirationTime = extractExpiration(order);
        const maker =
          order.protocol_data?.parameters?.offerer ??
          (order as any)["maker address"] ??
          null;

        const protocolAddress =
          order.protocol_address ?? (order as any).protocol_address ?? null;

        // Try to extract the NFT contract + token id from the first offer item
        const offerItem = order.protocol_data?.parameters?.offer?.[0];
        const tokenContract = offerItem?.token ?? null;
        const tokenId = offerItem?.identifierOrCriteria ?? null;

        const priceFormatted =
          priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4);

        return {
          id: order.order_hash || "",
          priceEth,
          priceFormatted,
          maker,
          expirationTime,
          protocolAddress,
          tokenContract,
          tokenId,
        };
      })
      .filter(Boolean)
      .slice(0, limit);

    return res.status(200).json({
      ok: true,
      listings,
    });
  } catch (err) {
    console.error("Unexpected error fetching best listings", err);
    return res.status(500).json({
      ok: false,
      message: "Unexpected error while fetching listings",
    });
  }
}
