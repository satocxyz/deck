// api/opensea/market-history.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type MarketSale = {
  id: string;
  priceEth: number;
  paymentTokenSymbol: string | null;
  timestamp: number | null;
  tokenId?: string | null;
};

const SUPPORTED_CHAINS = ["base", "ethereum", "arbitrum", "optimism"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const chain = req.query.chain as string | undefined;
  const collection = req.query.collection as string | undefined;
  const contract = req.query.contract as string | undefined;
  const limitStr = req.query.limit as string | undefined;

  if (!chain || !SUPPORTED_CHAINS.includes(chain)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid chain. Must be base / ethereum / arbitrum / optimism",
    });
  }

  if (!collection && !contract) {
    return res.status(400).json({
      ok: false,
      error: "You must pass either collection=slug OR contract=address",
    });
  }

  const limit = (() => {
    const n = Number(limitStr);
    if (!Number.isFinite(n)) return 50;
    return Math.max(10, Math.min(200, n));
  })();

  const apiKey = process.env.OPENSEA_API_KEY;
  const baseUrl = process.env.OPENSEA_API_URL ?? "https://api.opensea.io/api/v2";

  if (!apiKey) {
    console.error("Missing OPENSEA_API_KEY");
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  try {
    const search = new URLSearchParams({
      chain,
      limit: String(limit),
    });

    if (collection) search.set("collection_slug", collection);
    if (contract) search.set("asset_contract_address", contract);

    const url = `${baseUrl}/events?event_type=sale&${search.toString()}`;

    const osRes = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
    });

    if (!osRes.ok) {
      console.error("OS market-history error", osRes.status, await osRes.text());
      return res.status(500).json({
        ok: false,
        error: "OpenSea error",
      });
    }

    const json = (await osRes.json()) as any;
    const raw = Array.isArray(json?.asset_events)
      ? json.asset_events
      : Array.isArray(json?.events)
      ? json.events
      : [];

    const parsed: MarketSale[] = [];

    for (const ev of raw) {
      try {
        const tx = ev.transaction;
        const payment = ev.payment_token;
        const asset = ev.asset || ev.nft || {};

        const priceObj = ev.price || ev.total_price || payment?.eth_price;

        let priceEth: number | null = null;

        // OpenSea v2 price object { value, decimals }
        if (ev.price && typeof ev.price === "object") {
          const v = Number(ev.price.value);
          const d = Number(ev.price.decimals);
          if (Number.isFinite(v) && Number.isFinite(d)) {
            priceEth = v / 10 ** d;
          }
        }

        // fallback for v1-style data
        if (!priceEth && typeof ev.total_price === "string") {
          const n = Number(ev.total_price);
          if (!Number.isNaN(n)) priceEth = n / 1e18;
        }

        if (!priceEth || priceEth <= 0) continue;

        const ts =
          tx?.timestamp ??
          ev.event_timestamp ??
          ev.created_date ??
          null;

        parsed.push({
          id:
            ev.id ??
            ev.event_id ??
            `${priceEth}-${ts}-${Math.random().toString(36).slice(2)}`,
          priceEth,
          paymentTokenSymbol: payment?.symbol ?? "ETH",
          timestamp: ts ? Number(new Date(ts).getTime() / 1000) : null,
          tokenId: asset?.token_id ?? null,
        });
      } catch (e) {
        // ignore malformed events
      }
    }

    // Sort ascending (older → newer)
    parsed.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

    return res.status(200).json({
      ok: true,
      sales: parsed,
    });
  } catch (err) {
    console.error("market-history unexpected error", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
