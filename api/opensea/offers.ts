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

    // Best offer for this NFT
    const offersParams = new URLSearchParams({
      asset_contract_address: contract,
      token_ids: identifier,
      order_by: "eth_price",
      order_direction: "desc",
      limit: "1",
    });

    const offersUrl = `https://api.opensea.io/api/v2/orders/${osChain}/${protocol}/offers?${offersParams.toString()}`;

    // Collection stats (floor)
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

    // Parse offers
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
          priceEth = Number(wei) / 1e18; // assume 18 decimals
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

          const id: string =
            order.order_hash ??
            order.id ??
            `${makerAddress ?? "unknown"}-${currentPriceStr}`;

          bestOffer = {
            id,
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

    // Parse floor price
    if (statsRes.ok) {
      const statsJson = (await statsRes.json()) as {
        total?: { floor_price?: number | null };
      };
      const floorPrice = statsJson?.total?.floor_price ?? null;
      if (typeof floorPrice === "number") {
        floor.eth = floorPrice;
        floor.formatted =
          floorPrice >= 1
            ? floorPrice.toFixed(3)
            : floorPrice.toFixed(4);
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
