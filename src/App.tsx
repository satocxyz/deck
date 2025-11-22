import { sdk } from "@farcaster/miniapp-sdk";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useMyNfts, type Chain, type OpenSeaNft } from "./hooks/useMyNfts";

type SafeArea = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

function App() {
  const [chain, setChain] = useState<Chain>("base");
  const [safeArea, setSafeArea] = useState<SafeArea>({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  });
  const [selectedNft, setSelectedNft] = useState<OpenSeaNft | null>(null);

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
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
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
          <p className="text-[13px] text-red-400">Error: {error}</p>
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
 * NFT detail modal (no real trading yet – UI only, safe)
 */
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

  useEffect(() => {
    if (!nft) {
      setBestOffer(null);
      setFloor({ eth: null, formatted: null });
      setOffersError(null);
      setOffersLoading(false);
      return;
    }

    const collectionSlug = getCollectionSlug(nft);

    // Best-offer-by-NFT endpoint only needs slug + identifier
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
        setOffersError("Failed to load offers");
      })
      .finally(() => {
        if (cancelled) return;
        setOffersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chain, nft?.identifier, nft?.collection]);

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

  // Exact NFT link if OpenSea provides it, otherwise construct from contract + token
  const nftUrl =
    nft.opensea_url ??
    (contractAddress
      ? `https://opensea.io/assets/${chainSlug}/${contractAddress}/${nft.identifier}`
      : null);

  let collectionUrl: string | null = null;

  if (collectionSlug && collectionSlug.length > 0) {
    collectionUrl = `https://opensea.io/collection/${collectionSlug}`;
  } else if (contractAddress) {
    // Show all assets for this contract as "collection" view
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
      <div className="relative z-30 w-full max-w-sm rounded-t-3xl border border-neutral-800 bg-neutral-950/95 px-4 pb-5 pt-3 shadow-xl">
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
            <div className="text-[11px] text-neutral-400">{collectionName}</div>
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

        {/* Offers section */}
        <div className="mt-4 space-y-1">
          <div className="px-1 text-[10px] uppercase tracking-wide text-neutral-500">
            Offers
          </div>

          {offersLoading && (
            <div className="px-1 text-[11px] text-neutral-400">
              Loading offers from OpenSea…
            </div>
          )}

          {!offersLoading && offersError && (
            <div className="px-1 text-[11px] text-red-400">
              {offersError}
            </div>
          )}

          {!offersLoading && !offersError && !bestOffer && !floor.formatted && (
            <div className="px-1 text-[11px] text-neutral-500">
              No active offers or floor data.
            </div>
          )}

          {!offersLoading && !offersError && (bestOffer || floor.formatted) && (
            <div className="space-y-1 px-1 text-[11px]">
              {bestOffer && (
                <div className="flex items-baseline justify-between">
                  <span className="text-neutral-300">Best offer</span>
                  <span className="font-semibold text-emerald-300">
                    {bestOffer.priceFormatted} WETH
                  </span>
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
            </div>
          )}
        </div>

        {/* Opensea actions */}
        <div className="mt-4 space-y-2">
          <div className="px-1 text-[10px] uppercase tracking-wide text-neutral-500">
            Opensea
          </div>

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

          {/* Primary sell CTA – disabled for now, to be wired to Deck's own flow later */}
          <button
            type="button"
            disabled
            className="
              mt-2 w-full rounded-2xl border border-purple-500/40 
              bg-purple-600/60 px-3 py-2 
              text-center text-[12px] font-semibold text-white 
              shadow-sm opacity-60
            "
          >
            Sell / Manage Listing (coming soon)
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-center text-[11px] text-neutral-500"
        >
          Close
        </button>
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
    // Convert slug ("cloakies-collection") -> "Cloakies Collection"
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
