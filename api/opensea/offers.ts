// api/opensea/offers.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type SimpleOffer = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  maker: string | null;
  expirationTime: number | null;
  source: "nft";
};

type FloorInfo = {
  eth: number | null;
  formatted: string | null;
};

// --------- helper: robust quantity detection ----------
function detectQuantity(raw: any): number {
  // The order quantity can appear in many locations
  const candidates = [
    raw.remaining_quantity,
    raw.quantity_remaining,
    raw.quantity,
    raw.protocol_data?.parameters?.offer?.length,
    raw.taker_asset_bundle?.items?.length,
    raw.maker_asset_bundle?.items?.length,
  ];

  for (const q of candidates) {
    if (typeof q === "number" && q > 0 && q < 9999) {
      return q;
    }
  }

  // fallback: assume single NFT
  return 1;
}

// --------- helper: detect price (value + decimals) ----------
function detectPrice(raw: any): { eth: number | null } {
  let value: string | number | undefined = undefined;
  let decimals: number | undefined = undefined;

  const p = raw.price ?? raw.current_price;

  if (!p) return { eth: null };

  if (typeof p === "object") {
    value = p.value;
    decimals = p.decimals;
  } else if (typeof p === "string" || typeof p === "number") {
    value = p;
    decimals = 18; // best guess
  }

  if (value == null || decimals == null) return { eth: null };

  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { eth: null };

  return { eth: n / 10 ** decimals };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const chain = req.query.chain as string | undefined;
  const collectionSlug = req.query.collection as string | undefined;
  const identifier = req.query.identifier as string | undefined;

  if (!chain || (chain !== "base" && chain !== "ethereum")) {
    return res.status(400).json({
      error: "Invalid or missing chain. Expected 'base' or 'ethereum'.",
    });
  }

  if (!collectionSlug) {
    return res.status(400).json({ error: "Missing collection slug" });
  }

  if (!identifier) {
    return res.status(400).json({ error: "Missing token identifier" });
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  const baseUrl =
    process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

  if (!apiKey) {
    console.error("Missing OPENSEA_API_KEY");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  let bestOffer: SimpleOffer | null = null;
  let floor: FloorInfo = { eth: null, formatted: null };

  try {
    // ---------- 1) Floor price ----------
    const statsUrl = `${baseUrl}/collections/${collectionSlug}/stats`;
    const statsRes = await fetch(statsUrl, {
      headers: { Accept: "application/json", "X-API-KEY": apiKey },
    });

    if (statsRes.ok) {
      const statsJson = await statsRes.json();
      const total = statsJson.total ?? {};
      const floorRaw = total["floor_price"];
      if (typeof floorRaw === "number") {
        floor.eth = floorRaw;
        floor.formatted =
          floorRaw >= 1 ? floorRaw.toFixed(3) : floorRaw.toFixed(4);
      }
    }

    // ---------- 2) Best offer ----------
    const bestOfferUrl = `${baseUrl}/offers/collection/${collectionSlug}/nfts/${identifier}/best`;
    const bestRes = await fetch(bestOfferUrl, {
      headers: { Accept: "application/json", "X-API-KEY": apiKey },
    });

    if (bestRes.ok) {
      const json = await bestRes.json();
      const rawOffer = json.best_offer ?? json.best ?? json.offer ?? json;

      if (rawOffer && typeof rawOffer === "object") {
        const priceInfo = detectPrice(rawOffer);
        if (!priceInfo.eth) {
          return res.status(200).json({ bestOffer: null, floor });
        }

        const quantity = detectQuantity(rawOffer);
        const perItemEth = priceInfo.eth / quantity;

        const priceFormatted =
          perItemEth >= 1 ? perItemEth.toFixed(3) : perItemEth.toFixed(4);

        const maker =
          rawOffer.maker?.address ??
          rawOffer.maker_address ??
          rawOffer.maker ??
          rawOffer.protocol_data?.parameters?.offerer ??
          null;

        let expirationTime: number | null = null;
        const endTime = rawOffer.protocol_data?.parameters?.endTime;
        if (typeof endTime === "string") {
          const n = Number(endTime);
          if (n > 0) expirationTime = n;
        } else if (typeof rawOffer.expiration_time === "number") {
          expirationTime = rawOffer.expiration_time;
        }

        const id =
          rawOffer.order_hash ??
          rawOffer.id ??
          rawOffer.hash ??
          `${maker ?? "unknown"}-${priceFormatted}`;

        bestOffer = {
          id,
          priceEth: perItemEth,
          priceFormatted,
          maker,
          expirationTime,
          source: "nft",
        };
      }
    }

    return res.status(200).json({ bestOffer, floor });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/offers", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
