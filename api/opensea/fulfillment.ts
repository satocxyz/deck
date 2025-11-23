// api/opensea/fulfillment.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type MiniOfferPayload = {
  priceEth: number;
  priceFormatted: string;
  expirationTime: number | null;
};

type FulfillmentRequestBody = {
  chain: "base" | "ethereum";
  orderHash: string;
  offer: MiniOfferPayload | null;
};

type FulfillmentResponse = {
  ok: boolean;
  safeToFill: boolean;
  reason?: string;
  message?: string;
  echo: {
    chain: string;
    orderHash: string;
    offer: {
      priceEth: number;
      priceFormatted: string;
      expirationTime: number | null;
    } | null;
  };
  tx?: {
    to: string;
    data: string;
    value: string; // hex or decimal string
  };
};


export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { chain, orderHash, offer } = req.body as Partial<FulfillmentRequestBody>;

  if (chain !== "base" && chain !== "ethereum") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "bad_request",
      message: "Invalid or missing 'chain'. Expected 'base' or 'ethereum'.",
      echo: { chain, orderHash, offer } as any,
    };
    return res.status(400).json(payload);
  }

  if (!orderHash || typeof orderHash !== "string") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "bad_request",
      message: "Missing or invalid 'orderHash'.",
      echo: { chain, orderHash, offer } as any,
    };
    return res.status(400).json(payload);
  }

  // From here on, *never* 400 — this endpoint is a stub.
  const payload: FulfillmentResponse = {
    ok: true,
    safeToFill: false,
    reason: "not_implemented",
    message:
      "Accepting offers is not enabled yet in Deck. This endpoint is a stub for future smart-contract integrations. For now, no transaction will be created.",
    echo: {
      chain,
      orderHash,
      offer: (offer ?? null) as MiniOfferPayload | null,
    },
  };

  return res.status(200).json(payload);
}
