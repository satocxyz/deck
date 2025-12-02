// api/opensea/list-nft.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const chainEnum = z.enum(["base", "ethereum", "arbitrum", "optimism"]);

const addressRegex = /^0x[a-fA-F0-9]{40}$/;

// We keep seaportOrder optional so the endpoint is backwards-compatible.
const bodySchema = z
  .object({
    chain: chainEnum,
    contractAddress: z
      .string()
      .regex(addressRegex, "Invalid contract address"),
    tokenId: z.string().min(1, "Missing tokenId"),
    priceEth: z.number().positive("Price must be > 0"),
    durationDays: z.number().int().positive("Duration must be > 0"),
    sellerAddress: z
      .string()
      .regex(addressRegex, "Invalid seller address"),

    // Optional Seaport order that the frontend now sends
    seaportOrder: z
      .object({
        protocolAddress: z
          .string()
          .regex(addressRegex, "Invalid protocolAddress")
          .optional(),
        parameters: z.record(z.any()).optional(),
        components: z.record(z.any()).optional(),
        signature: z.string().min(1).optional(),
      })
      .optional(),
  })
  // allow future fields without breaking
  .passthrough();

function openSeaChainSlug(chain: z.infer<typeof chainEnum>): string {
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ...rest // any future fields from the client
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

    const openSeaUrl = `https://api.opensea.io/api/v2/orders/${chainSlug}/seaport/listings`;

    // This is what we *plan* to send to OpenSea in the future.
    // For now, it’s only returned in debug so we can inspect it safely.
    const openSeaPayload: Record<string, unknown> = {
      // These high-level fields are NOT fully documented yet, so keep them in debug.
      protocol_address:
        (seaportOrder?.protocolAddress as string | undefined) ??
        SEAPORT_1_6_ADDRESS,
      chain: chainSlug,
      contract_address: contractAddress,
      token_id: tokenId,
      maker: sellerAddress,
      // for convenience / debugging:
      price_eth: priceEth,
      duration_days: durationDays,
      listing_start: nowSec,
      listing_end: expirationSec,
    };

    if (seaportOrder?.parameters && seaportOrder?.signature) {
      // This matches how Seaport orders appear in OpenSea Stream / Get Order
      // responses (protocol_data.parameters + protocol_data.signature).
      openSeaPayload.protocol_data = {
        parameters: seaportOrder.parameters,
        signature: seaportOrder.signature,
      };
    } else if (seaportOrder) {
      // We got a seaportOrder but it’s incomplete – useful to see in debug.
      openSeaPayload.partial_seaport_order = seaportOrder;
    }

    // -----------------------------------------------------------------------
    // CURRENT BEHAVIOUR: stub only – no real OpenSea call.
    // The UI should show a friendly “listing not live yet” message.
    // -----------------------------------------------------------------------
    return res.status(200).json({
      ok: true,
      stubbed: true,
      message:
        "Listing flow isn’t live yet in Deck. No on-chain listing was created – this is just a preview of the payload we’ll send to OpenSea later.",
      debug: {
        openSeaUrl,
        openSeaPayload,
      },
    });

    /* ----------------------------------------------------------------------
    // REAL CALL (when you’re ready to go live):
    //
    // 1. Replace the early return above with this block.
    // 2. Carefully shape `openSeaPayload` to match the official
    //    Create Listing request body in the OpenSea docs.
    //
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
    ---------------------------------------------------------------------- */
  } catch (err) {
    console.error("[list-nft] Unexpected error", err);
    // Don’t reference openSeaUrl/openSeaPayload here – they might not exist
    return res.status(500).json({
      ok: false,
      message: "Unexpected server error while preparing listing.",
    });
  }
}
