// api/opensea/fulfillment.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type Chain = "base" | "ethereum";

type ClientOffer = {
  priceEth: number;
  priceFormatted: string;
  expirationTime: number | null; // unix seconds from OpenSea
};

type FulfillmentResult = {
  ok: boolean;
  safeToFill: boolean;
  reason: string | null;
  message: string;
  echo: {
    chain: Chain | string | null;
    orderHash: string | null;
    offer: ClientOffer | null;
  };
  diagnostics?: {
    now: number;
    secondsUntilExpiry: number | null;
    netPayoutEth: number | null;
    openseaFeeBps: number;
  };
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ ok: false, safeToFill: false, reason: "method_not_allowed", message: "Only POST is allowed", echo: null });
  }

  try {
    let body: any = req.body;

    // Vercel can sometimes give us a string body
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        const payload: FulfillmentResult = {
          ok: false,
          safeToFill: false,
          reason: "bad_request",
          message: "Request body must be valid JSON",
          echo: {
            chain: null,
            orderHash: null,
            offer: null,
          },
        };
        return res.status(400).json(payload);
      }
    }

    const chain = body?.chain as Chain | string | undefined;
    const orderHash = body?.orderHash as string | undefined;
    const offer = body?.offer as ClientOffer | undefined;

    const echo = {
      chain: chain ?? null,
      orderHash: orderHash ?? null,
      offer: offer ?? null,
    };

    const errors: string[] = [];

    // ------------ Basic input validation ------------
    if (chain !== "base" && chain !== "ethereum") {
      errors.push("chain must be 'base' or 'ethereum'");
    }

    if (!orderHash || typeof orderHash !== "string") {
      errors.push("orderHash is required and must be a string");
    }

    if (!offer || typeof offer !== "object") {
      errors.push("offer payload is required");
    } else {
      if (
        typeof offer.priceEth !== "number" ||
        !Number.isFinite(offer.priceEth)
      ) {
        errors.push("offer.priceEth must be a finite number");
      }
      if (offer.priceEth <= 0) {
        errors.push("offer.priceEth must be greater than 0");
      }
      if (typeof offer.priceFormatted !== "string") {
        errors.push("offer.priceFormatted must be a string");
      }
      if (
        offer.expirationTime != null &&
        (typeof offer.expirationTime !== "number" ||
          !Number.isFinite(offer.expirationTime))
      ) {
        errors.push(
          "offer.expirationTime must be a unix timestamp in seconds or null",
        );
      }
    }

    if (errors.length > 0) {
      const payload: FulfillmentResult = {
        ok: false,
        safeToFill: false,
        reason: "bad_request",
        message: errors.join("; "),
        echo,
      };
      return res.status(400).json(payload);
    }

    // ------------ Sanity checks (still dry-run) ------------
    const now = Math.floor(Date.now() / 1000);

    const secondsUntilExpiry =
      offer!.expirationTime != null
        ? Math.floor(offer!.expirationTime - now)
        : null;

    const OPENSEA_FEE_BPS = 250; // 2.5%
    const netPayoutEth =
      offer!.priceEth * (1 - OPENSEA_FEE_BPS / 10_000);

    let safeToFill = true;
    const reasons: string[] = [];

    // Offer already expired or basically expiring
    if (secondsUntilExpiry != null && secondsUntilExpiry <= 60) {
      safeToFill = false;
      reasons.push("offer is expired or about to expire");
    }

    // Non-positive price (should have been caught above; keeps logic robust)
    if (offer!.priceEth <= 0) {
      safeToFill = false;
      reasons.push("offer price is non-positive");
    }

    const result: FulfillmentResult = {
      ok: true,
      safeToFill,
      reason: safeToFill ? null : reasons.join("; ") || "not_safe",
      message: safeToFill
        ? "Dry-run only: the offer looks structurally valid, but Deck did not execute any transaction."
        : "Dry-run only: the offer failed Deck's basic sanity checks. No transaction was created.",
      echo,
      diagnostics: {
        now,
        secondsUntilExpiry,
        netPayoutEth: Number.isFinite(netPayoutEth) ? netPayoutEth : null,
        openseaFeeBps: OPENSEA_FEE_BPS,
      },
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("Unexpected error in /api/opensea/fulfillment", err);
    const payload: FulfillmentResult = {
      ok: false,
      safeToFill: false,
      reason: "internal_error",
      message: "Unexpected error in fulfillment handler",
      echo: {
        chain: null,
        orderHash: null,
        offer: null,
      },
    };
    return res.status(500).json(payload);
  }
}
