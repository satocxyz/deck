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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const chain = req.query.chain as string | undefined;
  const collectionSlug = req.query.collection as string | undefined;
  const identifier = req.query.identifier as string | undefined;

  if (!chain || (chain !== "base" && chain !== "ethereum")) {
    return res
      .status(400)
      .json({ error: "Invalid or missing chain. Expected 'base' or 'ethereum'." });
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
    // ---------- 1) Floor price from collection stats ----------
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
      console.log("OpenSea collection stats keys:", Object.keys(total));

      const floorRaw = total["floor_price"];
      if (typeof floorRaw === "number") {
        floor.eth = floorRaw;
        floor.formatted =
          floorRaw >= 1 ? floorRaw.toFixed(3) : floorRaw.toFixed(4);
      }
    } else {
      const text = await statsRes.text();
      console.error("OpenSea stats error", statsRes.status, text);
    }

    // ---------- 2) Best offer for this specific NFT ----------
    const bestOfferUrl = `${baseUrl}/offers/collection/${collectionSlug}/nfts/${identifier}/best`;

    const bestRes = await fetch(bestOfferUrl, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
    });

    if (bestRes.ok) {
      const bestJson = (await bestRes.json()) as any;

      // For this endpoint, the root object is the order / best offer.
      const rawOffer =
        bestJson?.best_offer ??
        bestJson?.best ??
        bestJson?.offer ??
        bestJson ??
        null;

      if (rawOffer && typeof rawOffer === "object") {
        // ----- Parse price (per NFT) -----
        // Expected shape:
        // price: { currency: "WETH", decimals: 18, value: "11400000000000000" }
        let priceEth: number | null = null;

        const priceObj = rawOffer.price ?? rawOffer.current_price ?? null;

        if (priceObj && typeof priceObj === "object") {
          const valueStr = (priceObj as any).value;
          const decimals = (priceObj as any).decimals;

          if (
            typeof valueStr === "string" &&
            typeof decimals === "number" &&
            decimals >= 0 &&
            decimals <= 36
          ) {
            const total = Number(valueStr);
            if (!Number.isNaN(total) && total > 0) {
              // 1) convert to ETH/WETH
              const totalEth = total / 10 ** decimals;

              // 2) divide by remaining_quantity for criteria orders
              const qtyRaw = (rawOffer as any).remaining_quantity;
              const quantity =
                typeof qtyRaw === "number" && qtyRaw > 0 ? qtyRaw : 1;

              priceEth = totalEth / quantity;
            }
          } else if (typeof (priceObj as any).decimal === "number") {
            priceEth = (priceObj as any).decimal;
          }
        } else if (
          typeof priceObj === "string" ||
          typeof priceObj === "number"
        ) {
          const n = Number(priceObj);
          if (!Number.isNaN(n) && n > 0) {
            // last-resort heuristic
            priceEth = n > 1e10 ? n / 1e18 : n;
          }
        }

        if (priceEth && priceEth > 0) {
          const priceFormatted =
            priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4);

          // ----- Parse maker address -----
          const makerAddress: string | null =
            rawOffer.maker?.address ??
            rawOffer.maker_address ??
            rawOffer.maker ??
            rawOffer.protocol_data?.parameters?.offerer ??
            null;

          // ----- Parse expiration -----
          let expirationTime: number | null = null;
          const endTimeParam = rawOffer.protocol_data?.parameters?.endTime;
          if (typeof endTimeParam === "string") {
            const n = Number(endTimeParam);
            if (!Number.isNaN(n) && n > 0) {
              expirationTime = n;
            }
          } else if (typeof rawOffer.expires_at === "number") {
            expirationTime = rawOffer.expires_at;
          } else if (typeof rawOffer.expiration_time === "number") {
            expirationTime = rawOffer.expiration_time;
          }

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
            source: "nft",
          };
        }
      }
    } else if (bestRes.status !== 404) {
      // 404 = no best offer; that's fine → keep bestOffer = null
      const text = await bestRes.text();
      console.error("OpenSea best-offer error", bestRes.status, text);
    }

    return res.status(200).json({ bestOffer, floor });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/offers", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
