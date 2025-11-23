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
  offer: MiniOfferPayload | null;

  // NEW: needed to call OpenSea fulfillment API
  contractAddress?: string;     // NFT contract
  tokenId?: string;             // NFT token id
  protocolAddress?: string;     // Seaport / protocol address (can come from best-offer)
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
    contractAddress?: string;
    tokenId?: string;
    protocolAddress?: string;
  };
  tx?: {
    to: string;
    data: string;
    value: string; // hex or decimal string
  };
  // Optional raw OpenSea payload so you can inspect in DevTools
  openSeaRaw?: unknown;
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
    offer,
    contractAddress,
    tokenId,
    protocolAddress,
  } = req.body as Partial<FulfillmentRequestBody>;

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
        chain: chain as any,
        orderHash: orderHash as any,
        takerAddress,
        offer: (offer ?? null) as MiniOfferPayload | null,
        contractAddress,
        tokenId,
        protocolAddress,
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
        orderHash: orderHash as any,
        takerAddress,
        offer: (offer ?? null) as MiniOfferPayload | null,
        contractAddress,
        tokenId,
        protocolAddress,
      },
    };
    return res.status(400).json(payload);
  }

  const baseEcho: FulfillmentResponse["echo"] = {
    chain,
    orderHash,
    takerAddress,
    offer: (offer ?? null) as MiniOfferPayload | null,
    contractAddress,
    tokenId,
    protocolAddress,
  };

  // Flags:
  const enableTestTx = process.env.DECK_ENABLE_TEST_TX === "true";
  const enableRealFulfillment =
    process.env.DECK_ENABLE_OS_FULFILLMENT === "true";

  // =====================================================
  // MODE 1: Test transaction (0 ETH to your own address)
  // =====================================================
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
      echo: baseEcho,
      tx,
    };

    return res.status(200).json(payload);
  }

  // =====================================================
  // MODE 2: Real OpenSea fulfillment (behind env flag)
  // =====================================================
  if (enableRealFulfillment) {
    // Extra validation only needed when we actually call OpenSea
    if (!takerAddress || typeof takerAddress !== "string") {
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "bad_request",
        message: "Missing or invalid 'takerAddress'.",
        echo: baseEcho,
      };
      return res.status(400).json(payload);
    }

    if (!contractAddress || !tokenId) {
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "bad_request",
        message:
          "Missing 'contractAddress' or 'tokenId' for fulfillment consideration.",
        echo: baseEcho,
      };
      return res.status(400).json(payload);
    }

    const apiKey = process.env.OPENSEA_API_KEY;
    const baseUrl =
      process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

    if (!apiKey) {
      console.error("Missing OPENSEA_API_KEY");
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "server_misconfigured",
        message: "OpenSea API key is not configured on the server.",
        echo: baseEcho,
      };
      return res.status(500).json(payload);
    }

    // chain string OpenSea expects (docs use "ethereum" / "base" etc.)
    const osChain = chain === "base" ? "base" : "ethereum";

    // Prefer protocol_address from request, otherwise from env per chain
    const resolvedProtocolAddress =
      protocolAddress ||
      (chain === "base"
        ? process.env.OPENSEA_SEAPORT_BASE
        : process.env.OPENSEA_SEAPORT_MAINNET);

    if (!resolvedProtocolAddress) {
      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "server_misconfigured",
        message:
          "Missing protocolAddress (Seaport address). Pass it from the client or configure OPENSEA_SEAPORT_BASE / OPENSEA_SEAPORT_MAINNET.",
        echo: baseEcho,
      };
      return res.status(500).json(payload);
    }

    try {
      // -------- Build body as per docs screenshot --------
      const body = {
        offer: {
          hash: orderHash,
          chain: osChain,
          protocol_address: resolvedProtocolAddress,
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

      const url = `${baseUrl}/offers/fulfillment_data`; // <--- CONFIRM path with docs

      const osRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify(body),
      });

      const osJson = await osRes.json().catch(() => null);

      if (!osRes.ok) {
        console.error("OpenSea fulfillment error", osRes.status, osJson);

        const payload: FulfillmentResponse = {
          ok: false,
          safeToFill: false,
          reason: "opensea_error",
          message:
            (osJson as any)?.message ||
            `OpenSea fulfillment request failed with status ${osRes.status}.`,
          echo: baseEcho,
          openSeaRaw: osJson ?? undefined,
        };
        return res.status(200).json(payload);
      }

      // -------- Extract transaction from OpenSea response --------
      // IMPORTANT: You MUST confirm the exact keys with the docs
      // (typically something like osJson.fulfillment_data.transaction).
      const txSource: any =
        (osJson as any)?.fulfillment_data?.transaction ??
        (osJson as any)?.transaction ??
        null;

      if (
        !txSource ||
        typeof txSource.to !== "string" ||
        typeof txSource.data !== "string"
      ) {
        const payload: FulfillmentResponse = {
          ok: false,
          safeToFill: false,
          reason: "opensea_bad_payload",
          message:
            "OpenSea fulfillment response did not contain a usable transaction. Check openSeaRaw for details.",
          echo: baseEcho,
          openSeaRaw: osJson,
        };
        return res.status(200).json(payload);
      }

      const valueStr =
        typeof txSource.value === "string" || typeof txSource.value === "number"
          ? String(txSource.value)
          : "0";

      const tx = {
        to: txSource.to as string,
        data: txSource.data as string,
        value: valueStr,
      };

      const payload: FulfillmentResponse = {
        ok: true,
        safeToFill: true,
        reason: "ready_to_fill",
        message:
          "Offer fulfillment data retrieved successfully. You can now submit this transaction from the client.",
        echo: baseEcho,
        tx,
        openSeaRaw: osJson,
      };

      return res.status(200).json(payload);
    } catch (err) {
      console.error("Unexpected error calling OpenSea fulfillment", err);

      const payload: FulfillmentResponse = {
        ok: false,
        safeToFill: false,
        reason: "internal_error",
        message: "Unexpected error while contacting OpenSea.",
        echo: baseEcho,
      };
      return res.status(500).json(payload);
    }
  }

  // =====================================================
  // MODE 3: Default stub (no real tx)
  // =====================================================
  const payload: FulfillmentResponse = {
    ok: true,
    safeToFill: false,
    reason: "not_implemented",
    message:
      "Accepting offers is not enabled yet in Deck. This endpoint is a stub for future integrations. No transaction will be created.",
    echo: baseEcho,
  };

  return res.status(200).json(payload);
}
