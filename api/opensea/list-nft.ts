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
    // frontend sends this: { protocolAddress, parameters, components, signature }
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

// Canonical Seaport 1.6 contract used by OpenSea
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

    // --- Validate / normalize seaportOrder from frontend -------------------
    if (!seaportOrder || typeof seaportOrder !== "object") {
      return res.status(400).json({
        ok: false,
        message:
          "Missing or invalid seaportOrder. Frontend must send the signed Seaport order.",
      });
    }

    const protocolAddress: string =
      seaportOrder.protocol_address ??
      seaportOrder.protocolAddress ??
      SEAPORT_1_6_ADDRESS;

    if (
      typeof protocolAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(protocolAddress)
    ) {
      return res.status(400).json({
        ok: false,
        message: "Missing or invalid protocol_address for Seaport.",
      });
    }

    // Prefer components (OrderComponents with counter), else parameters
    const orderParameters =
      seaportOrder.components ?? seaportOrder.parameters;

    if (!orderParameters || typeof orderParameters !== "object") {
      return res.status(400).json({
        ok: false,
        message:
          "Missing Seaport order parameters. Expected components or parameters on seaportOrder.",
      });
    }

    const signature: string | undefined = seaportOrder.signature;
    if (
      !signature ||
      typeof signature !== "string" ||
      !signature.startsWith("0x")
    ) {
      return res.status(400).json({
        ok: false,
        message:
          "Missing or invalid Seaport signature on seaportOrder.signature.",
      });
    }

    const chainSlug = openSeaChainSlug(chain);
    const openSeaUrl = `https://api.opensea.io/api/v2/orders/${chainSlug}/seaport/listings`;

    // This shape matches how orders are returned from OpenSea,
    // and what their docs expect for Create Listing.
    const openSeaPayload: any = {
      parameters: orderParameters,
      signature,
      protocol_address: protocolAddress,
      // optional metadata – not required but nice to send
      listing: {
        chain: chainSlug,
        contract_address: contractAddress,
        token_id: tokenId,
        price: priceEth,
        duration_days: durationDays,
        seller_address: sellerAddress,
      },
    };

    const osRes = await fetch(openSeaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(openSeaPayload),
    });

    const osJson: any = await osRes.json().catch(() => ({}));

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
      message:
        "Unexpected server error while creating listing. Check server logs.",
    });
  }
}
