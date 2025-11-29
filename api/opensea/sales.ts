// api/opensea/sales.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const querySchema = z.object({
  chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
  collection: z.string().min(1, "Missing collection slug"),
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(10))
    .optional(),
});

const chainSlug: Record<string, string> = {
  base: "base",
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  optimism: "optimism",
};

type SimpleSale = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  buyer: string | null;
  seller: string | null;
  paymentSymbol: string | null;
  occurredAt: number | null; // unix seconds
  tokenId?: string | null;
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  const baseUrl =
    process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

  if (!apiKey) {
    console.error("Missing OPENSEA_API_KEY");
    return res
      .status(500)
      .json({ ok: false, error: "Server misconfigured: missing API key" });
  }

  const parsed = querySchema.safeParse({
    chain: req.query.chain,
    collection: req.query.collection,
    limit: req.query.limit,
  });

  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid parameters",
      details: parsed.error.flatten(),
    });
  }

  const { chain, collection, limit } = parsed.data;
  const limitFinal = limit ?? 3;

  try {
    // Collection-level events; we only care about sales
    const url = new URL(
      `${baseUrl}/events/collection/${encodeURIComponent(collection)}`,
    );
    url.searchParams.set("event_type", "sale");
    url.searchParams.set("limit", String(limitFinal));
    // chain is optional for this endpoint, but safe to send
    url.searchParams.set("chain", chainSlug[chain]);

    const response = await fetch(url.toString(), {
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

    // v2 uses "events"; older docs / wrappers sometimes use "asset_events"
    const rawEvents: any[] =
      (Array.isArray(json?.events) && json.events) ||
      (Array.isArray(json?.asset_events) && json.asset_events) ||
      [];

    const sales: SimpleSale[] = rawEvents
      .filter((ev) => {
        const t = ev?.event_type || ev?.type;
        return t === "sale" || t === "successful";
      })
      .slice(0, limitFinal)
      .map((ev) => {
        // payment object: quantity + token (decimals, symbol)
        let priceEth = 0;
        let symbol: string | null = null;

        const payment = ev?.payment ?? ev?.transaction?.payment ?? null;

        if (payment && typeof payment === "object") {
          const quantityStr: string | undefined = payment.quantity;
          const decimals: number | undefined = payment.token?.decimals;
          symbol =
            typeof payment.token?.symbol === "string"
              ? payment.token.symbol
              : null;

          const quantityNum = quantityStr ? Number(quantityStr) : NaN;
          if (
            typeof decimals === "number" &&
            Number.isFinite(quantityNum) &&
            quantityNum > 0
          ) {
            priceEth = quantityNum / 10 ** decimals;
          }
        }

        // fallback: some events might expose price directly
        if (!priceEth && ev.price) {
          const n = Number(ev.price);
          if (!Number.isNaN(n) && n > 0) {
            priceEth = n > 1e10 ? n / 1e18 : n;
          }
        }

        const priceFormatted =
          priceEth > 0
            ? priceEth >= 1
              ? priceEth.toFixed(3)
              : priceEth.toFixed(4)
            : "0.0000";

        const buyer: string | null =
          ev?.to_account?.address ??
          ev?.to_address ??
          ev?.buyer?.address ??
          null;

        const seller: string | null =
          ev?.from_account?.address ??
          ev?.from_address ??
          ev?.seller?.address ??
          null;

        const tokenId: string | null =
          ev?.nft?.identifier ??
          ev?.asset?.token_id ??
          ev?.token_id ??
          null;

        const occurredIso: string | null =
          ev?.occurred_at ??
          ev?.created_date ??
          ev?.event_timestamp ??
          null;

        const occurredAt =
          occurredIso && typeof occurredIso === "string"
            ? Math.floor(Date.parse(occurredIso) / 1000)
            : null;

        const id: string =
          ev?.id ??
          ev?.event_id ??
          ev?.order_hash ??
          `${seller ?? "unknown"}-${buyer ?? "unknown"}-${tokenId ?? "?"}-${
            occurredAt ?? Date.now()
          }`;

        return {
          id,
          priceEth,
          priceFormatted,
          buyer,
          seller,
          paymentSymbol: symbol,
          occurredAt,
          tokenId,
        };
      })
      // Filter out obviously bad (zero) prices
      .filter((s) => s.priceEth > 0);

    return res.status(200).json({
      ok: true,
      sales,
    });
  } catch (err) {
    console.error("Unexpected error in /api/opensea/sales", err);
    return res
      .status(500)
      .json({ ok: false, error: "Internal server error while fetching sales" });
  }
}
