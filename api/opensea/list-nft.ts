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

    // Let seaportOrder be anything for now (we only echo it in debug).
    seaportOrder: z.any().optional(),
  })
  // allow future fields
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

  // Helper: always return a safe stub so the UI never hard-fails
  const sendStub = (extra?: Record<string, unknown>) => {
    const safe = extra ?? {};
    return res.status(200).json({
      ok: true,
      stubbed: true,
      message:
        "Listing backend is stubbed. No real OpenSea listing was created. Next step: wire this payload to OpenSea’s Create Listing API.",
      ...safe,
    });
  };

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
      ...rest
    } = parsed.data as any;

    // We *log* if API key is missing, but we don't fail here because we're stubbed.
    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      console.warn("[list-nft] OPENSEA_API_KEY is not set (stub mode only).");
    }

    const chainSlug = openSeaChainSlug(chain);
    const nowSec = Math.floor(Date.now() / 1000);
    const expirationSec = nowSec + durationDays * 24 * 60 * 60;

    const openSeaUrl = `https://api.opensea.io/api/v2/orders/${chainSlug}/seaport/listings`;

    // What we *plan* to send to OpenSea later.
    const openSeaPayload: Record<string, unknown> = {
      protocol_address: SEAPORT_1_6_ADDRESS,
      chain: chainSlug,
      contract_address: contractAddress,
      token_id: tokenId,
      maker: sellerAddress,
      price_eth: priceEth,
      duration_days: durationDays,
      listing_start: nowSec,
      listing_end: expirationSec,
      // anything else we might want to inspect:
      extra: rest,
    };

    if (seaportOrder) {
      // Just echo whatever the frontend built, so we can inspect it in logs.
      openSeaPayload.seaport_order = seaportOrder;
    }

    // CURRENT BEHAVIOUR: stub only – no OpenSea call.
    return sendStub({
      debug: {
        openSeaUrl,
        openSeaPayload,
      },
    });

    /* ---------------- REAL CALL (when you go live) ----------------
    const osRes = await fetch(openSeaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey!,
      },
      body: JSON.stringify(openSeaPayload),
    });

    const osJson = await osRes.json().catch(() => ({}));

    if (!osRes.ok) {
      console.error("[list-nft] OpenSea error", osRes.status, osJson);
      return res.status(osRes.status).json({
        ok: false,
        message:
          (osJson as any)?.message ||
          `OpenSea returned HTTP ${osRes.status} when creating listing.`,
        raw: osJson,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Listing created on OpenSea.",
      openSea: osJson,
    });
    -------------------------------------------------------------- */
  } catch (err) {
    console.error("[list-nft] Unexpected error", err);
    // Even on unexpected errors, don’t hard fail the UI – return stub.
    return sendStub({
      error: "unexpected_error",
      errorDetail: String(err),
    });
  }
}
