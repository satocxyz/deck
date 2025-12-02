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
  })
  // allow seaportOrder + any future fields to pass through
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
    } = parsed.data;

    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      console.error("[list-nft] Missing OPENSEA_API_KEY.");
      return res.status(500).json({
        ok: false,
        message: "Server missing OpenSea API key.",
      });
    }

    const chainSlug = openSeaChainSlug(chain);
    const openSeaUrl = `https://api.opensea.io/v2/orders/${chainSlug}/seaport/listings`;

    // --- NEW: pull the signed Seaport order from the body ---------------
    const anyData = parsed.data as any;
    const seaportOrder = anyData.seaportOrder;

    if (
      !seaportOrder ||
      !seaportOrder.parameters ||
      !seaportOrder.signature
    ) {
      console.error("[list-nft] Missing seaportOrder in request body", {
        hasSeaportOrder: !!seaportOrder,
      });
      return res.status(400).json({
        ok: false,
        message:
          "Missing Seaport order from client. Please refresh and try listing again.",
      });
    }

    // protocol address can come from client or we default to Seaport 1.6
    const protocolAddress =
      seaportOrder.protocolAddress ??
      seaportOrder.protocol_address ??
      SEAPORT_1_6_ADDRESS;

    // This is the exact shape OpenSea expects:
    // { parameters: {...}, signature: "0x...", protocol_address: "0x..." }
    const openSeaPayload = {
      parameters: seaportOrder.parameters,
      signature: seaportOrder.signature,
      protocol_address: protocolAddress,
    };

    // Optional: log a tiny debug summary, not full payload
    console.log("[list-nft] Creating listing on OpenSea", {
      chainSlug,
      contractAddress,
      tokenId,
      priceEth,
      durationDays,
      sellerAddress,
      protocolAddress,
    });

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
      return res.status(osRes.status).json({
        ok: false,
        message:
          osJson?.message ||
          `OpenSea returned HTTP ${osRes.status} when creating listing.`,
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
      message: "Unexpected server error while creating listing.",
    });
  }
}
