// api/opensea/offers.ts

type SimpleOffer = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  maker: string | null;
  expirationTime: number | null;
};

type FloorInfo = {
  eth: number | null;
  formatted: string | null;
};

export default async function handler(req: any, res: any) {
  try {
    const { query } = req;

    const chain = query.chain as string | undefined;
    const collectionSlug = query.collection as string | undefined;
    const identifier = query.identifier as string | undefined;
    const contract = query.contract as string | undefined;

    if (!chain || (chain !== "base" && chain !== "ethereum")) {
      res
        .status(400)
        .json({ error: "Invalid or missing chain. Expected 'base' or 'ethereum'." });
      return;
    }

    if (!collectionSlug) {
      res.status(400).json({ error: "Missing collection slug" });
      return;
    }

    if (!identifier) {
      res.status(400).json({ error: "Missing token identifier" });
      return;
    }

    if (!contract) {
      res.status(400).json({ error: "Missing contract address" });
      return;
    }

    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      console.error("Missing OPENSEA_API_KEY");
      res.status(500).json({ error: "Server misconfigured" });
      return;
    }

    const osChain = chain === "base" ? "base" : "ethereum";
    const protocol = "seaport";

    // Item-level best offer
    const offersParams = new URLSearchParams({
      asset_contract_address: contract,
      token_ids: identifier,
      order_by: "eth_price",
      order_direction: "desc",
      limit: "1",
    });

    const offersUrl = `https://api.opensea.io/api/v2/orders/${osChain}/${protocol}/offers?${offersParams.toString()}`;

    // Collection-level stats
    const statsUrl = `https://api.opensea.io/api/v2/collections/${collectionSlug}/stats`;

    const [offersRes, statsRes] = await Promise.all([
      fetch(offersUrl, {
        headers: {
          accept: "application/json",
          "x-api-key": apiKey,
        },
      }),
      fetch(statsUrl, {
        headers: {
          accept: "application/json",
          "x-api-key": apiKey,
        },
      }),
    ]);

    let bestOffer: SimpleOffer | null = null;
    let floor: FloorInfo = { eth: null, formatted: null };

    // -------------------------
    // Parse ITEM-LEVEL offer
    // -------------------------
    if (offersRes.ok) {
      const offersJson = (await offersRes.json()) as { orders?: any[] };
      const rawOrders = Array.isArray(offersJson.orders)
        ? offersJson.orders
        : [];

      if (rawOrders.length > 0) {
        const order = rawOrders[0];

        const currentPriceStr: string = order.current_price;
        let priceEth = 0;
        try {
          const wei = BigInt(currentPriceStr);
          priceEth = Number(wei) / 1e18;
        } catch {
          priceEth = 0;
        }

        if (priceEth > 0) {
          const priceFormatted =
            priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4);

          const makerAddress: string | null =
            order.maker?.address ?? order.maker?.account?.address ?? null;

          const expirationTime: number | null =
            typeof order.expiration_time === "number"
              ? order.expiration_time
              : null;

          bestOffer = {
            id:
              order.order_hash ??
              order.id ??
              `${makerAddress ?? "unknown"}-${currentPriceStr}`,
            priceEth,
            priceFormatted,
            maker: makerAddress,
            expirationTime,
          };
        }
      }
    } else {
      const text = await offersRes.text();
      console.error("OpenSea offers error", offersRes.status, text);
    }

    // ----------------------------
    // Parse collection stats:
    //   - floor_price
    //   - *try* to detect top offer field
    // ----------------------------
    if (statsRes.ok) {
      const statsJson = (await statsRes.json()) as {
        total?: Record<string, unknown>;
      };

      // Helpful once so you can see exact structure in Vercel logs
      console.log("OpenSea collection stats JSON (truncated):", {
        keys: Object.keys(statsJson?.total ?? {}),
      });

      const total = (statsJson.total ?? {}) as Record<string, unknown>;

      // FLOOR
      const floorRaw = total["floor_price"];
      if (typeof floorRaw === "number") {
        floor.eth = floorRaw;
        floor.formatted =
          floorRaw >= 1 ? floorRaw.toFixed(3) : floorRaw.toFixed(4);
      }

      // Try a few likely top-offer field names
      const possibleTop =
        typeof total["top_offer"] === "number"
          ? (total["top_offer"] as number)
          : typeof total["top_bid"] === "number"
            ? (total["top_bid"] as number)
            : typeof total["top_offer_price"] === "number"
              ? (total["top_offer_price"] as number)
              : null;

      // If there was no item-level bestOffer, but we DO have a collection-level top offer, use it
      if (!bestOffer && typeof possibleTop === "number" && possibleTop > 0) {
        const priceEth = possibleTop;
        const priceFormatted =
          priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4);

        bestOffer = {
          id: "collection-top-offer",
          priceEth,
          priceFormatted,
          maker: null, // stats API does not expose maker address
          expirationTime: null,
        };
      }
    } else {
      const text = await statsRes.text();
      console.error("OpenSea stats error", statsRes.status, text);
    }

    res.status(200).json({ bestOffer, floor });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/offers", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
