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
  takerAddress?: string;
  contractAddress?: string;
  tokenId?: string;
  protocolAddress?: string;
  offer: MiniOfferPayload | null;
};

type FulfillmentResponse = {
  ok: boolean;
  safeToFill: boolean;
  reason?: string;
  message?: string;
  echo: {
    chain: string | undefined;
    orderHash: string | undefined;
    takerAddress?: string;
    contractAddress?: string;
    tokenId?: string;
    protocolAddress?: string;
    offer: MiniOfferPayload | null;
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
    takerAddress,
    contractAddress,
    tokenId,
    protocolAddress,
    offer,
  } = req.body as Partial<FulfillmentRequestBody>;

  const echoBase = {
    chain,
    orderHash,
    takerAddress,
    contractAddress,
    tokenId,
    protocolAddress,
    offer: (offer ?? null) as MiniOfferPayload | null,
  };

  // -------------------------------
  // Basic validation
  // -------------------------------
  if (chain !== "base" && chain !== "ethereum") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "bad_request",
      message: "Invalid or missing 'chain'. Expected 'base' or 'ethereum'.",
      echo: echoBase,
    };
    return res.status(400).json(payload);
  }

  if (!orderHash || typeof orderHash !== "string") {
    const payload: FulfillmentResponse = {
      ok: false,
      safeToFill: false,
      reason: "bad_request",
      message: "Missing or invalid 'orderHash'.",
      echo: echoBase,
    };
    return res.status(400).json(payload);
  }

  const enableReal = process.env.DECK_ENABLE_REAL_FULFILLMENT === "true";
  const enableTest = process.env.DECK_ENABLE_TEST_TX === "true";

  // -------------------------------------------------------------------
  // REAL OpenSea fulfillment (gated behind DECK_ENABLE_REAL_FULFILLMENT)
  // -------------------------------------------------------------------
  if (enableReal) {
    if (!takerAddress || !contractAddress || !tokenId || !protocolAddress) {
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "bad_request",
        message:
          "Missing takerAddress, contractAddress, tokenId or protocolAddress for real fulfillment.",
        echo: echoBase,
      };
      return res.status(400).json(payload);
    }

    const apiKey = process.env.OPENSEA_API_KEY;
    const baseUrl =
      process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

    if (!apiKey) {
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "server_misconfigured",
        message: "OPENSEA_API_KEY is not set on the server.",
        echo: echoBase,
      };
      return res.status(500).json(payload);
    }

    try {
      // NOTE: path based on OpenSea v2 docs (offer fulfillment data v2).
      // If they ever change it, this will just fail safely.
      const chainSlug = chain === "base" ? "base" : "ethereum";
      const url = `${baseUrl}/offers/${chainSlug}/fulfillment_data`;

      const body = {
        offer: {
          hash: orderHash,
          chain: chainSlug,
          protocol_address: protocolAddress,
        },
        fulfiller: {
          address: takerAddress,
        },
        consideration: {
          asset_contract_address: contractAddress,
          token_id: tokenId,
        },
        // single NFT
        units_to_fill: 1,
      };

      const osRes = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify(body),
      });

      const text = await osRes.text();
      let osJson: any = null;
      try {
        osJson = text ? JSON.parse(text) : null;
      } catch {
        // leave osJson = null
      }

      if (!osRes.ok) {
        console.error(
          "[OpenSea fulfillment error]",
          osRes.status,
          osRes.statusText,
          text,
        );
        const payload: FulfillmentResponse = {
          ok: false,
          safeToFill: false,
          reason: "opensea_error",
          message:
            osJson?.message ||
            `OpenSea fulfillment failed with status ${osRes.status}.`,
          echo: echoBase,
        };
        return res.status(200).json(payload);
      }

      const txObj =
        osJson?.fulfillment_data?.transaction ??
        osJson?.fulfillment_data?.fulfillment_data?.transaction ??
        null;

      const to: string | undefined = txObj?.to;
      const data: string | undefined = txObj?.data ?? txObj?.calldata;
      const value: string =
        typeof txObj?.value === "string"
          ? txObj.value
          : txObj?.value != null
          ? String(txObj.value)
          : "0";

      if (!to || !data) {
        console.error("[OpenSea fulfillment] Missing to/data in response", txObj);
        const payload: FulfillmentResponse = {
          ok: false,
          safeToFill: false,
          reason: "invalid_opensea_response",
          message:
            "OpenSea fulfillment response did not include transaction 'to' or 'data'.",
          echo: echoBase,
        };
        return res.status(200).json(payload);
      }

      const payload: FulfillmentResponse = {
        ok: true,
        safeToFill: true,
        reason: "ready",
        message: "Offer is safe to fill. Transaction created from OpenSea.",
        echo: echoBase,
        tx: {
          to,
          data,
          value,
        },
      };

      return res.status(200).json(payload);
    } catch (err) {
      console.error("[OpenSea fulfillment] Unexpected error", err);
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "opensea_exception",
        message: "Unexpected error while contacting OpenSea for fulfillment.",
        echo: echoBase,
      };
      return res.status(200).json(payload);
    }
  }

  // -------------------------------
  // Test mode: self-tx with 0 value
  // -------------------------------
  if (enableTest && takerAddress) {
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
      echo: echoBase,
      tx,
    };

    return res.status(200).json(payload);
  }

  // -------------------------------
  // Default: not implemented
  // -------------------------------
  const payload: FulfillmentResponse = {
    ok: true,
    safeToFill: false,
    reason: "not_implemented",
    message:
      "Accepting offers is not enabled yet in Deck. This endpoint is a stub for future integrations. No transaction will be created.",
    echo: echoBase,
  };

  return res.status(200).json(payload);
}
