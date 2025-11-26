import { sdk } from "@farcaster/miniapp-sdk";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useWalletClient } from "wagmi";
import { encodeFunctionData } from "viem";
import { useMyNfts, type Chain, type OpenSeaNft } from "./hooks/useMyNfts";

// Minimal Seaport 1.6 ABI for matchAdvancedOrders
const seaportMatchAdvancedOrdersAbi = [
  {
    type: "function",
    name: "matchAdvancedOrders",
    stateMutability: "payable",
    inputs: [
      {
        name: "orders",
        type: "tuple[]",
        components: [
          {
            name: "parameters",
            type: "tuple",
            components: [
              { name: "offerer", type: "address" },
              { name: "zone", type: "address" },
              {
                name: "offer",
                type: "tuple[]",
                components: [
                  { name: "itemType", type: "uint8" },
                  { name: "token", type: "address" },
                  { name: "identifierOrCriteria", type: "uint256" },
                  { name: "startAmount", type: "uint256" },
                  { name: "endAmount", type: "uint256" },
                ],
              },
              {
                name: "consideration",
                type: "tuple[]",
                components: [
                  { name: "itemType", type: "uint8" },
                  { name: "token", type: "address" },
                  { name: "identifierOrCriteria", type: "uint256" },
                  { name: "startAmount", type: "uint256" },
                  { name: "endAmount", type: "uint256" },
                  { name: "recipient", type: "address" },
                ],
              },
              { name: "orderType", type: "uint8" },
              { name: "startTime", type: "uint256" },
              { name: "endTime", type: "uint256" },
              { name: "zoneHash", type: "bytes32" },
              { name: "salt", type: "uint256" },
              { name: "conduitKey", type: "bytes32" },
              { name: "totalOriginalConsiderationItems", type: "uint256" },
            ],
          },
          { name: "numerator", type: "uint120" },
          { name: "denominator", type: "uint120" },
          { name: "signature", type: "bytes" },
          { name: "extraData", type: "bytes" },
        ],
      },
      {
        name: "criteriaResolvers",
        type: "tuple[]",
        components: [
          { name: "orderIndex", type: "uint256" },
          { name: "side", type: "uint8" },
          { name: "index", type: "uint256" },
          { name: "identifier", type: "uint256" },
          { name: "criteriaProof", type: "bytes32[]" },
        ],
      },
      {
        name: "fulfillments",
        type: "tuple[]",
        components: [
          {
            name: "offerComponents",
            type: "tuple[]",
            components: [
              { name: "orderIndex", type: "uint256" },
              { name: "itemIndex", type: "uint256" },
            ],
          },
          {
            name: "considerationComponents",
            type: "tuple[]",
            components: [
              { name: "orderIndex", type: "uint256" },
              { name: "itemIndex", type: "uint256" },
            ],
          },
        ],
      },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const;

type SafeArea = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type MiniAppUser = {
  fid: number;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
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
  const [fcUser, setFcUser] = useState<MiniAppUser | null>(null);

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

        if (context?.user) {
          setFcUser({
            fid: context.user.fid,
            username: context.user.username,
            displayName: context.user.displayName,
            pfpUrl: context.user.pfpUrl,
          });
        }

        await sdk.actions.ready();
      } catch (err) {
        console.error("sdk.ready or context failed", err);
      }
    })();
  }, []);

  const { isConnected } = useAccount();
  const { data, loading, error } = useMyNfts(chain);

  const nfts = useMemo(() => data?.nfts ?? [], [data]);

  const showGrid = isConnected && !loading && !error && nfts.length > 0;
  const showEmpty =
    isConnected && !loading && !error && nfts.length === 0;

  return (
    <div
      className="min-h-screen bg-neutral-50 text-neutral-900"
      style={{
        paddingTop: 16 + safeArea.top,
        paddingBottom: 16 + safeArea.bottom,
        paddingLeft: 16 + safeArea.left,
        paddingRight: 16 + safeArea.right,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
<header className="mb-4 space-y-3">
  {/* Row 1: Logo + profile */}
  <div className="flex items-center justify-between gap-3">
<div className="flex-1 min-w-0 flex flex-col justify-start">
  <div className="flex items-start gap-2 -mt-[1px]">
    <img
      src="/deck-icon.png"
      alt="Deck"
      className="h-7 w-auto"
    />
    <span className="text-xl font-semibold tracking-tight text-neutral-900">
      Deck
    </span>
  </div>

  <p className="mt-1 text-[11px] text-neutral-500 leading-tight">
    Sell your NFTs directly inside Farcaster.
  </p>
</div>

    {/* Farcaster profile pill */}
    <div className="w-[55%] max-w-[240px]">
      <ConnectMenu user={fcUser} />
    </div>
  </div>

  {/* Row 2: Powered by OpenSea + chain selector */}
  <div className="flex items-center gap-2">
    <div
      className="
        inline-flex items-center gap-1 rounded-full 
        bg-neutral-900 px-3 py-1
        text-[10px] font-medium text-white
        shadow-sm
      "
    >
      <span className="text-[11px]">🌊</span>
      <span>Powered by OpenSea</span>
    </div>

    <div className="flex-1 flex justify-end">
      <div className="w-[40%] min-w-[130px]">
        <ChainSelector chain={chain} onChange={setChain} />
      </div>
    </div>
  </div>
</header>

<div className="h-[12px] -mt-1 mb-2 bg-gradient-to-b from-black/5 to-transparent pointer-events-none" />

      <main className="mt-4">
        {!isConnected && (
          <p className="text-[13px] text-neutral-400">
            Connect your Farcaster wallet to see your NFTs.
          </p>
        )}

        {isConnected && loading && <NftSkeletonGrid />}

        {isConnected && !loading && error && (
          <p className="text-[13px] text-red-400">
            We couldn&apos;t load your NFTs. Try again in a moment.
          </p>
        )}

        {showEmpty && (
          <p className="text-[13px] text-neutral-400">
            You don&apos;t have any NFTs on {prettyChain(chain)} for this
            wallet.
          </p>
        )}

        {showGrid && (
          <div className="grid grid-cols-2 gap-3 pb-10">
            {nfts.map((nft) => (
              <button
                key={`${getCollectionSlug(nft) ?? "unknown"}-${nft.identifier}`}
                type="button"
                onClick={() => {
                  console.log("NFT object:", nft);
                  setSelectedNft(nft);
                }}
                className="
                  group flex flex-col overflow-hidden rounded-2xl
                  bg-white/95 border border-neutral-200
                  shadow-sm transition-all duration-200
                  hover:-translate-y-[2px] hover:shadow-lg hover:border-purple-400/40
                  active:translate-y-0 active:shadow-sm
                  focus:outline-none focus:ring-2 focus:ring-purple-400/60 focus:ring-offset-2 focus:ring-offset-neutral-50
                  p-2
                "
              >
                {/* Inner image container */}
                <div
                  className="
                    relative w-full pb-[100%]
                    rounded-xl overflow-hidden
                    bg-gradient-to-br from-neutral-100 to-neutral-200
                  "
                >
                  {nft.image_url ? (
                    <img
                      src={nft.image_url}
                      alt={nft.name || `NFT #${nft.identifier}`}
                      className="
                        absolute inset-0 h-full w-full object-cover
                        transition-transform duration-200
                        group-hover:scale-[1.03]
                      "
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-500">
                      No image
                    </div>
                  )}

                  {/* Token ID badge (top-right) */}
                  <div
                    className="
                      absolute right-2 top-2 rounded-full
                      bg-black/70 px-2 py-0.5
                      text-[9px] font-medium text-white
                      backdrop-blur-sm
                    "
                  >
                    #{nft.identifier}
                  </div>
                </div>

                {/* Text area */}
                <div className="space-y-0.5 px-0.5 pb-1.5 pt-2 text-left">
                  <div className="truncate text-[12px] font-semibold text-neutral-900">
                    {nft.name || `NFT #${nft.identifier}`}
                  </div>

                  <div className="truncate text-[11px] text-neutral-500">
                    {getCollectionLabel(nft)}
                  </div>
                </div>
              </button>
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
 * Helpers for header / wallet
 */
function shortenAddress(addr?: string | null) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Wallet connect pill / button with Farcaster user
 */
function ConnectMenu({ user }: { user: MiniAppUser | null }) {
  const { isConnected, address } = useAccount();
  const { connect, connectors, isPending } = useConnect();

  const displayName =
    user?.displayName || user?.username || "Farcaster user";

  if (isConnected) {
    return (
      <div
        className="
          flex items-center justify-end gap-2
          rounded-2xl bg-transparent
          px-1 py-2
        "
      >
        {/* Text block – fully right aligned */}
        <div className="flex min-w-0 flex-col items-end text-right">
          <span className="truncate text-[12px] font-semibold text-neutral-900 leading-tight">
            {displayName}
          </span>

          <span className="flex items-center gap-1 text-[10px] text-neutral-500 leading-tight">
            <span className="inline-block h-[9px] w-[9px] rounded-[3px] border border-neutral-400/70" />
            <span className="max-w-[130px] truncate">
              {shortenAddress(address)}
            </span>
          </span>
        </div>

        {/* Avatar on the far right */}
        <div className="relative h-8 w-8 flex-shrink-0">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-400 to-purple-500" />
          <div className="absolute inset-[2px] overflow-hidden rounded-full bg-neutral-900">
            {user?.pfpUrl ? (
              <img
                src={user.pfpUrl}
                alt={displayName}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-200">
                ?
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const connector = connectors[0];

  return (
    <button
      type="button"
      disabled={!connector || isPending}
      onClick={() => connect({ connector })}
      className="
        w-full rounded-2xl 
        bg-neutral-900 text-white 
        px-4 py-3 text-sm font-semibold 
        shadow-sm transition-all duration-150
        hover:bg-neutral-800 
        disabled:cursor-not-allowed disabled:opacity-60
      "
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
    <div className="mt-0 flex gap-1 rounded-full border border-neutral-200 bg-white p-1 text-[11px] shadow-sm">
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
                ? "bg-neutral-900 text-white font-semibold"
                : "text-neutral-500 hover:bg-neutral-100",
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
          className="animate-pulse overflow-hidden rounded-2xl border border-neutral-200 bg-white/90"
        >
          <div className="w-full pb-[100%] bg-neutral-200/70" />
          <div className="space-y-1 px-2 py-2">
            <div className="h-3 w-4/5 rounded bg-neutral-200" />
            <div className="h-2.5 w-3/5 rounded bg-neutral-200/80" />
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
    protocolAddress: string | null; // now non-optional
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
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/25 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        className="relative z-30 w-full max-w-sm rounded-t-3xl border border-neutral-200 bg-white px-4 pb-5 pt-3 shadow-xl"
        style={{ opacity: isBusy ? 0.96 : 1 }}
      >
        <div className="mx-auto mb-2 h-1 w-8 rounded-full bg-neutral-300" />
        <div className="flex items-start gap-3">
          <div className="relative h-16 w-16 overflow-hidden rounded-2xl bg-neutral-100">
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
            <div className="text-sm font-semibold text-neutral-900">
              {nft.name || `Token #${nft.identifier}`}
            </div>
            <div className="text-[11px] text-neutral-500">{collectionName}</div>
            <div className="text-[10px] text-neutral-400">
              {chainLabel} • ID {nft.identifier}
            </div>
          </div>
        </div>

        {nft.description && (
          <p className="mt-3 line-clamp-3 text-[11px] text-neutral-600">
            {nft.description}
          </p>
        )}

        {/* Traits section */}
        {traitsLoading && (
          <div className="mt-3 px-1 text-[11px] text-neutral-500">
            Loading traits…
          </div>
        )}

        {!traitsLoading && traitsError && (
          <div className="mt-3 px-1 text-[11px] text-neutral-500">
            We can&apos;t show traits right now.
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
                    rounded-xl border border-neutral-200 bg-neutral-50 
                    px-2 py-1 text-[10px]
                  "
                >
                  <div className="text-[9px] uppercase tracking-wide text-neutral-500">
                    {trait.label}
                  </div>
                  <div className="text-[11px] text-neutral-900">
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
            <div className="px-1 text-[11px] text-neutral-500">
              Loading price data…
            </div>
          )}

          {!offersLoading && offersError && (
            <div className="px-1 text-[11px] text-neutral-500">
              We can&apos;t show price data right now.
            </div>
          )}

          {!offersLoading && !offersError && !bestOffer && !floor.formatted && (
            <div className="px-1 text-[11px] text-neutral-500">
              No price data available for this NFT.
            </div>
          )}

          {!offersLoading && !offersError && (bestOffer || floor.formatted) && (
            <div className="space-y-1 px-1 text-[11px]">
              {bestOffer && (
                <div className="flex items-baseline justify-between">
                  <span className="text-neutral-600">Best offer</span>
                  <div className="flex flex-col items-end">
                    <span className="font-semibold text-emerald-600">
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
                  <span className="text-neutral-600">Floor</span>
                  <span className="text-neutral-800">
                    {floor.formatted} ETH
                  </span>
                </div>
              )}
              {bestOffer &&
                floor.formatted &&
                formatBestVsFloorDiff(bestOffer, floor) && (
                  <div className="flex items-baseline justify-between pt-0.5">
                    <span className="text-neutral-500">Context</span>
                    <span className="text-[10px] text-neutral-500">
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
                  w-full rounded-xl border border-neutral-200 bg-white
                  px-2 py-1.5 text-center text-[11px] text-neutral-700
                  transition-colors duration-150
                  hover:border-purple-400/60 hover:bg-purple-50 hover:text-neutral-900
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
                  w-full rounded-xl border border-neutral-200 bg-white
                  px-2 py-1.5 text-center text-[11px] text-neutral-700
                  transition-colors duration-150
                  hover:border-purple-400/60 hover:bg-purple-50 hover:text-neutral-900
                "
              >
                View collection
              </a>
            )}
          </div>

          <button
            type="button"
            disabled={!bestOffer || !contractAddress}
            onClick={() => setShowSellSheet(true)}
            className={[
              "mt-2 w-full rounded-2xl px-3 py-2 text-center text-[12px] font-semibold shadow-sm",
              bestOffer && contractAddress
                ? "bg-purple-600 text-white hover:bg-purple-500 border border-purple-500/60"
                : "border border-neutral-200 bg-neutral-100 text-neutral-400 opacity-60 cursor-not-allowed",
            ].join(" ")}
          >
            {bestOffer && contractAddress
              ? "Accept best offer"
              : "No offer available"}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-center text-[11px] text-neutral-500"
        >
          Close
        </button>

        {showSellSheet && bestOffer && contractAddress && (
          <SellConfirmSheet
            chain={chain}
            orderHash={bestOffer.id}
            contractAddress={contractAddress}
            tokenId={String(nft.identifier)}
            protocolAddress={bestOffer.protocolAddress ?? ""}
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
  protocolAddress,
  offer,
  onClose,
}: {
  chain: Chain;
  orderHash: string;
  contractAddress: string;
  tokenId: string;
  protocolAddress: string;
  offer: {
    priceEth: number;
    priceFormatted: string;
    expirationTime: number | null;
  };
  onClose: () => void;
}) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

    let dataToSend: `0x${string}` | undefined;

    try {
      if (!address || !walletClient) {
        setError("Wallet is not connected.");
        return;
      }

      const res = await fetch("/api/opensea/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain,
          orderHash,
          contractAddress,
          tokenId,
          protocolAddress,
          takerAddress: address,
          offer: {
            priceEth: offer.priceEth,
            priceFormatted: offer.priceFormatted,
            expirationTime: offer.expirationTime,
          },
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

      const tx = json.tx;

      if (!tx || !tx.to) {
        setError("Backend did not return a transaction to send.");
        return;
      }

      if (tx.data) {
        dataToSend = tx.data as `0x${string}`;
      } else if (
        tx.functionName?.startsWith("matchAdvancedOrders") &&
        tx.inputData &&
        Array.isArray(tx.inputData.orders)
      ) {
        const { orders, criteriaResolvers, fulfillments, recipient } =
          tx.inputData;

        if (
          recipient &&
          address &&
          recipient.toLowerCase() !== address.toLowerCase()
        ) {
          console.error(
            "Recipient from backend does not match current address",
            {
              recipient,
              address,
            },
          );
          setError("Recipient mismatch between wallet and fulfillment data.");
          return;
        }

        const recipientHex = recipient as `0x${string}`;

        dataToSend = encodeFunctionData({
          abi: seaportMatchAdvancedOrdersAbi,
          functionName: "matchAdvancedOrders",
          args: [orders, criteriaResolvers, fulfillments, recipientHex],
        }) as `0x${string}`;
      } else {
        console.error("Unexpected tx payload from backend:", tx);
        setError(
          "Backend did not return a usable transaction payload from OpenSea.",
        );
        return;
      }

      const chainId = chain === "base" ? 8453 : 1;
      const valueBigInt = tx.value != null ? BigInt(tx.value) : 0n;

      const txHash = await walletClient.sendTransaction({
        account: address as `0x${string}`,
        chain: {
          id: chainId,
          name: "",
          nativeCurrency: undefined,
          rpcUrls: {},
        } as any,
        to: tx.to as `0x${string}`,
        data: dataToSend,
        value: valueBigInt,
      });

      setInfo(`Transaction submitted: ${txHash}`);
      onClose();
    } catch (err) {
      console.error("Error while sending transaction", err);
      setError("Failed to send transaction. Check console for details.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/25 backdrop-blur-sm">
      <button className="absolute inset-0 h-full w-full" onClick={onClose} />

      <div className="relative z-[70] w-full max-w-sm rounded-t-3xl border border-neutral-200 bg-white px-5 py-4 shadow-xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />

        <h2 className="text-center text-sm font-semibold text-neutral-900">
          Accept best offer
        </h2>

        <div className="mt-4 space-y-3 text-[12px]">
          <div className="flex justify-between">
            <span className="text-neutral-600">Offer</span>
            <span className="font-semibold text-neutral-900">
              {offer.priceFormatted} WETH
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-neutral-600">OpenSea fee (2.5%)</span>
            <span className="text-neutral-500">
              -{(offer.priceEth * 0.025).toFixed(4)} WETH
            </span>
          </div>

          <div className="flex justify-between border-t border-neutral-200 pt-1">
            <span className="text-neutral-700">You&apos;ll receive</span>
            <span className="font-semibold text-emerald-600">
              {payoutFormatted} WETH
            </span>
          </div>

          <div className="flex justify-between pt-1">
            <span className="text-neutral-500">Offer expires</span>
            <span className="text-neutral-600">{formatExpiration()}</span>
          </div>

          {error && (
            <div className="mt-2 leading-tight text-[11px] text-red-500">
              {error}
            </div>
          )}

          {info && !error && (
            <div className="mt-2 leading-tight text-[11px] text-amber-600">
              {info}
            </div>
          )}

          {!info && !error && (
            <div className="mt-2 leading-tight text-[11px] text-neutral-500">
              For your safety, the transaction will only proceed if the
              on-chain offer amount exactly matches the value shown here.
            </div>
          )}
        </div>

        <button
          className="mt-4 w-full rounded-xl bg-purple-600 py-2 text-[12px] font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 hover:bg-purple-500"
          disabled={submitting}
          onClick={handleConfirm}
        >
          {submitting ? "Submitting…" : "Confirm accept offer"}
        </button>

        <button
          className="mt-2 w-full text-center text-[12px] text-neutral-500"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
