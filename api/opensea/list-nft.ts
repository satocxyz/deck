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
  // allow seaportOrder and future fields
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

  let openSeaUrl: string | null = null;
  let openSeaPayload: any | null = null;

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
      // seaportOrder & any extra fields are in parsed.data because of .passthrough()
    } = parsed.data as any;

    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      console.error("[list-nft] Missing OPENSEA_API_KEY.");
      return res.status(500).json({
        ok: false,
        message: "Server missing OpenSea API key.",
      });
    }

    /**
     * We expect the client to send:
     *  seaportOrder: {
     *    protocolAddress?: string;
     *    components: OrderComponents; // includes counter
     *    signature: string;
     *  }
     *
     * components is what OpenSea expects as "parameters" in the body.
     */
    const seaportOrder = (parsed.data as any).seaportOrder;

    if (!seaportOrder || typeof seaportOrder !== "object") {
      return res.status(400).json({
        ok: false,
        message:
          "Missing seaportOrder in request body. Build & sign a Seaport 1.6 order on the client and include it as seaportOrder.",
      });
    }

    const { components, signature, protocolAddress } = seaportOrder as any;

    if (!components || typeof components !== "object") {
      return res.status(400).json({
        ok: false,
        message:
          "Invalid seaportOrder: missing components (OrderComponents with counter).",
      });
    }

    if (!signature || typeof signature !== "string") {
      return res.status(400).json({
        ok: false,
        message: "Invalid seaportOrder: missing signature.",
      });
    }

    const chainSlug = openSeaChainSlug(chain);
    const protocol =
      (protocolAddress as string | undefined)?.toLowerCase() ??
      SEAPORT_1_6_ADDRESS.toLowerCase();

    // Real Create Listing endpoint
    openSeaUrl = `https://api.opensea.io/api/v2/orders/${chainSlug}/${protocol}/listings`;

    // Minimal payload OpenSea expects: Seaport order parameters + signature
    openSeaPayload = {
      parameters: components,
      signature,
    };

    const osRes = await fetch(openSeaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(openSeaPayload),
    });

    const osJson = await osRes.json().catch(() => ({} as any));

    if (!osRes.ok) {
      console.error(
        "[list-nft] OpenSea Create Listing error",
        osRes.status,
        osJson,
      );

      const msgFromErrors =
        Array.isArray((osJson as any)?.errors) &&
        (osJson as any).errors.join(", ");

      const message =
        (osJson as any)?.message ||
        msgFromErrors ||
        `OpenSea returned HTTP ${osRes.status} while creating listing.`;

      // Surface OpenSea’s message to the mini app so you can see
      // things like “You have not provided all required creator fees.”
      return res.status(osRes.status === 400 ? 400 : 502).json({
        ok: false,
        message,
        openSeaStatus: osRes.status,
        openSeaBody: osJson,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Listing created on OpenSea.",
      openSea: osJson,
    });
  } catch (err) {
    console.error("[list-nft] Unexpected error", err, {
      openSeaUrl,
      // don’t log full payload; just shape
      hasPayload: !!openSeaPayload,
    });

    return res.status(500).json({
      ok: false,
      message: "Unexpected server error while creating listing.",
    });
  }
}
