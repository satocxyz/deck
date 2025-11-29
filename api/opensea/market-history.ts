// api/opensea/market-history.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const SUPPORTED_CHAINS = ["base", "ethereum", "arbitrum", "optimism"] as const;

const querySchema = z.object({
  chain: z.enum(SUPPORTED_CHAINS),
  contract: z.string().optional(),
  collection: z.string().optional(),
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(5).max(90))
    .optional(),
});

type MarketPoint = {
  timestamp: number;
  priceEth: number;
  source: "floor" | "offer" | "sale" | "other";
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const parse = querySchema.safeParse(req.query);
  if (!parse.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid query params",
      details: parse.error.flatten(),
    });
  }

  const { chain, contract, collection } = parse.data;
  const limit = parse.data.limit ?? 60;

  if (!contract && !collection) {
    return res.status(400).json({
      ok: false,
      error: "Provide at least contract or collection",
    });
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  const baseUrl =
    process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

  if (!apiKey) {
    console.error("Missing OPENSEA_API_KEY");
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  try {
    // We use the OpenSea "events" endpoint for recent sales.
    const url = new URL(`${baseUrl}/events`);
    url.searchParams.set("chain", chain);
    url.searchParams.set("event_type", "sale");
    url.searchParams.set("limit", String(limit));

    // Either filter by collection slug or by contract address (or both)
    if (collection) {
      url.searchParams.set("collection_slug", collection);
    }
    if (contract) {
      url.searchParams.set("asset_contract_address", contract);
    }

    const osRes = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
    });

    if (!osRes.ok) {
      const text = await osRes.text();
      console.error(
        "OpenSea market-history error",
        osRes.status,
        text || "(empty body)",
      );
      return res.status(502).json({
        ok: false,
        error: "Failed to fetch events from OpenSea",
      });
    }

    const json = (await osRes.json()) as any;

    const rawEvents: any[] = Array.isArray(json?.asset_events)
      ? json.asset_events
      : Array.isArray(json?.events)
      ? json.events
      : Array.isArray(json)
      ? json
      : [];

    const points: MarketPoint[] = [];

    for (const ev of rawEvents) {
      const p = normalizeEventToMarketPoint(ev);
      if (p) points.push(p);
    }

    // sort by timestamp ascending just in case
    points.sort((a, b) => a.timestamp - b.timestamp);

    return res.status(200).json({
      ok: true,
      points,
    });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/market-history", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

/**
 * Try to normalize a generic OpenSea sale event into a MarketPoint.
 * We keep this very defensive: if we can't confidently get a timestamp
 * AND a positive price in ETH, we just return null.
 */
function normalizeEventToMarketPoint(ev: any): MarketPoint | null {
  if (!ev || typeof ev !== "object") return null;

  // ----- timestamp -----
  let tsSec: number | null = null;

  // Common fields in OpenSea events
  const tsStr: string | undefined =
    ev.event_timestamp ||
    ev.occurred_at ||
    ev.created_date ||
    ev.timestamp;

  if (typeof tsStr === "string") {
    const t = Date.parse(tsStr);
    if (!Number.isNaN(t) && t > 0) {
      tsSec = Math.floor(t / 1000);
    }
  }

  if (!tsSec) return null;

  // ----- price (ETH) -----
  let priceEth: number | null = null;

  // V2 often has an object with value/decimals similar to orders
  const priceObj = (ev.price ?? ev.total_price ?? null) as any;

  if (priceObj && typeof priceObj === "object") {
    const valueStr = priceObj.value ?? priceObj.amount ?? priceObj.quantity;
    const decimals = priceObj.decimals ?? 18;

    if (typeof valueStr === "string" && typeof decimals === "number") {
      const total = Number(valueStr);
      if (!Number.isNaN(total) && total > 0) {
        priceEth = total / 10 ** decimals;
      }
    }
  }

  // fallback: quantity * payment_token.eth_price
  if (
    (priceEth == null || priceEth <= 0) &&
    ev.payment_token &&
    typeof ev.payment_token.eth_price === "string"
  ) {
    const ethPrice = Number(ev.payment_token.eth_price);
    const quantityStr: string | undefined =
      ev.quantity || ev.asset_quantity || ev.total_quantity;
    const qty = quantityStr ? Number(quantityStr) : 1;

    if (!Number.isNaN(ethPrice) && ethPrice > 0 && !Number.isNaN(qty)) {
      priceEth = ethPrice * qty;
    }
  }

  // last fallback: treat numeric price/total_price as wei or ETH
  if (
    (priceEth == null || priceEth <= 0) &&
    (typeof ev.total_price === "string" || typeof ev.total_price === "number")
  ) {
    const n = Number(ev.total_price);
    if (!Number.isNaN(n) && n > 0) {
      priceEth = n > 1e10 ? n / 1e18 : n;
    }
  }

  if (priceEth == null || priceEth <= 0) return null;

  return {
    timestamp: tsSec,
    priceEth,
    source: "sale",
  };
}
