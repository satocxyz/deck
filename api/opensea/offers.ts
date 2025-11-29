// api/opensea/offers.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type SimpleOffer = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  maker: string | null;
  expirationTime: number | null;
  protocolAddress: string | null;
  source: "nft";
};

type FloorInfo = {
  eth: number | null;
  formatted: string | null;
};

const SUPPORTED_CHAINS = ["base", "ethereum", "arbitrum", "optimism"];

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const chain = req.query.chain as string | undefined;
  const collectionSlug = req.query.collection as string | undefined;
  const identifier = req.query.identifier as string | undefined;

  if (!chain || !SUPPORTED_CHAINS.includes(chain)) {
    return res.status(400).json({
      error:
        "Invalid or missing chain. Expected one of: base, ethereum, arbitrum, optimism.",
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
  let topOffers: SimpleOffer[] = [];

  try {
    // -------------------------------------------------
    // 1) COLLECTION FLOOR PRICE
    // -------------------------------------------------
    const statsUrl = `${baseUrl}/collections/${collectionSlug}/stats`;
    const statsRes = await fetch(statsUrl, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
    });

    if (statsRes.ok) {
      const statsJson = (await statsRes.json()) as {
        total?: Record<string, unknown>;
      };

      const total = (statsJson.total ?? {}) as Record<string, unknown>;
      const floorRaw = total["floor_price"];

      if (typeof floorRaw === "number") {
        floor.eth = floorRaw;
        floor.formatted =
          floorRaw >= 1 ? floorRaw.toFixed(3) : floorRaw.toFixed(4);
      }
    }

    // -------------------------------------------------
    // 2) ALL OFFERS FOR THIS NFT -> FILTER LIVE + CORRECT TOKEN -> TOP 3
    // -------------------------------------------------
    const search = new URLSearchParams({ chain });
    const offersUrl = `${baseUrl}/offers/collection/${encodeURIComponent(
      collectionSlug,
    )}/nfts/${encodeURIComponent(identifier)}?${search.toString()}`;

    const offersRes = await fetch(offersUrl, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
    });

    if (offersRes.ok) {
      const offersJson = (await offersRes.json()) as any;

      const rawOffers: any[] = Array.isArray(offersJson?.offers)
        ? offersJson.offers
        : Array.isArray(offersJson?.orders)
        ? offersJson.orders
        : Array.isArray(offersJson)
        ? offersJson
        : [];

      const nowSec = Math.floor(Date.now() / 1000);
      const identifierStr = String(identifier);

      const filteredRaw = rawOffers.filter((raw) => {
        if (!raw || typeof raw !== "object") return false;

        // status: only ACTIVE
        const status: string | undefined =
          raw.status || raw.order_status || raw.orderStatus;
        if (status && status.toLowerCase() !== "active") return false;

        // quantity: must have something remaining
        const remaining: number | undefined =
          typeof raw.remaining_quantity === "number"
            ? raw.remaining_quantity
            : typeof raw.remaining === "number"
            ? raw.remaining
            : typeof raw.available_quantity === "number"
            ? raw.available_quantity
            : undefined;

        if (typeof remaining === "number" && remaining <= 0) return false;

        // expiration time: ignore if already expired
        const endTimeStr: string | undefined =
          raw.protocol_data?.parameters?.endTime;
        if (endTimeStr) {
          const n = Number(endTimeStr);
          if (Number.isFinite(n) && n > 0 && n <= nowSec) return false;
        }

        const expiresAt: number | undefined =
          typeof raw.expires_at === "number"
            ? raw.expires_at
            : typeof raw.expiration_time === "number"
            ? raw.expiration_time
            : undefined;

        if (typeof expiresAt === "number" && expiresAt <= nowSec) {
          return false;
        }

        // startTime: ignore offers that haven't started yet
        const startTimeStr: string | undefined =
          raw.protocol_data?.parameters?.startTime;

        if (startTimeStr) {
          const start = Number(startTimeStr);
          if (Number.isFinite(start) && start > nowSec) {
            return false;
          }
        }

        // tokenId targeting: ignore offers that are for a different NFT,
        // except for true collection-wide criteria offers.
        const criteria = raw.criteria;
        const isCollectionWide =
          criteria &&
          typeof criteria === "object" &&
          criteria.encoded_token_ids === "*";

        if (!isCollectionWide) {
          const consideration = raw.protocol_data?.parameters?.consideration;
          if (Array.isArray(consideration)) {
            const nftLeg = consideration.find(
              (c: any) =>
                c &&
                typeof c === "object" &&
                (c.itemType === 2 || c.itemType === 3 || c.itemType === 4),
            );

            const legId =
              nftLeg?.identifierOrCriteria != null
                ? String(nftLeg.identifierOrCriteria)
                : null;

            if (legId && legId !== identifierStr) {
              // Offer is active but for another token id in the collection → hide it
              return false;
            }
          }
        }

        return true;
      });

      const parsed: SimpleOffer[] = [];

      for (const rawOffer of filteredRaw) {
        const parsedOffer = normalizeOffer(rawOffer);
        if (parsedOffer) parsed.push(parsedOffer);
      }

      // Highest WETH offer first (bestOffer[0] is what we use for "Accept best offer")
      parsed.sort((a, b) => b.priceEth - a.priceEth);

      bestOffer = parsed[0] ?? null;
      topOffers = parsed.slice(0, 3);
    } else {
      const text = await offersRes.text();
      console.error(
        "OpenSea offers error",
        offersRes.status,
        text || "(empty body)",
      );
    }

    return res.status(200).json({
      bestOffer,
      floor,
      offers: topOffers,
    });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/offers", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Normalize one raw OpenSea offer into SimpleOffer
 */
function normalizeOffer(rawOffer: any): SimpleOffer | null {
  if (!rawOffer || typeof rawOffer !== "object") return null;

  // -----------------------------
  // Price parsing
  // -----------------------------
  let priceEth: number | null = null;

  const priceObj = (rawOffer.price ?? rawOffer.current_price ?? null) as any;

  if (priceObj && typeof priceObj === "object") {
    const valueStr = priceObj.value;
    const decimals = priceObj.decimals;

    if (typeof valueStr === "string" && typeof decimals === "number") {
      const total = Number(valueStr);
      if (!Number.isNaN(total) && total > 0) {
        priceEth = total / 10 ** decimals;
      }
    }
  } else if (
    typeof priceObj === "string" ||
    typeof priceObj === "number"
  ) {
    const n = Number(priceObj);
    if (!Number.isNaN(n) && n > 0) {
      // raw wei?
      priceEth = n > 1e10 ? n / 1e18 : n;
    }
  }

  // -----------------------------
  // Criteria / collection-wide offers:
  // convert collection-wide price into per-NFT price
  // -----------------------------
  try {
    if (
      rawOffer.criteria?.encoded_token_ids === "*" &&
      typeof priceEth === "number" &&
      priceEth > 0
    ) {
      const params = rawOffer.protocol_data?.parameters;
      const consideration = params?.consideration;

      if (Array.isArray(consideration)) {
        const nftLeg = consideration.find(
          (c: any) =>
            c &&
            typeof c === "object" &&
            (c.itemType === 4 || c.itemType === 2 || c.itemType === 3),
        );

        const amountStr: string | undefined =
          nftLeg?.startAmount ?? nftLeg?.endAmount;
        const amountNum = amountStr ? Number(amountStr) : NaN;

        if (Number.isFinite(amountNum) && amountNum > 1) {
          priceEth = priceEth / amountNum;
        }
      }
    }
  } catch (err) {
    console.warn("criteria / consideration parsing failed:", err);
  }

  if (typeof priceEth !== "number" || priceEth <= 0) return null;

  const priceFormatted =
    priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4);

  const makerAddress: string | null =
    rawOffer.maker?.address ??
    rawOffer.maker_address ??
    rawOffer.maker ??
    rawOffer.protocol_data?.parameters?.offerer ??
    null;

  let expirationTime: number | null = null;
  const endTimeParam = rawOffer.protocol_data?.parameters?.endTime;

  if (typeof endTimeParam === "string") {
    const n = Number(endTimeParam);
    if (!Number.isNaN(n) && n > 0) expirationTime = n;
  } else if (typeof rawOffer.expires_at === "number") {
    expirationTime = rawOffer.expires_at;
  } else if (typeof rawOffer.expiration_time === "number") {
    expirationTime = rawOffer.expiration_time;
  }

  const protocolAddress: string | null =
    typeof rawOffer.protocol_address === "string"
      ? rawOffer.protocol_address
      : null;

  const id: string =
    rawOffer.order_hash ??
    rawOffer.id ??
    rawOffer.hash ??
    `${makerAddress ?? "unknown"}-${priceFormatted}-${Date.now()}`;

  return {
    id,
    priceEth,
    priceFormatted,
    maker: makerAddress,
    expirationTime,
    protocolAddress,
    source: "nft",
  };
}
