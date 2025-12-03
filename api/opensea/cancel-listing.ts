// api/opensea/cancel-listing.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

// Canonical Seaport 1.6 contract used by OpenSea on L1 + L2s
const SEAPORT_1_6_ADDRESS =
  "0x0000000000000068f116a894984e2db1123eb395" as const;

const bodySchema = z.object({
  chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
  orderId: z.string().min(1, "Missing orderId"),
  contractAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address")
    .optional(),
  tokenId: z.string().optional(),
  sellerAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid seller address"),
});

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

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    console.error("[cancel-listing] Missing OPENSEA_API_KEY.");
    return res
      .status(500)
      .json({ ok: false, message: "Server missing OpenSea API key." });
  }

  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      const msg =
        parsed.error.errors.map((e) => e.message).join(", ") ||
        "Invalid request body.";
      return res.status(400).json({ ok: false, message: msg });
    }

    const { chain, orderId, sellerAddress, contractAddress, tokenId } =
      parsed.data;

    const chainSlug = openSeaChainSlug(chain);

    // Optional: log some context for debugging
    console.log("[cancel-listing] Request", {
      chain,
      orderId,
      sellerAddress,
      contractAddress,
      tokenId,
    });

    // OpenSea Cancel Order endpoint:
    // POST /api/v2/orders/chain/{chain}/protocol/{protocol_address}/{order_hash}/cancel
    const url = `https://api.opensea.io/api/v2/orders/chain/${chainSlug}/protocol/${SEAPORT_1_6_ADDRESS}/${orderId}/cancel`;

    const osRes = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      // Body is currently not required; send empty object in case they add fields later
      body: JSON.stringify({}),
    });

    const osJson: any = await osRes.json().catch(() => ({}));

    if (!osRes.ok) {
      console.error(
        "[cancel-listing] OpenSea error",
        osRes.status,
        osJson,
      );
      return res.status(200).json({
        ok: false,
        message:
          "OpenSea returned HTTP " +
          osRes.status +
          " while cancelling this order.",
        raw: osJson,
      });
    }

    // Success: OpenSea accepted the cancel request
    return res.status(200).json({
      ok: true,
      message:
        osJson?.message ||
        "Cancel request sent to OpenSea. It may take a moment for the listing to disappear.",
      raw: osJson,
    });
  } catch (err) {
    console.error("[cancel-listing] Unexpected error", err);
    return res.status(500).json({
      ok: false,
      message: "Unexpected server error in cancel-listing.",
    });
  }
}
