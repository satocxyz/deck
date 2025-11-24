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
  contractAddress: string;
  tokenId: string;
  protocolAddress: string;
  takerAddress?: string;
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
    contractAddress?: string;
    tokenId?: string;
    protocolAddress?: string;
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

  const {
    chain,
    orderHash,
    contractAddress,
    tokenId,
    protocolAddress,
    takerAddress,
    offer,
  } = req.body as Partial<FulfillmentRequestBody>;

  const enableReal =
    process.env.DECK_ENABLE_REAL_FULFILLMENT === "true";
  const enableTestTx = process.env.DECK_ENABLE_TEST_TX === "true";

  // -------------------------------
  // Basic validation
  // -------------------------------
  if (chain !== "base" && chain !== "ethereum") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "bad_request",
      message: "Invalid or missing 'chain'. Expected 'base' or 'ethereum'.",
      echo: {
        chain: chain ?? "",
        orderHash: orderHash ?? "",
        contractAddress,
        tokenId,
        protocolAddress,
        takerAddress,
        offer: (offer ?? null) as MiniOfferPayload | null,
      },
    };
    return res.status(400).json(payload);
  }

  if (!orderHash || typeof orderHash !== "string") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "bad_request",
      message: "Missing or invalid 'orderHash'.",
      echo: {
        chain,
        orderHash: orderHash ?? "",
        contractAddress,
        tokenId,
        protocolAddress,
        takerAddress,
        offer: (offer ?? null) as MiniOfferPayload | null,
      },
    };
    return res.status(400).json(payload);
  }

  // ------------------------------------------------------------------
  // REAL OpenSea fulfillment – *only* when DECK_ENABLE_REAL_FULFILLMENT=true
  // ------------------------------------------------------------------
  if (enableReal) {
    if (
      !takerAddress ||
      !contractAddress ||
      !tokenId ||
      !protocolAddress
    ) {
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "bad_request",
        message:
          "Missing takerAddress, contractAddress, tokenId or protocolAddress for real fulfillment.",
        echo: {
          chain,
          orderHash,
          contractAddress,
          tokenId,
          protocolAddress,
          takerAddress,
          offer: (offer ?? null) as MiniOfferPayload | null,
        },
      };
      return res.status(400).json(payload);
    }

    const apiKey = process.env.OPENSEA_API_KEY;
    const baseUrl =
      process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

    if (!apiKey) {
      console.error("Missing OPENSEA_API_KEY in real fulfillment");
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "server_misconfigured",
        message: "Server is missing OPENSEA_API_KEY.",
        echo: {
          chain,
          orderHash,
          contractAddress,
          tokenId,
          protocolAddress,
          takerAddress,
          offer: (offer ?? null) as MiniOfferPayload | null,
        },
      };
      return res.status(500).json(payload);
    }

    try {
      const url = `${baseUrl}/offers/fulfillment_data`;

      const osBody = {
        offer: {
          hash: orderHash,
          chain,
          protocol_address: protocolAddress,
        },
        fulfiller: {
          address: takerAddress,
        },
        consideration: {
          asset_contract_address: contractAddress,
          token_id: tokenId,
        },
        units_to_fill: 1,
      };

      const osRes = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify(osBody),
      });

      if (!osRes.ok) {
        const text = await osRes.text();
        console.error(
          "OpenSea fulfillment_data error",
          osRes.status,
          text,
        );

        const payload: FulfillmentResponse = {
          ok: false,
          safeToFill: false,
          reason: "opensea_error",
          message:
            "OpenSea fulfillment_data request failed. Check server logs for details.",
          echo: {
            chain,
            orderHash,
            contractAddress,
            tokenId,
            protocolAddress,
            takerAddress,
            offer: (offer ?? null) as MiniOfferPayload | null,
          },
        };
        return res.status(502).json(payload);
      }

      const osJson = (await osRes.json()) as any;
      console.log("OpenSea fulfillment_data response", osJson);

      // Try to be flexible with response shape
      const txData =
        osJson?.fulfillment_data?.transaction ??
        osJson?.transaction ??
        null;

      if (
        !txData ||
        typeof txData.to !== "string" ||
        typeof txData.data !== "string"
      ) {
        const payload: FulfillmentResponse = {
          ok: false,
          safeToFill: false,
          reason: "malformed_opensea_response",
          message:
            "OpenSea did not return a valid transaction object in fulfillment_data.",
          echo: {
            chain,
            orderHash,
            contractAddress,
            tokenId,
            protocolAddress,
            takerAddress,
            offer: (offer ?? null) as MiniOfferPayload | null,
          },
        };
        return res.status(502).json(payload);
      }

      const tx = {
        to: txData.to,
        data: txData.data,
        value: txData.value ?? "0",
      };

      const payload: FulfillmentResponse = {
        ok: true,
        safeToFill: true,
        reason: "opensea_fulfillment_ok",
        message: "Offer can be safely filled with the returned transaction.",
        echo: {
          chain,
          orderHash,
          contractAddress,
          tokenId,
          protocolAddress,
          takerAddress,
          offer: (offer ?? null) as MiniOfferPayload | null,
        },
        tx,
      };

      return res.status(200).json(payload);
    } catch (err) {
      console.error("Unexpected error in real fulfillment:", err);
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "internal_error",
        message:
          "Internal server error while talking to OpenSea fulfillment API.",
        echo: {
          chain,
          orderHash,
          contractAddress,
          tokenId,
          protocolAddress,
          takerAddress,
          offer: (offer ?? null) as MiniOfferPayload | null,
        },
      };
      return res.status(500).json(payload);
    }
  }

  // -------------------------------
  // Test transaction mode (0-value tx to self)
  // -------------------------------
  if (enableTestTx && takerAddress) {
    const tx = {
      to: takerAddress,
      data: "0x",
      value: "0",
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
        contractAddress,
        tokenId,
        protocolAddress,
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
      chain: chain ?? "",
      orderHash: orderHash ?? "",
      contractAddress,
      tokenId,
      protocolAddress,
      takerAddress,
      offer: (offer ?? null) as MiniOfferPayload | null,
    },
  };

  return res.status(200).json(payload);
}
