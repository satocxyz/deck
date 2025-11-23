// api/opensea/fulfillment.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type SupportedChain = "base" | "ethereum";

type FulfillmentRequestBody = {
  chain?: SupportedChain;
  orderHash?: string;
  nft?: {
    contract?: string;
    tokenId?: string;
  };
  price?: {
    eth?: number;
    formatted?: string;
    currency?: string; // e.g. "WETH"
  };
};

type FulfillmentResponse = {
  ok: boolean;
  /**
   * true  → backend thinks it's safe to proceed with signing/filling
   * false → do NOT attempt to sign/fill; see `reason` / `message`
   */
  safeToFill: boolean;
  reason:
    | "not_implemented"
    | "invalid_request"
    | "unsupported_chain";
  message: string;
  echo?: {
    chain: SupportedChain;
    orderHash: string;
    nft?: {
      contract?: string;
      tokenId?: string;
    };
    price?: {
      eth?: number;
      formatted?: string;
      currency?: string;
    };
  };
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "invalid_request",
      message: "Only POST is allowed on this endpoint.",
    };
    return res.status(405).json(payload);
  }

  let body: FulfillmentRequestBody;
  try {
    if (typeof req.body === "string") {
      body = JSON.parse(req.body);
    } else {
      body = (req.body || {}) as FulfillmentRequestBody;
    }
  } catch (err) {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "invalid_request",
      message: "Request body must be valid JSON.",
    };
    return res.status(400).json(payload);
  }

  const chain = body.chain;
  const orderHash = body.orderHash;

  // Basic validation – we keep it strict now so we don't have to change it later
  if (chain !== "base" && chain !== "ethereum") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "unsupported_chain",
      message: "Invalid or missing chain. Expected 'base' or 'ethereum'.",
      echo: {
        chain: (chain ?? "base") as SupportedChain,
        orderHash: orderHash ?? "",
        nft: body.nft,
        price: body.price,
      },
    };
    return res.status(400).json(payload);
  }

  if (!orderHash || typeof orderHash !== "string") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "invalid_request",
      message: "Missing or invalid orderHash.",
      echo: {
        chain,
        orderHash: orderHash ?? "",
        nft: body.nft,
        price: body.price,
      },
    };
    return res.status(400).json(payload);
  }

  // 🔒 IMPORTANT:
  // For now we DO NOT:
  // - Call OpenSea
  // - Construct or return a transaction
  // - Ask the user to sign anything
  //
  // This endpoint is just a stub so that the frontend can be wired up
  // without breaking once we add real Seaport / fulfillment integration.

  const response: FulfillmentResponse = {
    ok: true,
    safeToFill: false,
    reason: "not_implemented",
    message:
      "Accepting offers is not enabled yet in Deck. " +
      "This endpoint is reserved for future secure on-chain fulfillment " +
      "using OpenSea's Seaport contracts. For now, no transaction will be created.",
    echo: {
      chain,
      orderHash,
      nft: body.nft,
      price: body.price,
    },
  };

  return res.status(200).json(response);
}
