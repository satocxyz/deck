// api/opensea/order-components.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

// Canonical Seaport 1.6 contract used by OpenSea on L1 + L2s
const SEAPORT_1_6_ADDRESS =
  "0x0000000000000068f116a894984e2db1123eb395" as const;

const bodySchema = z.object({
  chain: z.enum(["base", "ethereum", "arbitrum", "optimism"]),
  orderId: z.string().min(1, "Missing orderId"),
  // Optional: extra safety so we only cancel if maker matches the current wallet
  expectedOfferer: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid expected offerer address")
    .optional(),
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

/**
 * Recursively convert any bigint values into decimal strings so that
 * JSON.stringify works and the frontend can safely consume it.
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
 * Case-insensitive address equality.
 */
function sameAddress(a: string | undefined | null, b: string | undefined | null): boolean {
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

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    console.error("[order-components] Missing OPENSEA_API_KEY.");
    return res
      .status(500)
      .json({ ok: false, message: "Server missing OpenSea API key." });
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

    const { chain, orderId, expectedOfferer } = parsed.data;

    const chainSlug = openSeaChainSlug(chain);

    // OpenSea "Get Order" endpoint:
    // GET /api/v2/orders/chain/{chain}/protocol/{protocol_address}/{order_hash}
    const url = `https://api.opensea.io/api/v2/orders/chain/${chainSlug}/protocol/${SEAPORT_1_6_ADDRESS}/${orderId}`;

    console.log("[order-components] Fetching order from OpenSea", {
      chain,
      chainSlug,
      orderId,
    });

    const osRes = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
    });

    const osJson: any = await osRes.json().catch(() => ({}));

    if (!osRes.ok) {
      console.error(
        "[order-components] OpenSea error",
        osRes.status,
        osJson,
      );
      // Keep HTTP 200 but ok=false so frontend can show a nice error
      return res.status(200).json({
        ok: false,
        message:
          "OpenSea returned HTTP " +
          osRes.status +
          " when fetching order components.",
        raw: osJson,
      });
    }

    // Different SDKs / examples sometimes wrap the order; handle both shapes
    const order = osJson.order ?? osJson;

    if (!order || typeof order !== "object") {
      return res.status(200).json({
        ok: false,
        message: "OpenSea Get Order response did not contain an order object.",
        raw: osJson,
      });
    }

    const protocolAddress: string | undefined = order.protocol_address;
    if (!sameAddress(protocolAddress, SEAPORT_1_6_ADDRESS)) {
      console.warn("[order-components] Non-Seaport-1.6 order", {
        protocolAddress,
      });
      return res.status(200).json({
        ok: false,
        message:
          "Order is not using the expected Seaport 1.6 protocol address.",
        raw: { protocolAddress },
      });
    }

    const protocolData = order.protocol_data ?? order.protocolData;
    if (!protocolData || typeof protocolData !== "object") {
      return res.status(200).json({
        ok: false,
        message: "Order is missing protocol_data; cannot build components.",
        raw: order,
      });
    }

    const parametersRaw = protocolData.parameters;
    if (!parametersRaw || typeof parametersRaw !== "object") {
      return res.status(200).json({
        ok: false,
        message:
          "protocol_data.parameters is missing or invalid; cannot build OrderComponents.",
        raw: protocolData,
      });
    }

    // In many OpenSea responses, parameters *already* include counter.
    // If not, try to pull it from a top-level field.
    const counter =
      (parametersRaw as any).counter ??
      (order.counter as string | number | undefined) ??
      null;

    if (counter == null) {
      console.warn(
        "[order-components] No counter found in parameters or order; this may break cancel().",
      );
      // We still proceed, but frontend might choose to bail if counter is missing.
    }

    const offerer: string | undefined = (parametersRaw as any).offerer;
    const orderHash: string | undefined = order.order_hash ?? order.orderHash;

    // Optional safety check: maker must match the connected wallet
    if (expectedOfferer && offerer && !sameAddress(expectedOfferer, offerer)) {
      console.warn("[order-components] expectedOfferer mismatch", {
        expectedOfferer,
        offerer,
        orderHash,
      });
      return res.status(200).json({
        ok: false,
        reason: "offerer_mismatch",
        message:
          "The on-chain order maker does not match the expected wallet address. Refusing to build cancel payload.",
        raw: {
          orderHash,
          offerer,
          expectedOfferer,
        },
      });
    }

    const normalizedComponents = normalizeBigInts({
      ...parametersRaw,
      counter: counter ?? (parametersRaw as any).counter,
    });

    // Don't return the whole OpenSea payload; keep it tight.
    return res.status(200).json({
      ok: true,
      seaportAddress: SEAPORT_1_6_ADDRESS,
      orderHash,
      maker: offerer ?? null,
      orderComponents: normalizedComponents,
    });
  } catch (err) {
    console.error("[order-components] Unexpected error", err);
    return res.status(500).json({
      ok: false,
      message: "Unexpected server error in order-components.",
    });
  }
}
