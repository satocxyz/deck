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

    // full Seaport order you built on the client & signed
    seaportOrder: z.any(),
  })
  // allow any future fields
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
    const nowSec = Math.floor(Date.now() / 1000);
    const expirationSec = nowSec + durationDays * 24 * 60 * 60;

    // Just for debugging / sanity
    console.log("[list-nft] incoming params", {
      chainSlug,
      contractAddress,
      tokenId,
      priceEth,
      durationDays,
      sellerAddress,
    });

    // IMPORTANT: use the documented path with /api/v2
    const openSeaUrl = `https://api.opensea.io/api/v2/orders/${chainSlug}/seaport/listings`;

    // This matches OpenSea "Create Listing" using a full Seaport order
    const openSeaPayload: any = {
      protocol_address: SEAPORT_1_6_ADDRESS,
      protocol_data: {
        ...seaportOrder,
        parameters: {
          ...seaportOrder.parameters,
          // Make sure price & times line up with UI
          startTime: nowSec.toString(),
          endTime: expirationSec.toString(),
        },
      },
      order_type: "listing",
      side: "ask",
    };

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
      console.error(
        "[list-nft] OpenSea error",
        osRes.status,
        JSON.stringify(osJson),
      );
      return res.status(400).json({
        ok: false,
        message: `OpenSea returned HTTP ${osRes.status} when creating listing.`,
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
      message: "Unexpected error while creating listing.",
    });
  }
}
