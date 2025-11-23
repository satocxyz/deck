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
  takerAddress?: string; // <-- added
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
    takerAddress?: string;
    offer: {
      priceEth: number;
      priceFormatted: string;
      expirationTime: number | null;
    } | null;
  };
  tx?: {
    to: string;
    data: string;
    value: string;
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

  const { chain, orderHash, takerAddress, offer } =
    req.body as Partial<FulfillmentRequestBody>;

  // -------------------------------
  // Basic validation
  // -------------------------------
  if (chain !== "base" && chain !== "ethereum") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "bad_request",
      message: "Invalid or missing 'chain'. Expected 'base' or 'ethereum'.",
      echo: { chain, orderHash, takerAddress, offer } as any,
    };
    return res.status(400).json(payload);
  }

  if (!orderHash || typeof orderHash !== "string") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "bad_request",
      message: "Missing or invalid 'orderHash'.",
      echo: { chain, orderHash, takerAddress, offer } as any,
    };
    return res.status(400).json(payload);
  }

  // -------------------------------
  // STEP-B: "Test transaction" mode
  // -------------------------------
  // This allows real wallet signing with a safe tx (0 ETH to yourself)
  const enableTestTx = process.env.DECK_ENABLE_TEST_TX === "true";

  if (enableTestTx && takerAddress) {
    const tx = {
      to: takerAddress,
      data: "0x",
      value: "0", // no ETH transferred
    };

    const payload: FulfillmentResponse = {
      ok: true,
      safeToFill: true,
      reason: "test_self_tx",
      message:
        "Test mode: sending a 0-value transaction to your own wallet. No offer will be accepted.",
      echo: {
        chain,
        orderHash,
        takerAddress,
        offer: (offer ?? null) as MiniOfferPayload | null,
      },
      tx,
    };

    return res.status(200).json(payload);
  }

  // -------------------------------
  // DEFAULT: Real fulfillment not enabled
  // -------------------------------
  const payload: FulfillmentResponse = {
    ok: true,
    safeToFill: false,
    reason: "not_implemented",
    message:
      "Accepting offers is not enabled yet in Deck. This endpoint is a stub for future integrations. No transaction will be created.",
    echo: {
      chain,
      orderHash,
      takerAddress,
      offer: (offer ?? null) as MiniOfferPayload | null,
    },
  };

  return res.status(200).json(payload);
}
