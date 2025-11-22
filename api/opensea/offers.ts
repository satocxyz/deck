// api/offers.ts

import type { VercelRequest, VercelResponse } from "@vercel/node";

type SimpleOfferSource = "item" | "collection";

type SimpleOffer = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  maker: string | null;
  expirationTime: number | null;
  source: SimpleOfferSource;
};

type FloorInfo = {
  eth: number | null;
  formatted: string | null;
};

type OffersResponse = {
  bestOffer: SimpleOffer | null;
  floor: FloorInfo;
};

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      "x-api-key": OPENSEA_API_KEY || "",
      accept: "application/json",
    },
  });

  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    console.error("OpenSea API error", res.status, url, body);
    throw new Error(`OpenSea API error: ${res.status}`);
  }

  return res.json();
}

function extractEthPrice(offer: any): number {
  const price = offer?.price;

  if (typeof price?.current?.eth === "number") {
    return price.current.eth;
  }

  if (price?.current?.value && typeof price.current.decimals === "number") {
    const raw = Number(price.current.value);
    if (!Number.isNaN(raw)) {
      return raw / Math.pow(10, price.current.decimals);
    }
  }

  if (typeof price?.eth === "number") return price.eth;
  if (typeof price === "number") return price;

  return 0;
}

function extractMaker(offer: any): string | null {
  return (
    offer?.maker?.address ??
    offer?.maker?.address_hash ??
    offer?.maker ??
    null
  );
}

function extractExpiration(offer: any): number | null {
  return (
    offer?.expiration_time ??
    offer?.end_time ??
    offer?.closing_date ??
    null
  );
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!OPENSEA_API_KEY) {
      return res
        .status(500)
        .json({ error: "OpenSea API key is not configured" });
    }

    const { chain, collection: collectionSlug, identifier } = req.query as {
      chain?: string;
      collection?: string;
      identifier?: string;
    };

    if (!chain) {
      return res.status(400).json({ error: "Missing chain parameter" });
    }
    if (!collectionSlug) {
      return res.status(400).json({ error: "Missing collection slug" });
    }
    if (!identifier) {
      return res.status(400).json({ error: "Missing identifier (token id)" });
    }

    // 1) Collection floor
    let floor: FloorInfo = { eth: null, formatted: null };
    try {
      const statsUrl = `https://api.opensea.io/api/v2/collections/${collectionSlug}/stats`;
      const statsJson: any = await fetchJson(statsUrl);
      const floorPrice =
        statsJson?.stats?.floor_price ?? statsJson?.floor_price ?? null;

      if (typeof floorPrice === "number") {
        floor = {
          eth: floorPrice,
          formatted: floorPrice.toFixed(4),
        };
      }
    } catch (err) {
      console.error("Error fetching collection floor", err);
    }

    // 2) Best offer for this NFT
    let itemBest: SimpleOffer | null = null;
    try {
      const itemBestUrl = `https://api.opensea.io/api/v2/offers/collection/${collectionSlug}/nfts/${identifier}/best`;
      const itemBestJson: any = await fetchJson(itemBestUrl);

      if (itemBestJson && Object.keys(itemBestJson).length > 0) {
        const priceEth = extractEthPrice(itemBestJson);
        itemBest = {
          id: String(
            itemBestJson.order_hash ??
              itemBestJson.id ??
              `${collectionSlug}-${identifier}-best`
          ),
          priceEth,
          priceFormatted: priceEth ? priceEth.toFixed(4) : "0.0000",
          maker: extractMaker(itemBestJson),
          expirationTime: extractExpiration(itemBestJson),
          source: "item",
        };
      }
    } catch (err) {
      console.error("Error fetching best item offer", err);
    }

    // 3) Best offer on the collection
    let collectionBest: SimpleOffer | null = null;
    try {
      const collectionOffersUrl = `https://api.opensea.io/api/v2/offers/collection/${collectionSlug}/all?limit=50`;
      const collectionJson: any = await fetchJson(collectionOffersUrl);

      const offers: any[] =
        collectionJson?.offers ??
        collectionJson?.orders ??
        (Array.isArray(collectionJson) ? collectionJson : []);

      if (offers.length > 0) {
        let best: any = null;
        let bestPrice = 0;

        for (const offer of offers) {
          const pe = extractEthPrice(offer);
          if (pe > bestPrice) {
            bestPrice = pe;
            best = offer;
          }
        }

        if (best) {
          collectionBest = {
            id: String(
              best.order_hash ??
                best.id ??
                `${collectionSlug}-collection-best`
            ),
            priceEth: bestPrice,
            priceFormatted: bestPrice ? bestPrice.toFixed(4) : "0.0000",
            maker: extractMaker(best),
            expirationTime: extractExpiration(best),
            source: "collection",
          };
        }
      }
    } catch (err) {
      console.error("Error fetching collection offers", err);
    }

    // 4) Decide which one to use
    let bestOffer: SimpleOffer | null = null;

    if (itemBest && collectionBest) {
      bestOffer =
        itemBest.priceEth >= collectionBest.priceEth ? itemBest : collectionBest;
    } else if (itemBest) {
      bestOffer = itemBest;
    } else if (collectionBest) {
      bestOffer = collectionBest;
    }

    const payload: OffersResponse = {
      bestOffer,
      floor,
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error("Unhandled error in offers handler", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
