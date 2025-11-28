// api/opensea/offers.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type SimpleOffer = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  maker: string | null;
  expirationTime: number | null;
  protocolAddress: string | null; // NEW
  source: "nft";
};

type FloorInfo = {
  eth: number | null;
  formatted: string | null;
};

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

  const allowedChains = ["base", "ethereum", "arbitrum", "optimism"];

  if (!chain || !allowedChains.includes(chain)) {
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
    // 2) BEST OFFER FOR THIS NFT
    // -------------------------------------------------
    const bestOfferUrl = `${baseUrl}/offers/collection/${collectionSlug}/nfts/${identifier}/best`;

    const bestRes = await fetch(bestOfferUrl, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
    });

    if (bestRes.ok) {
      const bestJson = (await bestRes.json()) as any;

      const rawOffer =
        bestJson?.best_offer ??
        bestJson?.best ??
        bestJson?.offer ??
        bestJson ??
        null;

      if (rawOffer && typeof rawOffer === "object") {
        // -------------------------------------------------
        // PRICE PARSING
        // -------------------------------------------------
        let priceEth: number | null = null;

        const priceObj = rawOffer.price ?? rawOffer.current_price ?? null;

        if (priceObj && typeof priceObj === "object") {
          const valueStr = (priceObj as any).value;
          const decimals = (priceObj as any).decimals;

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
            priceEth = n > 1e10 ? n / 1e18 : n;
          }
        }

        // -------------------------------------------------
        // HANDLE CRITERIA / COLLECTION-WIDE OFFER
        // Derive per-NFT price from consideration startAmount
        // when the order targets multiple NFTs.
        // -------------------------------------------------
        try {
          if (
            rawOffer.criteria?.encoded_token_ids === "*" &&
            typeof priceEth === "number" &&
            priceEth > 0
          ) {
            const params = rawOffer.protocol_data?.parameters;
            const consideration = params?.consideration;

            if (Array.isArray(consideration)) {
              // first NFT leg (ERC721/1155)
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
                // per-NFT price
                priceEth = priceEth / amountNum;
              }
            }
          }
        } catch (err) {
          console.warn("criteria / consideration parsing failed:", err);
        }

        // -------------------------------------------------
        // BUILD OFFER OBJECT
        // -------------------------------------------------
        if (typeof priceEth === "number" && priceEth > 0) {
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
            `${makerAddress ?? "unknown"}-${priceFormatted}`;

          bestOffer = {
            id,
            priceEth,
            priceFormatted,
            maker: makerAddress,
            expirationTime,
            protocolAddress,
            source: "nft",
          };
        }
      }
    }

    return res.status(200).json({ bestOffer, floor });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/offers", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
