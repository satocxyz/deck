import { sdk } from "@farcaster/miniapp-sdk";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useWalletClient } from "wagmi";
import { useMyNfts, type Chain, type OpenSeaNft } from "./hooks/useMyNfts";

type SafeArea = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

function App() {
  // Remember last chain from localStorage, default to base
  const [chain, setChain] = useState<Chain>(() => {
    if (typeof window === "undefined") return "base";
    const stored = window.localStorage.getItem("deck:chain");
    return stored === "ethereum" ? "ethereum" : "base";
  });

  const [safeArea, setSafeArea] = useState<SafeArea>({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  });
  const [selectedNft, setSelectedNft] = useState<OpenSeaNft | null>(null);

  // Persist chain selection
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("deck:chain", chain);
  }, [chain]);

  useEffect(() => {
    (async () => {
      try {
        const context = await sdk.context;
        if (context?.client?.safeAreaInsets) {
          setSafeArea(context.client.safeAreaInsets);
        }

        await sdk.actions.ready();
      } catch (err) {
        console.error("sdk.ready or context failed", err);
      }
    })();
  }, []);

  const { isConnected } = useAccount();
  const { data, loading, error } = useMyNfts(chain);

  // Group NFTs by collection for nicer UX
  const grouped = useMemo(() => {
    const groups: {
      key: string;
      label: string;
      nfts: OpenSeaNft[];
    }[] = [];

    if (!data?.nfts) return groups;

    const map = new Map<string, { label: string; nfts: OpenSeaNft[] }>();

    for (const nft of data.nfts) {
      const slug = getCollectionSlug(nft) || "unknown";
      const label = getCollectionLabel(nft);

      if (!map.has(slug)) {
        map.set(slug, { label, nfts: [] });
      }
      map.get(slug)!.nfts.push(nft);
    }

    for (const [key, value] of map.entries()) {
      groups.push({ key, label: value.label, nfts: value.nfts });
    }

    groups.sort((a, b) => a.label.localeCompare(b.label));

    return groups;
  }, [data]);

  const showGrid = isConnected && !loading && !error && grouped.length > 0;
  const showEmpty =
    isConnected && !loading && !error && grouped.length === 0;

  return (
    <div
      className="min-h-screen bg-neutral-950 text-white"
      style={{
        paddingTop: 16 + safeArea.top,
        paddingBottom: 16 + safeArea.bottom,
        paddingLeft: 16 + safeArea.left,
        paddingRight: 16 + safeArea.right,
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Deck</h1>
          <p className="text-[11px] text-neutral-400">
            NFTs from your Farcaster wallet
          </p>
        </div>
      </header>

      <ConnectMenu />

      <ChainSelector chain={chain} onChange={setChain} />

      <main className="mt-4">
        {!isConnected && (
          <p className="text-[13px] text-neutral-400">
            Connect your Farcaster wallet to see your NFT deck.
          </p>
        )}

        {isConnected && loading && <NftSkeletonGrid />}

        {isConnected && !loading && error && (
          <p className="text-[13px] text-red-400">
            Couldn&apos;t load NFTs right now. Please try again in a
            moment.
          </p>
        )}

        {showEmpty && (
          <p className="text-[13px] text-neutral-400">
            No NFTs found on {prettyChain(chain)} for this wallet.
          </p>
        )}

        {showGrid && (
          <div className="space-y-4 pb-10">
            {grouped.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="text-xs font-medium text-neutral-200">
                    {group.label}
                  </h2>
                  <span className="text-[10px] text-neutral-500">
                    {group.nfts.length} item
                    {group.nfts.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {group.nfts.map((nft) => (
                    <button
                      key={`${group.key}-${nft.identifier}`}
                      type="button"
                      onClick={() => {
                        console.log("NFT object:", nft);
                        setSelectedNft(nft);
                      }}
                      className="group overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/80 text-left shadow-sm transition hover:border-purple-500/60 hover:bg-neutral-900"
                    >
                      <div className="relative w-full pb-[100%] bg-neutral-950">
                        {nft.image_url ? (
                          <img
                            src={nft.image_url}
                            alt={nft.name || `NFT #${nft.identifier}`}
                            className="absolute inset-0 h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-500">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="space-y-0.5 px-2 py-1.5">
                        <div className="truncate text-[12px] font-medium text-neutral-50">
                          {nft.name || `#${nft.identifier}`}
                        </div>
                        <div className="truncate text-[10px] text-neutral-500">
                          {getCollectionLabel(nft)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <NftDetailModal
        chain={chain}
        nft={selectedNft}
        onClose={() => setSelectedNft(null)}
      />
    </div>
  );
}

/**
 * Wallet connect pill / button
 */
function ConnectMenu() {
  const { isConnected, address } = useAccount();
  const { connect, connectors, isPending } = useConnect();

  if (isConnected) {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/80 px-3 py-2 text-[11px]">
        <span className="text-neutral-200">Wallet connected</span>
        <span className="max-w-[160px] truncate text-neutral-400">
          {address}
        </span>
      </div>
    );
  }

  const connector = connectors[0];

  return (
    <button
      type="button"
      disabled={!connector || isPending}
      onClick={() => connect({ connector })}
      className="mt-2 w-full rounded-2xl border border-purple-500/60 bg-gradient-to-tr from-purple-600 via-indigo-500 to-slate-900 px-4 py-3 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? "Connecting…" : "Connect Farcaster wallet"}
    </button>
  );
}

/**
 * Chain selector: Base / Ethereum
 */
function ChainSelector({
  chain,
  onChange,
}: {
  chain: Chain;
  onChange: (c: Chain) => void;
}) {
  const options: { label: string; value: Chain }[] = [
    { label: "Base", value: "base" },
    { label: "Ethereum", value: "ethereum" },
  ];

  return (
    <div className="mt-2 flex gap-1 rounded-full border border-neutral-800 bg-neutral-900/80 p-1 text-[11px]">
      {options.map((opt) => {
        const active = opt.value === chain;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              "flex-1 rounded-full px-3 py-1 transition-colors",
              active
                ? "bg-neutral-50 text-neutral-900 font-semibold"
                : "text-neutral-300 hover:bg-neutral-800/70",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Skeleton grid for loading state
 */
function NftSkeletonGrid() {
  const placeholders = Array.from({ length: 6 });

  return (
    <div className="grid grid-cols-2 gap-3 pb-10">
      {placeholders.map((_, idx) => (
        <div
          key={idx}
          className="animate-pulse overflow-hidden rounded-2xl border border-neutral-900 bg-neutral-900/60"
        >
          <div className="w-full pb-[100%] bg-neutral-800/60" />
          <div className="space-y-1 px-2 py-2">
            <div className="h-3 w-4/5 rounded bg-neutral-800" />
            <div className="h-2.5 w-3/5 rounded bg-neutral-800/80" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * NFT detail modal
 */
type NormalizedTrait = {
  label: string;
  value: string;
};

function NftDetailModal({
  chain,
  nft,
  onClose,
}: {
  chain: Chain;
  nft: OpenSeaNft | null;
  onClose: () => void;
}) {
  type SimpleOffer = {
    id: string;
    priceEth: number;
    priceFormatted: string;
    maker: string | null;
    expirationTime: number | null;
  };

  type FloorInfo = {
    eth: number | null;
    formatted: string | null;
  };

  const [bestOffer, setBestOffer] = useState<SimpleOffer | null>(null);
  const [floor, setFloor] = useState<FloorInfo>({ eth: null, formatted: null });
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState<string | null>(null);

  const [traits, setTraits] = useState<NormalizedTrait[]>([]);
  const [traitsLoading, setTraitsLoading] = useState(false);
  const [traitsError, setTraitsError] = useState<string | null>(null);
  const [showSellSheet, setShowSellSheet] = useState(false);

  // Offers + floor
  useEffect(() => {
    if (!nft) {
      setBestOffer(null);
      setFloor({ eth: null, formatted: null });
      setOffersError(null);
      setOffersLoading(false);
      return;
    }

    const collectionSlug = getCollectionSlug(nft);

    if (!collectionSlug) {
      setBestOffer(null);
      setFloor({ eth: null, formatted: null });
      setOffersError(null);
      setOffersLoading(false);
      return;
    }

    let cancelled = false;
    setOffersLoading(true);
    setOffersError(null);

    const params = new URLSearchParams({
      chain,
      collection: collectionSlug,
      identifier: nft.identifier,
    });

    fetch(`/api/opensea/offers?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch offers");
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setBestOffer(json.bestOffer ?? null);
        setFloor(
          json.floor ?? {
            eth: null,
            formatted: null,
          },
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load offers", err);
        setOffersError("open_sea_error");
      })
      .finally(() => {
        if (cancelled) return;
        setOffersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chain, nft?.identifier, nft?.collection]);

  // Traits (from nft-details endpoint)
  useEffect(() => {
    if (!nft) {
      setTraits([]);
      setTraitsError(null);
      setTraitsLoading(false);
      return;
    }

    const contractAddress =
      typeof nft.contract === "string" ? nft.contract : undefined;

    if (!contractAddress) {
      setTraits([]);
      setTraitsError(null);
      setTraitsLoading(false);
      return;
    }

    let cancelled = false;
    setTraitsLoading(true);
    setTraitsError(null);

    const params = new URLSearchParams({
      chain,
      contract: contractAddress,
      identifier: nft.identifier,
    });

    fetch(`/api/opensea/nft-details?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch traits");
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setTraits(Array.isArray(json.traits) ? json.traits : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load traits", err);
        setTraitsError("open_sea_error");
      })
      .finally(() => {
        if (cancelled) return;
        setTraitsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chain, nft?.identifier, nft?.contract]);

  const isBusy = offersLoading || traitsLoading;

  function formatTimeRemaining(expirationTime: number | null): string | null {
    if (!expirationTime) return null;

    const nowSeconds = Date.now() / 1000;
    const diff = expirationTime - nowSeconds;

    if (diff <= 0) return "Expired";

    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);

    if (hours <= 0 && minutes <= 0) return "Less than 1m";

    if (hours <= 0) return `${minutes}m`;
    if (minutes <= 0) return `${hours}h`;

    return `${hours}h ${minutes}m`;
  }

  function formatBestVsFloorDiff(
    bestOffer: SimpleOffer | null,
    floor: FloorInfo,
  ): string | null {
    if (!bestOffer || floor.eth == null || floor.eth <= 0) return null;

    const diff = bestOffer.priceEth - floor.eth;
    const diffPct = (diff / floor.eth) * 100;

    const absPct = Math.abs(diffPct).toFixed(1);

    if (diffPct > 0) {
      return `Best offer is ${absPct}% above floor`;
    }
    if (diffPct < 0) {
      return `Best offer is ${absPct}% below floor`;
    }
    return "Best offer is at floor";
  }

  if (!nft) return null;

  const collectionName = getCollectionLabel(nft);
  const chainLabel = prettyChain(chain);
  const collectionSlug = getCollectionSlug(nft);
  const contractAddress =
    typeof nft.contract === "string" ? nft.contract : undefined;

  const baseSearchQuery =
    (typeof nft.collection === "string" && nft.collection) ||
    nft.name ||
    nft.identifier ||
    "";

  const chainSlug = openSeaChainSlug(chain);

  const nftUrl =
    nft.opensea_url ??
    (contractAddress
      ? `https://opensea.io/assets/${chainSlug}/${contractAddress}/${nft.identifier}`
      : null);

  let collectionUrl: string | null = null;

  if (collectionSlug && collectionSlug.length > 0) {
    collectionUrl = `https://opensea.io/collection/${collectionSlug}`;
  } else if (contractAddress) {
    collectionUrl = `https://opensea.io/assets/${chainSlug}/${contractAddress}`;
  } else if (baseSearchQuery) {
    collectionUrl = `https://opensea.io/assets?search[query]=${encodeURIComponent(
      baseSearchQuery,
    )}`;
  } else {
    collectionUrl = null;
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        className="relative z-30 w-full max-w-sm rounded-t-3xl border border-neutral-800 bg-neutral-950/95 px-4 pb-5 pt-3 shadow-xl"
        style={{ opacity: isBusy ? 0.92 : 1 }}
      >
        <div className="mx-auto mb-2 h-1 w-8 rounded-full bg-neutral-700" />
        <div className="flex items-start gap-3">
          <div className="relative h-16 w-16 overflow-hidden rounded-2xl bg-neutral-900">
            {nft.image_url ? (
              <img
                src={nft.image_url}
                alt={nft.name || `NFT #${nft.identifier}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-500">
                No image
              </div>
            )}
          </div>
          <div className="flex-1 space-y-0.5">
            <div className="text-sm font-semibold text-neutral-50">
              {nft.name || `Token #${nft.identifier}`}
            </div>
            <div className="text-[11px] text-neutral-400">
              {collectionName}
            </div>
            <div className="text-[10px] text-neutral-500">
              {chainLabel} • ID {nft.identifier}
            </div>
          </div>
        </div>

        {nft.description && (
          <p className="mt-3 line-clamp-3 text-[11px] text-neutral-300">
            {nft.description}
          </p>
        )}

        {/* Traits section */}
        {traitsLoading && (
          <div className="mt-3 px-1 text-[11px] text-neutral-400">
            Loading traits…
          </div>
        )}

        {!traitsLoading && traitsError && (
          <div className="mt-3 px-1 text-[11px] text-neutral-500">
            OpenSea traits are unavailable right now.
          </div>
        )}

        {!traitsLoading && !traitsError && traits.length > 0 && (
          <div className="mt-3 space-y-1">
            <div className="px-1 text-[10px] uppercase tracking-wide text-neutral-500">
              Traits
            </div>
            <div className="flex flex-wrap gap-1.5 px-1">
              {traits.map((trait) => (
                <div
                  key={`${trait.label}-${trait.value}`}
                  className="
                    rounded-xl border border-neutral-800 bg-neutral-900/80 
                    px-2 py-1 text-[10px]
                  "
                >
                  <div className="text-[9px] uppercase tracking-wide text-neutral-500">
                    {trait.label}
                  </div>
                  <div className="text-[11px] text-neutral-100">
                    {trait.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Price section */}
        <div className="mt-4 space-y-1">
          <div className="px-1 text-[10px] uppercase tracking-wide text-neutral-500">
            Price
          </div>

          {offersLoading && (
            <div className="px-1 text-[11px] text-neutral-400">
              Loading price data…
            </div>
          )}

          {!offersLoading && offersError && (
            <div className="px-1 text-[11px] text-neutral-500">
              OpenSea price data is unavailable right now.
            </div>
          )}

          {!offersLoading && !offersError && !bestOffer && !floor.formatted && (
            <div className="px-1 text-[11px] text-neutral-500">
              No price data available.
            </div>
          )}

          {!offersLoading && !offersError && (bestOffer || floor.formatted) && (
            <div className="space-y-1 px-1 text-[11px]">
              {bestOffer && (
                <div className="flex items-baseline justify-between">
                  <span className="text-neutral-300">Best offer</span>
                  <div className="flex flex-col items-end">
                    <span className="font-semibold text-emerald-300">
                      {bestOffer.priceFormatted} WETH
                    </span>
                    {formatTimeRemaining(bestOffer.expirationTime) && (
                      <span className="text-[10px] text-neutral-500">
                        Expires in{" "}
                        {formatTimeRemaining(bestOffer.expirationTime)}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {floor.formatted && (
                <div className="flex items-baseline justify-between">
                  <span className="text-neutral-300">Floor</span>
                  <span className="text-neutral-200">
                    {floor.formatted} ETH
                  </span>
                </div>
              )}
              {bestOffer &&
                floor.formatted &&
                formatBestVsFloorDiff(bestOffer, floor) && (
                  <div className="flex items-baseline justify-between pt-0.5">
                    <span className="text-neutral-400">Context</span>
                    <span className="text-[10px] text-neutral-400">
                      {formatBestVsFloorDiff(bestOffer, floor)}
                    </span>
                  </div>
                )}
            </div>
          )}
        </div>

        {/* OpenSea actions */}
        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {nftUrl && (
              <a
                href={nftUrl}
                target="_blank"
                rel="noreferrer"
                className="
                  w-full rounded-xl border border-neutral-800 bg-neutral-900/80 
                  px-2 py-1.5 text-center text-[11px] text-neutral-200
                  transition-colors duration-150
                  hover:border-purple-500/60 hover:text-purple-100
                "
              >
                View NFT
              </a>
            )}

            {collectionUrl && (
              <a
                href={collectionUrl}
                target="_blank"
                rel="noreferrer"
                className="
                  w-full rounded-xl border border-neutral-800 bg-neutral-900/80 
                  px-2 py-1.5 text-center text-[11px] text-neutral-200
                  transition-colors duration-150
                  hover:border-purple-500/60 hover:text-purple-100
                "
              >
                View Collection
              </a>
            )}
          </div>

          {/* Primary sell CTA */}
          <button
            type="button"
            disabled={!bestOffer}
            onClick={() => setShowSellSheet(true)}
            className={[
              "mt-2 w-full rounded-2xl px-3 py-2 text-center text-[12px] font-semibold shadow-sm",
              bestOffer
                ? "bg-purple-600 text-white hover:bg-purple-500 border border-purple-500/60"
                : "border border-neutral-800 bg-neutral-900/60 text-neutral-500 opacity-60 cursor-not-allowed",
            ].join(" ")}
          >
            {bestOffer ? "Accept Best Offer" : "No Offer Available"}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-center text-[11px] text-neutral-500"
        >
          Close
        </button>

        {showSellSheet && bestOffer && (
          <SellConfirmSheet
            chain={chain}
            orderHash={bestOffer.id}
            contractAddress={contractAddress}
            tokenId={nft.identifier}
            offer={{
              priceEth: bestOffer.priceEth,
              priceFormatted: bestOffer.priceFormatted,
              expirationTime: bestOffer.expirationTime,
            }}
            onClose={() => setShowSellSheet(false)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Helpers
 */

function getCollectionSlug(nft: OpenSeaNft): string | undefined {
  if (!nft.collection) return undefined;
  if (typeof nft.collection === "string") return nft.collection;
  return nft.collection.slug ?? undefined;
}

function getCollectionLabel(nft: OpenSeaNft): string {
  if (!nft.collection) return "Unknown collection";

  if (typeof nft.collection === "string") {
    const words = nft.collection.replace(/[-_]+/g, " ").trim().split(/\s+/);
    if (words.length === 0) return "Unknown collection";
    return words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  return (
    nft.collection.name ||
    nft.collection.slug
      ?.replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "Unknown collection"
  );
}

function openSeaChainSlug(chain: Chain): string {
  if (chain === "base") return "base";
  return "ethereum";
}

function prettyChain(chain: Chain): string {
  if (chain === "base") return "Base";
  return "Ethereum";
}

export default App;

function SellConfirmSheet({
  chain,
  orderHash,
  contractAddress,
  tokenId,
  offer,
  onClose,
}: {
  chain: Chain;
  orderHash: string;
  contractAddress?: string;
  tokenId: string;
  offer: {
    priceEth: number;
    priceFormatted: string;
    expirationTime: number | null;
  };
  onClose: () => void;
}) {
  // Wallet hooks
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // OpenSea fee is 2.5%
  const feePct = 2.5 / 100;
  const payout = offer.priceEth * (1 - feePct);
  const payoutFormatted =
    payout >= 1 ? payout.toFixed(3) : payout.toFixed(4);

  function formatExpiration() {
    if (!offer.expirationTime) return "Unknown";
    const now = Date.now() / 1000;
    const diff = offer.expirationTime - now;
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    if (hours <= 0 && minutes <= 0) return "Under 1m";
    if (hours <= 0) return `${minutes}m`;
    if (minutes <= 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      if (!address || !walletClient) {
        setError("Wallet is not connected.");
        return;
      }

      // 1) Ask backend for fulfillment (may be stub / test / real)
      const res = await fetch("/api/opensea/fulfillment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chain,
          orderHash,
          takerAddress: address,
          offer: {
            priceEth: offer.priceEth,
            priceFormatted: offer.priceFormatted,
            expirationTime: offer.expirationTime,
          },
          contractAddress,
          tokenId,
        }),
      });

      const json = await res.json();
      console.log("Fulfillment response", json);

      if (!res.ok || !json.ok) {
        setError(json.message || "Backend rejected fulfillment request.");
        return;
      }

      if (!json.safeToFill) {
        setInfo(
          json.message ||
            "Accepting offers is not enabled yet. No transaction was created.",
        );
        return;
      }

      const tx = json.tx as
        | {
            to: string;
            data: string;
            value?: string | null;
          }
        | undefined;

      if (!tx || !tx.to || !tx.data) {
        setError("Backend did not return a transaction to send.");
        return;
      }

      const chainId = chain === "base" ? 8453 : 1;

      const txHash = await walletClient.sendTransaction({
        account: address as `0x${string}`,
        chain: {
          id: chainId,
          name: "",
          nativeCurrency: undefined,
          rpcUrls: {},
        } as any,
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: tx.value ? BigInt(tx.value) : 0n,
      });

      setInfo(`Transaction submitted: ${txHash}`);
      onClose();
      return;
    } catch (err) {
      console.error("Error while sending transaction", err);
      setError("Failed to send transaction. Check console for details.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm">
      <button
        className="absolute inset-0 w-full h-full"
        onClick={onClose}
      />

      <div className="relative z-[70] w-full max-w-sm rounded-t-3xl border border-neutral-800 bg-neutral-950 px-5 py-4">
        <div className="w-10 h-1 bg-neutral-700 rounded-full mx-auto mb-3" />

        <h2 className="text-sm font-semibold text-neutral-50 text-center">
          Accept Best Offer
        </h2>

        <div className="mt-4 space-y-3 text-[12px]">
          <div className="flex justify-between">
            <span className="text-neutral-300">Offer</span>
            <span className="font-semibold text-neutral-100">
              {offer.priceFormatted} WETH
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-neutral-300">OpenSea fee (2.5%)</span>
            <span className="text-neutral-400">
              -{(offer.priceEth * 0.025).toFixed(4)} WETH
            </span>
          </div>

          <div className="flex justify-between pt-1 border-t border-neutral-800">
            <span className="text-neutral-300">You will receive</span>
            <span className="font-semibold text-emerald-300">
              {payoutFormatted} WETH
            </span>
          </div>

          <div className="flex justify-between pt-1">
            <span className="text-neutral-400">Offer expires</span>
            <span className="text-neutral-400">
              {formatExpiration()}
            </span>
          </div>

          {error && (
            <div className="mt-2 text-[11px] text-red-400 leading-tight">
              {error}
            </div>
          )}

          {info && !error && (
            <div className="mt-2 text-[11px] text-amber-300 leading-tight">
              {info}
            </div>
          )}

          {!info && !error && (
            <div className="mt-2 text-[11px] text-neutral-500 leading-tight">
              For your safety, the transaction will only proceed if the
              on-chain offer amount exactly matches the value shown here.
            </div>
          )}
        </div>

        <button
          className="mt-4 w-full rounded-xl bg-purple-600 py-2 text-[12px] font-semibold text-white shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={submitting}
          onClick={handleConfirm}
        >
          {submitting ? "Submitting…" : "Confirm Accept Offer"}
        </button>

        <button
          className="mt-2 w-full text-center text-[12px] text-neutral-400"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
