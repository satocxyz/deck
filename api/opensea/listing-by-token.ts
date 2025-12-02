// api/opensea/listing-by-token.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const querySchema = z.object({
  chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
  contract: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address"),
  tokenId: z.string().min(1, "Missing tokenId"),
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(20))
    .optional(),
});

function openSeaChainSlug(chain: string): string {
  switch (chain) {
    case "base":
      return "base";
    case "ethereum":
      return "ethereum";
    case "arbitrum":
      return "arbitrum";
    case "optimism":
      return "optimism";
    default:
      return "ethereum";
  }
}

// Shape roughly matching your `Listing` type in App.tsx
function mapOrderToListing(order: any) {
  const asset = order?.maker_asset_bundle?.assets?.[0];

  const priceWeiStr = order?.current_price ?? "0";
  let priceEth = 0;
  let priceFormatted = "0.0000";

  if (typeof priceWeiStr === "string") {
    const n = Number(priceWeiStr) / 1e18;
    if (Number.isFinite(n)) {
      priceEth = n;
      priceFormatted = n >= 1 ? n.toFixed(3) : n.toFixed(4);
    }
  }

  const expiration =
    typeof order?.expiration_time === "number"
      ? order.expiration_time
      : null;

  const makerAddr = order?.maker?.address ?? null;

  const tokenId = asset?.token_id ?? null;
  const tokenContract = asset?.asset_contract?.address ?? null;
  const name = asset?.name ?? null;
  const imageUrl = asset?.image_url ?? null;

  return {
    id: order?.order_hash ?? "",
    priceEth,
    priceFormatted,
    maker: makerAddr,
    expirationTime: expiration,
    protocolAddress: order?.protocol_address ?? null,

    tokenId,
    tokenContract,
    name,
    imageUrl,
    image_url: imageUrl,
    image: imageUrl,
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res
      .status(405)
      .json({ ok: false, message: "Method not allowed. Use GET." });
  }

  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      const msg =
        parsed.error.errors.map((e) => e.message).join(", ") ||
        "Invalid query params.";
      return res.status(400).json({ ok: false, message: msg });
    }

    const { chain, contract, tokenId, limit } = parsed.data;
    const apiKey = process.env.OPENSEA_API_KEY;

    if (!apiKey) {
      console.error("[listing-by-token] Missing OPENSEA_API_KEY.");
      return res
        .status(500)
        .json({ ok: false, message: "Server missing OpenSea API key." });
    }

    const chainSlug = openSeaChainSlug(chain);

    const url = new URL(
      `https://api.opensea.io/api/v2/orders/${chainSlug}/seaport/listings`,
    );
    url.searchParams.set("asset_contract_address", contract);
    url.searchParams.set("token_ids", tokenId);
    url.searchParams.set("order_by", "created_date");
    url.searchParams.set("order_direction", "desc");
    url.searchParams.set("limit", String(limit ?? 10));

    const osRes = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        "Accept": "application/json",
      },
    });

    const osJson: any = await osRes.json().catch(() => ({}));

    if (!osRes.ok) {
      console.error(
        "[listing-by-token] OpenSea error",
        osRes.status,
        osJson,
      );
      return res.status(200).json({
        ok: false,
        message:
          "OpenSea returned HTTP " +
          osRes.status +
          " when fetching listings for this token.",
        raw: osJson,
      });
    }

    const orders: any[] = Array.isArray(osJson.orders) ? osJson.orders : [];
    const listings = orders.map(mapOrderToListing);

    return res.status(200).json({
      ok: true,
      listings,
    });
  } catch (err) {
    console.error("[listing-by-token] Unexpected error", err);
    return res.status(500).json({
      ok: false,
      message: "Unexpected server error in listing-by-token.",
    });
  }
}
