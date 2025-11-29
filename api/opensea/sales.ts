// api/opensea/sales.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const querySchema = z.object({
  chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
  collection: z.string().min(1, "Missing collection slug"),
  identifier: z.string().optional(), // currently unused, we aggregate by collection
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(20))
    .optional(),
});

type Sale = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  buyer: string | null;
  seller: string | null;
  paymentTokenSymbol: string | null;
  transactionHash: string | null;
  timestamp: number | null;
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res
      .status(405)
      .json({ ok: false, message: "Method not allowed (GET only)" });
  }

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      message: "Invalid query params",
      issues: parsed.error.format(),
    });
  }

  const { collection, limit } = parsed.data;
  const pageSize = limit ?? 3;

  try {
    const url = new URL(
      `https://api.opensea.io/api/v2/events/collection/${encodeURIComponent(
        collection,
      )}`,
    );

    // We only care about sales, last N events
    url.searchParams.append("event_type", "sale");
    url.searchParams.append("limit", String(pageSize));

    const resp = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "x-api-key": process.env.OPENSEA_API_KEY ?? "",
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error("OpenSea sales API error", resp.status, text);
      return res.status(502).json({
        ok: false,
        message: "OpenSea events API returned a non-200 status",
      });
    }

    const json = (await resp.json()) as any;

    const assetEvents: any[] = Array.isArray(json.asset_events)
      ? json.asset_events
      : [];

    const sales: Sale[] = assetEvents.slice(0, pageSize).map((ev) => {
      const payment = ev.payment ?? {};
      const tx = ev.transaction ?? {};
      const buyer = ev.buyer ?? ev.to_address ?? ev.to ?? null;
      const seller = ev.seller ?? ev.from_address ?? ev.from ?? null;

      const paymentQuantity =
        typeof payment.quantity === "string" ? payment.quantity : "0";
      const paymentDecimals =
        typeof payment.decimals === "number" ? payment.decimals : 18;

      let priceEth = 0;
      try {
        const q = BigInt(paymentQuantity || "0");
        const denom = 10n ** BigInt(paymentDecimals);
        priceEth = Number(q) / Number(denom);
      } catch {
        priceEth = 0;
      }

      const priceFormatted =
        priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4);

      let timestamp: number | null = null;
      if (typeof ev.event_timestamp === "number") {
        timestamp = ev.event_timestamp;
      } else if (typeof ev.event_timestamp === "string") {
        const d = Date.parse(ev.event_timestamp);
        if (!Number.isNaN(d)) timestamp = Math.floor(d / 1000);
      }

      const id =
        (typeof ev.order_hash === "string" && ev.order_hash) ||
        (typeof tx.hash === "string" && tx.hash) ||
        `${collection}-${timestamp ?? Date.now()}`;

      return {
        id,
        priceEth,
        priceFormatted,
        buyer:
          typeof buyer === "string"
            ? buyer
            : typeof buyer?.address === "string"
              ? buyer.address
              : null,
        seller:
          typeof seller === "string"
            ? seller
            : typeof seller?.address === "string"
              ? seller.address
              : null,
        paymentTokenSymbol:
          typeof payment.symbol === "string" ? payment.symbol : null,
        transactionHash:
          typeof tx.hash === "string" ? tx.hash : ev.transaction_hash ?? null,
        timestamp,
      };
    });

    return res.status(200).json({
      ok: true,
      sales,
      rawCount: assetEvents.length,
    });
  } catch (err) {
    console.error("Unexpected error while fetching sales", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch sales from OpenSea",
    });
  }
}
