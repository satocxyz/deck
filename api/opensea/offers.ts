import { z } from "zod";

const querySchema = z.object({
  chain: z.enum(["base", "ethereum"]),
  collection: z.string().min(1, "collection slug is required"),
  identifier: z.string().min(1, "token identifier is required"),
});

type SimpleOffer = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  maker: string | null;
  expirationTime: number | null;
};

export default async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    const parsed = querySchema.safeParse({
      chain: searchParams.get("chain"),
      collection: searchParams.get("collection"),
      identifier: searchParams.get("identifier"),
    });

    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid query", details: parsed.error.flatten() }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const { chain, collection, identifier } = parsed.data;

    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      console.error("Missing OPENSEA_API_KEY environment variable");
      return new Response(
        JSON.stringify({ error: "Server misconfigured" }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      );
    }

    // Map our chain to OpenSea chain slug (same names for these two)
    const osChain = chain === "base" ? "base" : "ethereum";
    const protocol = "seaport";

    // Get all offers for this specific item
    // Docs: GET /api/v2/orders/{chain}/{protocol}/offers with asset_contract_address + token_ids
    // 
    //
    // We use nft.contract (asset_contract_address) and token id (identifier).
    const assetContractAddress = searchParams.get("contract");
    if (!assetContractAddress) {
      return new Response(
        JSON.stringify({ error: "Missing contract address" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const params = new URLSearchParams({
      asset_contract_address: assetContractAddress,
      // token_ids is an array; here we just pass a single id
      token_ids: identifier,
      // Optional sorting: highest price first
      order_by: "eth_price",
      order_direction: "desc",
      limit: "10",
    });

    const osUrl = `https://api.opensea.io/api/v2/orders/${osChain}/${protocol}/offers?${params.toString()}`;

    const osRes = await fetch(osUrl, {
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
      },
    });

    if (!osRes.ok) {
      const text = await osRes.text();
      console.error("OpenSea offers error", osRes.status, text);
      return new Response(
        JSON.stringify({ error: "Failed to fetch offers from OpenSea" }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const json = (await osRes.json()) as {
      orders?: any[];
      next?: string | null;
    };

    const rawOrders = Array.isArray(json.orders) ? json.orders : [];

    const offers: SimpleOffer[] = rawOrders
      .filter((order) => {
        // filter out invalid / canceled / finalized orders
        if (order.canceled || order.finalized || order.marked_invalid) return false;
        if (!order.current_price) return false;
        return true;
      })
      .map((order) => {
        const currentPriceStr: string = order.current_price;
        // current_price is in wei for the full order price 
        let priceEth = 0;
        try {
          const wei = BigInt(currentPriceStr);
          // assume 18 decimals (WETH/ETH-like)
          priceEth = Number(wei) / 1e18;
        } catch {
          priceEth = 0;
        }

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

        return {
          id,
          priceEth,
          priceFormatted,
          maker: makerAddress,
          expirationTime,
        };
      })
      .filter((o) => o.priceEth > 0)
      .sort((a, b) => b.priceEth - a.priceEth)
      .slice(0, 10);

    return new Response(JSON.stringify({ offers }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/offers", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
