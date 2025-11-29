// api/opensea/market-history.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type MarketPoint = {
  timestamp: number;
  priceEth: number;
  source: "sale";
};

const SUPPORTED_CHAINS = ["base", "ethereum", "arbitrum", "optimism"];

// Helper to safely parse sale price (in ETH/WETH) from an OpenSea v2 event
function parseSalePriceEth(event: any): number | null {
  if (!event || typeof event !== "object") return null;

  // In v2 events, there is often a `price` object or `payment` object
  const priceObj = (event.price ?? event.payment ?? null) as any;

  if (priceObj && typeof priceObj === "object") {
    const valueStr = priceObj.value ?? priceObj.quantity ?? priceObj.amount;
    const decimals = priceObj.decimals ?? 18;

    if (typeof valueStr === "string" || typeof valueStr === "number") {
      const n = Number(valueStr);
      if (!Number.isNaN(n) && n > 0) {
        return n / 10 ** decimals;
      }
    }
  }

  // Fallback: sometimes nested on transaction / consideration?
  const tx = event.transaction;
  if (tx && typeof tx === "object") {
    const totalStr = tx.total_price ?? tx.price;
    const decimals = tx.decimals ?? 18;
    if (typeof totalStr === "string" || typeof totalStr === "number") {
      const n = Number(totalStr);
      if (!Number.isNaN(n) && n > 0) {
        return n / 10 ** decimals;
      }
    }
  }

  return null;
}

// Helper to parse event timestamp (seconds)
function parseEventTimestampSec(event: any): number | null {
  if (!event || typeof event !== "object") return null;

  // v2 events usually have `event_timestamp` or `occurred_at`
  const tsStr =
    event.event_timestamp ??
    event.occurred_at ??
    event.created_date ??
    event.timestamp;

  if (typeof tsStr === "string") {
    const ms = Date.parse(tsStr);
    if (!Number.isNaN(ms)) {
      return Math.floor(ms / 1000);
    }
  }

  // Some events may already have a numeric timestamp
  if (typeof event.timestamp === "number" && event.timestamp > 0) {
    return event.timestamp;
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const chain = req.query.chain as string | undefined;
  const collectionSlug = req.query.collection as string | undefined;
  const contract = req.query.contract as string | undefined;
  const limitRaw = req.query.limit as string | undefined;

  if (!chain || !SUPPORTED_CHAINS.includes(chain)) {
    return res.status(400).json({
      ok: false,
      error:
        "Invalid or missing chain. Expected one of: base, ethereum, arbitrum, optimism.",
    });
  }

  if (!collectionSlug && !contract) {
    return res.status(400).json({
      ok: false,
      error: "Provide at least one of: collection (slug) or contract address.",
    });
  }

  let limit = 100;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (!Number.isNaN(n) && n > 0) {
      limit = Math.min(Math.max(1, Math.floor(n)), 200);
    }
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  const baseUrl =
    process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

  if (!apiKey) {
    console.error("Missing OPENSEA_API_KEY");
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const points: MarketPoint[] = [];

  try {
    let cursor: string | null = null;
    let safetyPages = 0;

    // We loop pages until we gather `limit` valid sale points
    while (points.length < limit && safetyPages < 15) {
      safetyPages += 1;

      const search = new URLSearchParams({
        chain,
        event_type: "sale",
      });

      if (collectionSlug) {
        search.set("collection_slug", collectionSlug);
      }
      if (contract) {
        search.set("asset_contract_address", contract);
      }
      if (cursor) {
        search.set("cursor", cursor);
      }

      const url = `${baseUrl}/events?${search.toString()}`;

      const resp = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-API-KEY": apiKey,
        },
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error(
          "OpenSea market-history events error",
          resp.status,
          text || "(empty body)",
        );
        break;
      }

      const json = (await resp.json()) as any;

      const events: any[] = Array.isArray(json.events)
        ? json.events
        : Array.isArray(json.asset_events)
        ? json.asset_events
        : [];

      for (const ev of events) {
        const ts = parseEventTimestampSec(ev);
        const priceEth = parseSalePriceEth(ev);

        if (
          ts &&
          ts > 0 &&
          typeof priceEth === "number" &&
          Number.isFinite(priceEth) &&
          priceEth > 0
        ) {
          points.push({
            timestamp: ts,
            priceEth,
            source: "sale",
          });

          if (points.length >= limit) break;
        }
      }

      // pagination
      cursor = (json.next ?? json.next_page ?? json.cursor) || null;
      if (!cursor || events.length === 0) break;
    }

    // sort ascending by timestamp
    points.sort((a, b) => a.timestamp - b.timestamp);

    return res.status(200).json({
      ok: true,
      points,
      count: points.length,
      source: "opensea_events_sale",
    });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/market-history", err);
    return res
      .status(500)
      .json({ ok: false, error: "Internal server error" });
  }
}
