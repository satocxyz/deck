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

/**
 * Recursively convert any bigint values into decimal strings so that
 * JSON.stringify works and OpenSea gets the expected format.
 */
function normalizeBigInts(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((v) => normalizeBigInts(v));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeBigInts(v);
    }
    return out;
  }

  return value;
}

/**
 * Case-insensitive address equality (0x-prefixed, 20 bytes).
 */
function sameAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
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

    if (!seaportOrder || typeof seaportOrder !== "object") {
      return res.status(400).json({
        ok: false,
        message: "Missing or invalid seaportOrder payload.",
      });
    }

    const chainSlug = openSeaChainSlug(chain);
    const openSeaUrl = `https://api.opensea.io/api/v2/orders/${chainSlug}/seaport/listings`;

    const protocolAddress =
      seaportOrder.protocolAddress ?? SEAPORT_1_6_ADDRESS;

    // from client: parameters (no counter) + components (with counter)
    const rawParams = (seaportOrder.parameters ?? {}) as Record<string, any>;
    const components = (seaportOrder.components ?? {}) as Record<string, any>;

    const counter = rawParams.counter ?? components.counter ?? "0";

    if (counter == null) {
      return res.status(400).json({
        ok: false,
        message:
          "seaportOrder is missing counter; cannot send to OpenSea.",
      });
    }

    // Build final parameters = OrderComponents JSON
    const parameters: Record<string, any> = {
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

    // --- Sanity checks to make sure the signed order matches the UI intent ---
    try {
      const offerArray = parameters.offer as any[] | undefined;
      const firstOffer = Array.isArray(offerArray) ? offerArray[0] : undefined;

      const offerer = parameters.offerer as string | undefined;

      if (!sameAddress(offerer, sellerAddress)) {
        return res.status(400).json({
          ok: false,
          message:
            "Offerer in seaportOrder does not match sellerAddress. Refusing to list.",
        });
      }

      if (firstOffer) {
        const offerToken = firstOffer.token as string | undefined;
        const offerId = String(firstOffer.identifierOrCriteria ?? "");

        if (!sameAddress(offerToken, contractAddress)) {
          return res.status(400).json({
            ok: false,
            message:
              "Offer token address does not match requested contractAddress.",
          });
        }

        // Compare as strings to avoid bigint vs string mismatch
        const expectedTokenId = String(tokenId);
        if (offerId !== expectedTokenId) {
          return res.status(400).json({
            ok: false,
            message:
              "Offer tokenId does not match requested tokenId.",
          });
        }
      } else {
        console.warn(
          "[list-nft] seaportOrder.parameters.offer is missing or empty.",
        );
      }
    } catch (e) {
      console.warn(
        "[list-nft] Failed sanity-checking seaportOrder against request body",
        e,
      );
      // Fail closed to be safe
      return res.status(400).json({
        ok: false,
        message:
          "Unable to validate seaportOrder against NFT details. Listing aborted.",
      });
    }

    // Normalize all bigint fields to strings for JSON + OpenSea
    const normalizedParameters = normalizeBigInts(parameters);

    const openSeaPayload = {
      parameters: normalizedParameters,
      signature,
      protocol_address: protocolAddress,
    };

    // Optional: sanity log (avoid logging full payload with signature)
    console.log("[list-nft] OpenSea listing payload summary", {
      chain,
      contractAddress,
      tokenId,
      sellerAddress,
      protocolAddress,
      samplePriceEth: priceEth,
      durationDays,
      parametersSummary: {
        offerer: (parameters as any).offerer,
        conduitKey: (parameters as any).conduitKey,
        startTime: (parameters as any).startTime,
        endTime: (parameters as any).endTime,
        counter: (parameters as any).counter,
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
      // Keep 200 here so frontend just checks ok=false, like your original.
      return res.status(200).json({
        ok: false,
        message:
          "OpenSea returned HTTP " + osRes.status + " when creating listing.",
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
