// api/opensea/sales.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const querySchema = z.object({
  chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
  collection: z.string().min(1, "Missing collection slug"),
  identifier: z.string().min(1, "Missing token identifier"),
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(20))
    .optional(),
});

type SimpleSale = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  buyer: string | null;
  seller: string | null;
  paymentTokenSymbol: string | null;
  transactionHash: string | null;
  timestamp: number | null; // seconds since epoch
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  const baseUrl =
    process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

  if (!apiKey) {
    console.error("Missing OPENSEA_API_KEY");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const parsed = querySchema.safeParse({
    chain: req.query.chain,
    collection: req.query.collection,
    identifier: req.query.identifier,
    limit: req.query.limit ?? "3",
  });

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid parameters",
      details: parsed.error.flatten(),
    });
  }

  const { chain, collection, identifier, limit } = parsed.data;
  const perNftLimit = limit ?? 3;

  try {
    // We query by collection, then filter down to the specific token id.
    const params = new URLSearchParams({
      event_type: "sale",
      chain,
      limit: "50", // grab enough to safely filter down to this NFT
    });

    const url = `${baseUrl}/events/collection/${encodeURIComponent(
      collection,
    )}?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("OpenSea sales error", response.status, text);
      return res
        .status(502)
        .json({ ok: false, error: "Failed to fetch sales from OpenSea" });
    }

    const json = (await response.json()) as any;
    const rawEvents: any[] = Array.isArray(json.asset_events)
      ? json.asset_events
      : [];

    const normalized: SimpleSale[] = [];

    for (const evt of rawEvents) {
      if (evt?.event_type !== "sale") continue;
      const nft = evt.nft;

      if (!nft || String(nft.identifier) !== String(identifier)) continue;

      const payment = evt.payment;
      if (!payment) continue;

      let quantity = payment.quantity;
      if (typeof quantity === "string") {
        quantity = Number(quantity);
      }

      if (typeof quantity !== "number" || Number.isNaN(quantity) || quantity <= 0)
        continue;

      const decimals =
        typeof payment.decimals === "number" ? payment.decimals : 18;

      const priceEth = quantity / 10 ** decimals;
      if (!Number.isFinite(priceEth) || priceEth <= 0) continue;

      const priceFormatted =
        priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4);

      const sale: SimpleSale = {
        id:
          (typeof evt.transaction === "string" && evt.transaction) ||
          (typeof evt.order_hash === "string" && evt.order_hash) ||
          `${identifier}-${normalized.length}`,
        priceEth,
        priceFormatted,
        buyer: typeof evt.buyer === "string" ? evt.buyer : null,
        seller: typeof evt.seller === "string" ? evt.seller : null,
        paymentTokenSymbol:
          typeof payment.symbol === "string" ? payment.symbol : null,
        transactionHash:
          typeof evt.transaction === "string" ? evt.transaction : null,
        timestamp:
          typeof evt.closing_date === "number" ? evt.closing_date : null,
      };

      normalized.push(sale);
    }

    // newest first
    normalized.sort(
      (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0),
    );

    const sliced = normalized.slice(0, perNftLimit);

    return res.status(200).json({
      ok: true,
      sales: sliced,
    });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/sales", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}
