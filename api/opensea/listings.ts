// api/opensea/listings.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const querySchema = z.object({
  // we still accept chain for consistency, but OpenSea endpoint doesn't use it
  chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
  collection: z.string().min(1, "Missing collection slug"),
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(20))
    .optional(),
});

type OpenSeaOrder = {
  order_hash?: string;
  current_price?: string;
  price?: {
    current?: {
      value?: string;
      decimals?: number;
      currency?: string;
    };
  };
  expiration_time?: number;
  closing_date?: string | null;
  maker?: {
    address?: string | null;
  };
  protocol_address?: string | null;
};

function extractEthPrice(order: OpenSeaOrder): number | null {
  // Preferred: price.current.value + decimals (new v2 shape)
  const val = order.price?.current?.value;
  const decimals = order.price?.current?.decimals;

  if (val && decimals != null) {
    try {
      const bn = BigInt(val);
      const denom = 10n ** BigInt(decimals);
      const asNumber = Number(bn) / Number(denom);
      return asNumber;
    } catch {
      // fall through to current_price
    }
  }

  // Fallback: current_price (wei)
  if (order.current_price) {
    try {
      const wei = BigInt(order.current_price);
      const asNumber = Number(wei) / 1e18;
      return asNumber;
    } catch {
      return null;
    }
  }

  return null;
}

function extractExpiration(order: OpenSeaOrder): number | null {
  if (typeof order.expiration_time === "number") {
    return order.expiration_time;
  }
  if (order.closing_date) {
    const ts = Date.parse(order.closing_date);
    if (!Number.isNaN(ts)) {
      return Math.floor(ts / 1000);
    }
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

  const { collection } = parse.data;
  const limit = parse.data.limit ?? 3;

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      message: "Missing OPENSEA_API_KEY environment variable",
    });
  }

  // Get best listings by collection:
  // GET https://api.opensea.io/api/v2/listings/collection/{slug}/best
  const baseUrl = `https://api.opensea.io/api/v2/listings/collection/${encodeURIComponent(
    collection,
  )}/best`;

  const url = `${baseUrl}?limit=${encodeURIComponent(String(limit))}`;

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

    // Different OpenSea endpoints sometimes use different root keys,
    // so we defensively try several common ones.
    const rawOrders: OpenSeaOrder[] =
      json.listings ??
      json.orders ??
      json.results ??
      json.body?.listings ??
      json.body?.orders ??
      [];

    const listings = rawOrders
      .map((order) => {
        const priceEth = extractEthPrice(order);
        if (priceEth == null || priceEth <= 0) return null;

        const expirationTime = extractExpiration(order);
        const maker =
          order.maker?.address ?? (order as any)["maker address"] ?? null;
        const protocolAddress =
          order.protocol_address ?? (order as any).protocol_address ?? null;

        const priceFormatted =
          priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4);

        return {
          id: order.order_hash || "",
          priceEth,
          priceFormatted,
          maker,
          expirationTime,
          protocolAddress,
        };
      })
      .filter(Boolean)
      .slice(0, limit);

    return res.status(200).json({
      ok: true,
      listings,
    });
  } catch (err) {
    console.error("Unexpected error fetching listings", err);
    return res.status(500).json({
      ok: false,
      message: "Unexpected error while fetching listings",
    });
  }
}
