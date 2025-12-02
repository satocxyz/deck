// api/opensea/list-nft.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const bodySchema = z
  .object({
    chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
    contractAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address"),
    tokenId: z.string().min(1, "Missing tokenId"),
    priceEth: z.number().positive("Price must be > 0"),
    durationDays: z.number().int().positive("Duration must be > 0"),
    sellerAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid seller address"),
    // we don’t deeply validate, just require it to exist
    seaportOrder: z.any(),
  })

  .passthrough();

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

// Seaport 1.6 canonical address used by OpenSea
const SEAPORT_1_6_ADDRESS =
  "0x0000000000000068f116a894984e2db1123eb395" as const;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ ok: false, message: "Method not allowed. Use POST." });
  }

  try {
    if (!req.body) {
      return res
        .status(400)
        .json({ ok: false, message: "Missing JSON body." });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      const msg =
        parsed.error.errors.map((e) => e.message).join(", ") ||
        "Invalid request body.";
      return res.status(400).json({ ok: false, message: msg });
    }

    const {
      chain,
      contractAddress,
      tokenId,
      priceEth,
      durationDays,
      sellerAddress,
      seaportOrder,
    } = parsed.data as any;

    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      console.error("[list-nft] Missing OPENSEA_API_KEY.");
      return res.status(500).json({
        ok: false,
        message: "Server missing OpenSea API key.",
      });
    }

    const chainSlug = openSeaChainSlug(chain);
    const openSeaUrl = `https://api.opensea.io/api/v2/orders/${chainSlug}/seaport/listings`;

    // --- Extract + normalize order for OpenSea ----------------------------

    if (!seaportOrder || typeof seaportOrder !== "object") {
      return res.status(400).json({
        ok: false,
        message: "Missing or invalid seaportOrder payload.",
      });
    }

    const protocolAddress =
      seaportOrder.protocolAddress ?? SEAPORT_1_6_ADDRESS;

    // from client: parameters (no counter) + components (with counter)
    const rawParams = (seaportOrder.parameters ?? {}) as Record<string, any>;
    const components = (seaportOrder.components ?? {}) as Record<string, any>;

    const counter =
      rawParams.counter ?? components.counter ?? "0";

    if (counter == null) {
      return res.status(400).json({
        ok: false,
        message:
          "seaportOrder is missing counter; cannot send to OpenSea.",
      });
    }

    // Build final parameters = OrderComponents JSON
    const parameters = {
      ...rawParams,
      counter,
    };

    const signature = seaportOrder.signature;
    if (!signature || typeof signature !== "string") {
      return res.status(400).json({
        ok: false,
        message: "seaportOrder.signature is required.",
      });
    }

    const openSeaPayload = {
      parameters,
      signature,
      protocol_address: protocolAddress,
    };

    // Optional: sanity check for debugging
    console.log("[list-nft] OpenSea listing payload", {
      chain,
      contractAddress,
      tokenId,
      sellerAddress,
      protocolAddress,
      samplePriceEth: priceEth,
      parametersSummary: {
        offerer: parameters.offerer,
        conduitKey: parameters.conduitKey,
        startTime: parameters.startTime,
        endTime: parameters.endTime,
        counter: parameters.counter,
      },
    });

    // --- Real OpenSea call -----------------------------------------------

    const osRes = await fetch(openSeaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(openSeaPayload),
    });

    const osJson = await osRes.json().catch(() => ({}));

    if (!osRes.ok) {
      console.error("[list-nft] OpenSea error", osRes.status, osJson);
      return res.status(200).json({
        ok: false,
        message: "OpenSea returned HTTP " + osRes.status + " when creating listing.",
        raw: osJson,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Listing created on OpenSea.",
      openSea: osJson,
    });
  } catch (err) {
    console.error("[list-nft] Unexpected error", err);
    return res.status(500).json({
      ok: false,
      message: "Unexpected server error in list-nft.",
    });
  }
}
