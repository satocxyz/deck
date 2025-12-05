import { sdk } from "@farcaster/miniapp-sdk";
import React, { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useWalletClient, usePublicClient } from "wagmi";
import { encodeFunctionData, type TypedDataDomain, getAddress } from "viem";

import { useMyNfts, type Chain, type OpenSeaNft } from "./hooks/useMyNfts";
// --- Toast System v2 ---------------------------------------------------------

type ToastType = "success" | "loading" | "error";

type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
};

type ToastContextValue = {
  showToast: (type: ToastType, message: string) => string;
  hideToast: (id: string) => void;
  updateToast: (id: string, patch: Partial<Omit<ToastItem, "id">>) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("ToastContext missing from App");
  return ctx;
}

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.innerHTML = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  `;
  document.head.appendChild(style);
}

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

// Minimal Seaport 1.6 ABI — only the cancel() function
const seaportCancelAbi = [
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "orders",
        type: "tuple[]",
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
          { name: "counter", type: "uint256" },
        ],
      },
    ],
  },
];

// Canonical OpenSea Seaport conduit (same on mainnet, Base, etc.)
const OPENSEA_SEAPORT_CONDUIT = "0x1E0049783F008A0085193E00003D00cd54003c71" as const;

// OpenSea Seaport config (zone + shared conduit key)
const OPENSEA_ZONE = getAddress("0x000056f7000000ece9003ca63978907a00ffd100") as `0x${string}`;

const OPENSEA_CONDUIT_KEY =
  "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000" as `0x${string}`;

// Minimal ERC721 / ERC1155 approval ABI
const erc721Or1155ApprovalAbi = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

// Canonical Seaport 1.6 contract used by OpenSea on L1 + L2s
const SEAPORT_1_6_ADDRESS = getAddress(
  "0x0000000000000068f116a894984e2db1123eb395",
) as `0x${string}`;
// --- OpenSea fee config (temporary hard-code: 1% / 100 bps) ----
const OPENSEA_FEE_BPS = 100; // 100 basis points = 1%
const FEE_DENOMINATOR = 10_000;

// Official OpenSea fee recipient (Seaport platform fee recipient)
const OPENSEA_FEE_RECIPIENT = "0x0000a26b00c1F0DF003000390027140000fAa719" as `0x${string}`;

// ---- Minimal Seaport typed-data types for a simple listing ----
type Eip712Types = Record<string, { name: string; type: string }[]>;
// Helper: recursively convert all bigint values to string so JSON.stringify works
function serializeBigInt(value: any): any {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((v) => serializeBigInt(v));
  }
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeBigInt(v);
    }
    return out;
  }
  return value;
}

type SeaportOfferItem = {
  itemType: number;
  token: `0x${string}`;
  identifierOrCriteria: bigint;
  startAmount: bigint;
  endAmount: bigint;
};

type SeaportConsiderationItem = {
  itemType: number;
  token: `0x${string}`;
  identifierOrCriteria: bigint;
  startAmount: bigint;
  endAmount: bigint;
  recipient: `0x${string}`;
};

type SeaportOrderParameters = {
  offerer: `0x${string}`;
  zone: `0x${string}`;
  offer: SeaportOfferItem[];
  consideration: SeaportConsiderationItem[];
  orderType: number;
  startTime: bigint;
  endTime: bigint;
  zoneHash: `0x${string}`;
  salt: bigint;
  conduitKey: `0x${string}`;
  totalOriginalConsiderationItems: bigint;
};

type SeaportOrderComponents = SeaportOrderParameters & {
  counter: bigint;
};

type SeaportTypedData = {
  domain: TypedDataDomain;
  types: Eip712Types;
  value: SeaportOrderComponents;
  parameters: SeaportOrderParameters;
};

/**
 * Build a Seaport 1.6 fixed-price listing:
 *  - ERC721
 *  - 1 unit
 *  - 1% marketplace fee to OpenSea (OPENSEA_FEE_BPS)
 *  - remaining proceeds to the seller
 */
function buildSimpleSeaportListingTypedData(args: {
  chainId: number;
  offerer: `0x${string}`;
  contractAddress: `0x${string}`;
  tokenId: string;
  priceEth: number;
  durationDays: number;
}): SeaportTypedData {
  const { chainId, offerer, contractAddress, tokenId, priceEth, durationDays } = args;

  const nowSec = Math.floor(Date.now() / 1000);
  const endSec = nowSec + Math.max(1, Math.floor(durationDays || 1)) * 24 * 60 * 60;

  // ETH → wei
  const priceWei = BigInt(Math.round(priceEth * 1e18));
  const tokenIdBigInt = BigInt(tokenId);

  // --- Fee split: 1% (OPENSEA_FEE_BPS) to OpenSea, rest to seller ----
  const osFeeWei = (priceWei * BigInt(OPENSEA_FEE_BPS)) / BigInt(FEE_DENOMINATOR);
  const sellerWei = priceWei - osFeeWei;

  if (sellerWei <= 0n) {
    throw new Error("Price too low relative to fees: seller amount <= 0");
  }

  // Offer: you give 1 ERC721
  const offer: SeaportOfferItem[] = [
    {
      // 2 = ERC721
      itemType: 2,
      token: contractAddress,
      identifierOrCriteria: tokenIdBigInt,
      startAmount: 1n,
      endAmount: 1n,
    },
  ];

  // Consideration: buyer sends ETH to seller + OpenSea fee recipient
  const consideration: SeaportConsiderationItem[] = [
    {
      // Seller proceeds
      itemType: 0, // 0 = native token
      token: "0x0000000000000000000000000000000000000000",
      identifierOrCriteria: 0n,
      startAmount: sellerWei,
      endAmount: sellerWei,
      recipient: offerer,
    },
    {
      // OpenSea 1% fee
      itemType: 0,
      token: "0x0000000000000000000000000000000000000000",
      identifierOrCriteria: 0n,
      startAmount: osFeeWei,
      endAmount: osFeeWei,
      recipient: OPENSEA_FEE_RECIPIENT,
    },
  ];

  const parameters: SeaportOrderParameters = {
    offerer,
    // OpenSea default Seaport zone
    zone: OPENSEA_ZONE,
    offer,
    consideration,
    orderType: 2, // FULL_RESTRICTED
    startTime: BigInt(nowSec),
    endTime: BigInt(endSec),
    zoneHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    salt: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
    conduitKey: OPENSEA_CONDUIT_KEY,
    totalOriginalConsiderationItems: BigInt(consideration.length),
  };

  const value: SeaportOrderComponents = {
    ...parameters,
    counter: 0n, // OpenSea will override when persisting the order
  };

  const domain: TypedDataDomain = {
    name: "Seaport",
    version: "1.6",
    chainId,
    verifyingContract: SEAPORT_1_6_ADDRESS,
  };

  const types: Eip712Types = {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    OfferItem: [
      { name: "itemType", type: "uint8" },
      { name: "token", type: "address" },
      { name: "identifierOrCriteria", type: "uint256" },
      { name: "startAmount", type: "uint256" },
      { name: "endAmount", type: "uint256" },
    ],
    ConsiderationItem: [
      { name: "itemType", type: "uint8" },
      { name: "token", type: "address" },
      { name: "identifierOrCriteria", type: "uint256" },
      { name: "startAmount", type: "uint256" },
      { name: "endAmount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    OrderComponents: [
      { name: "offerer", type: "address" },
      { name: "zone", type: "address" },
      { name: "offer", type: "OfferItem[]" },
      { name: "consideration", type: "ConsiderationItem[]" },
      { name: "orderType", type: "uint8" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "zoneHash", type: "bytes32" },
      { name: "salt", type: "uint256" },
      { name: "conduitKey", type: "bytes32" },
      { name: "counter", type: "uint256" },
    ],
  };

  return { domain, types, value, parameters };
}

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

type Theme = "base-light" | "farcaster-dark";

function isDarkTheme(theme: Theme) {
  return theme === "farcaster-dark";
}

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const hideTimers = React.useRef<Record<string, number>>({});

  function scheduleAutoHide(id: string, duration = 3000) {
    if (typeof window === "undefined") return;

    const existing = hideTimers.current[id];
    if (existing) {
      window.clearTimeout(existing);
      delete hideTimers.current[id];
    }

    const timer = window.setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id));
      delete hideTimers.current[id];
    }, duration);

    hideTimers.current[id] = timer;
  }

  function showToast(type: ToastType, message: string) {
    const id = Math.random().toString(36).slice(2);
    const toast: ToastItem = { id, type, message };

    setItems((prev) => [...prev.slice(-2), toast]);

    // Non-loading toasts auto-hide
    if (type !== "loading") {
      scheduleAutoHide(id);
    }

    return id;
  }

  function hideToast(id: string) {
    if (typeof window !== "undefined") {
      const existing = hideTimers.current[id];
      if (existing) {
        window.clearTimeout(existing);
        delete hideTimers.current[id];
      }
    }

    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateToast(id: string, patch: Partial<Omit<ToastItem, "id">>) {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

    // If type is changed and becomes non-loading, auto-hide it
    if (patch.type && patch.type !== "loading") {
      scheduleAutoHide(id);
    }
  }

  return (
    <ToastContext.Provider value={{ showToast, hideToast, updateToast }}>
      {children}

      {/* ToastHost UI */}
      <div className="pointer-events-none fixed top-3 right-0 left-0 z-[9999] flex flex-col items-center space-y-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm animate-[fadeInUp_0.25s_ease-out] items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-lg"
          >
            {t.type === "success" && <span className="text-lg text-emerald-600">✓</span>}
            {t.type === "error" && <span className="text-lg text-red-500">⚠</span>}
            {t.type === "loading" && (
              <svg className="h-4 w-4 animate-spin text-neutral-500" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
            )}
            <span className="flex-1 text-[13px] text-neutral-800">{t.message}</span>

            {t.type === "loading" && (
              <button onClick={() => hideToast(t.id)} className="text-[11px] text-neutral-500">
                Hide
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function App() {
  // Theme: Base (light) vs Farcaster (dark)
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "base-light";
    const stored = window.localStorage.getItem("deck:theme");
    if (stored === "base-light" || stored === "farcaster-dark") {
      return stored as Theme;
    }
    return "base-light";
  });

  // Remember last chain from localStorage, default to base
  const [chain, setChain] = useState<Chain>(() => {
    if (typeof window === "undefined") return "base";
    const stored = window.localStorage.getItem("deck:chain");
    if (
      stored === "base" ||
      stored === "ethereum" ||
      stored === "arbitrum" ||
      stored === "optimism"
    ) {
      return stored as Chain;
    }
    return "base";
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

  // Persist theme selection
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("deck:theme", theme);
  }, [theme]);

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
  const showEmpty = isConnected && !loading && !error && nfts.length === 0;

  const isDetailView = !!selectedNft;

  return (
    <div
      className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]"
      style={{
        paddingTop: 16 + safeArea.top,
        paddingBottom: 16 + safeArea.bottom,
        paddingLeft: 16 + safeArea.left,
        paddingRight: 16 + safeArea.right,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
      data-theme={theme}
    >
      <header className="mb-4 space-y-3">
        {/* Row 1: Logo + profile */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col justify-start">
            <div className="-mt-[1px] flex items-start gap-2">
              <img src="/deck-icon.png" alt="Deck" className="h-7 w-auto" />
              <span className="text-xl font-semibold tracking-tight text-neutral-900">Deck</span>
            </div>

            <p className="mt-1 text-[11px] leading-tight text-neutral-500">
              Sell your NFTs directly inside Farcaster.
            </p>
          </div>

          {/* Farcaster profile pill */}
          <div className="w-[55%] max-w-[240px]">
            <ConnectMenu user={fcUser} />
          </div>
        </div>

        {/* Row 2: Theme toggle + chain selector */}
        <div className="flex items-center gap-2">
          <ThemeToggle theme={theme} onChange={setTheme} />

          <div className="flex flex-1 items-center justify-end">
            <div className="w-fit max-w-[240px]">
              <ChainSelector chain={chain} onChange={setChain} disabled={isDetailView} theme={theme} />
            </div>
          </div>
        </div>
      </header>

      {/* Soft fade separator between header and content */}
      <div className="pointer-events-none -mt-1 mb-2 h-[12px] bg-gradient-to-b from-[var(--surface-secondary)] to-transparent" />

      <main className={isDetailView ? "mt-2" : "mt-4"}>
        {!isDetailView && (
          <>
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
                You don&apos;t have any NFTs on {prettyChain(chain)} for this wallet.
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
          border border-[var(--border)] bg-[var(--surface)]
          p-2 shadow-sm transition-all duration-200
          hover:-translate-y-[2px] hover:border-[var(--primary)] hover:shadow-lg
          focus:outline-none focus:ring-2 focus:ring-[var(--primary)]
          focus:ring-offset-2 focus:ring-offset-[var(--bg)]
          active:translate-y-0 active:shadow-sm
        "

                  >
                    {/* Inner image container */}
                    <div className="relative w-full overflow-hidden rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-200 pb-[100%]">
                      {nft.image_url ? (
                        <img
                          src={nft.image_url}
                          alt={nft.name || `NFT #${nft.identifier}`}
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-500">
                          No image
                        </div>
                      )}

                      {/* Token ID badge */}
                      <div className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
                        #{nft.identifier}
                      </div>
                    </div>

                    {/* Text area */}
                    <div className="space-y-0.5 px-0.5 pt-2 pb-1.5 text-left">
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
          </>
        )}

        {isDetailView && selectedNft && (
          <NftDetailPage chain={chain} nft={selectedNft} onBack={() => setSelectedNft(null)} />
        )}
      </main>
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

  const displayName = user?.displayName || user?.username || "Farcaster user";

  if (isConnected) {
    return (
      <div className="flex items-center justify-end gap-2 rounded-2xl bg-transparent px-1 py-2">
        {/* Text block – fully right aligned */}
        <div className="flex min-w-0 flex-col items-end text-right">
          <span className="truncate text-[12px] leading-tight font-semibold text-neutral-900">
            {displayName}
          </span>

          <span className="flex items-center gap-1 text-[10px] leading-tight text-neutral-500">
            <span className="inline-block h-[9px] w-[9px] rounded-[3px] border border-neutral-400/70" />
            <span className="max-w-[130px] truncate">{shortenAddress(address)}</span>
          </span>
        </div>

        {/* Avatar on the far right */}
        <div className="relative h-9 w-9 flex-shrink-0">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-400 to-purple-500" />
          <div className="absolute inset-[2px] overflow-hidden rounded-full bg-neutral-900">
            {user?.pfpUrl ? (
              <img src={user.pfpUrl} alt={displayName} className="h-full w-full object-cover" />
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
      className="w-full rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-[var(--primary-text)] shadow-sm transition-all duration-150 hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? "Connecting…" : "Connect Farcaster wallet"}
    </button>
  );
}
function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const isDark = isDarkTheme(theme);

  return (
    <button
      type="button"
      onClick={() => onChange(isDark ? "base-light" : "farcaster-dark")}
      className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-secondary)] px-1 py-1 text-[10px] font-medium text-[var(--text-secondary)] shadow-sm backdrop-blur-sm"
    >
      <span
        className={[
          "flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors",
          !isDark ? "bg-neutral-900 text-white" : "text-neutral-500",
        ].join(" ")}
      >
        <span>☀️</span>
        <span>Base</span>
      </span>
      <span
        className={[
          "flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors",
          isDark ? "bg-purple-600 text-white" : "text-neutral-500",
        ].join(" ")}
      >
        <span>🌙</span>
        <span>Farcaster</span>
      </span>
    </button>
  );
}

/**
 * Chain selector: multi-network with bottom sheet
 */
function ChainSelector({
  chain,
  onChange,
  disabled,
  theme,     // ← add this
}: {
  chain: Chain;
  onChange: (c: Chain) => void;
  disabled?: boolean;
  theme: Theme;   // ← add this
}) {
  const [open, setOpen] = useState(false);

  const options: {
    label: string;
    value: Chain;
    badge?: string;
    icon: string;
  }[] = [
    { label: "Base", value: "base", badge: "Default", icon: "/chains/base.svg" },
    { label: "Ethereum", value: "ethereum", icon: "/chains/ethereum.svg" },
    { label: "Arbitrum", value: "arbitrum", icon: "/chains/arbitrum.svg" },
    { label: "Optimism", value: "optimism", icon: "/chains/optimism.svg" },
  ];

  const current = options.find((opt) => opt.value === chain) ?? options[0];

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <>
      {/* Compact pill in header */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-primary)] shadow-sm hover:bg-[var(--surface-secondary)] active:bg-[var(--surface-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Icon + label + Change all in one row, tight spacing */}
        <div className="flex min-w-0 items-center gap-1.5">
          <img src={current.icon} className="h-3.5 w-3.5" alt="" />
          <span>{current.label}</span>

          <span className="ml-2 flex items-center gap-0.5 text-[10px] leading-none text-neutral-400">
            <span>Change</span>
            <span className="text-[8px]">▾</span>
          </span>
        </div>
      </button>

      {/* Bottom sheet network picker */}
      {open && !disabled && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 h-full w-full"
            onClick={() => setOpen(false)}
          />

          <div
  className={
    isDarkTheme(theme)
      ? "relative z-40 w-full max-w-sm rounded-t-3xl border border-neutral-700 bg-[#181818] px-4 pt-3 pb-4 shadow-xl"
      : "relative z-40 w-full max-w-sm rounded-t-3xl border border-neutral-200 bg-white px-4 pt-3 pb-4 shadow-xl"
  }
>

            <div className="mx-auto mb-3 h-1 w-8 rounded-full bg-neutral-300" />
            <div className="mb-2 text-center text-[12px] font-semibold text-neutral-900">
              Select network
            </div>

            <div className="space-y-1.5">
              {options.map((opt) => {
                const active = opt.value === chain;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={[
                    "flex w-full items-center justify-between rounded-2xl px-3 py-2 text-[12px]",
                    isDarkTheme(theme)
                      ? active
                        ? "bg-[#262626] text-white"                        // active item in dark
                        : "bg-[#1f1f1f] text-neutral-300 hover:bg-[#2a2a2a]" // inactive item in dark
                      : active
                        ? "bg-neutral-900 text-white"                      // active item in light
                        : "bg-neutral-50 text-neutral-800 hover:bg-neutral-100", // inactive in light
                  ].join(" ")}

                  >
                    <div className="flex items-center gap-2">
                      <img src={opt.icon} className="h-4 w-4" alt="" />
                      <span>{opt.label}</span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px]">
                      {opt.badge && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                          {opt.badge}
                        </span>
                      )}
                      {active && <span>✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
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
          <div className="w-full bg-neutral-200/70 pb-[100%]" />
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
 * NFT detail page (full-screen view)
 */
type NormalizedTrait = {
  label: string;
  value: string;
};

type SimpleOffer = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  maker: string | null;
  expirationTime: number | null;
  protocolAddress: string | null;
};

type FloorInfo = {
  eth: number | null;
  formatted: string | null;
};

// updated Listing type: include optional name + image fields
type Listing = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  maker: string | null;
  expirationTime: number | null;
  protocolAddress: string | null;
  tokenId?: string | null;
  tokenContract?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  image?: string | null;
};

type Sale = {
  id: string;
  priceEth: number;
  priceFormatted: string;
  buyer: string | null;
  seller: string | null;
  paymentTokenSymbol: string | null;
  transactionHash: string | null;
  timestamp: number | null;

  // extra metadata (optional, filled by backend if available)
  tokenId?: string | null;
  tokenName?: string | null;
  collectionSlug?: string | null;
  collectionName?: string | null;
};

/**
 * Market history point
 */
type MarketPoint = {
  timestamp: number;
  priceEth: number;
  source: "floor" | "offer" | "sale" | "other";
};

type ApprovalStatus = "unknown" | "checking" | "approved" | "not-approved" | "error";

function NftDetailPage({
  chain,
  nft,
  onBack,
}: {
  chain: Chain;
  nft: OpenSeaNft;
  onBack: () => void;
}) {
  const [bestOffer, setBestOffer] = useState<SimpleOffer | null>(null);
  const [offers, setOffers] = useState<SimpleOffer[]>([]);
  const [floor, setFloor] = useState<FloorInfo>({
    eth: null,
    formatted: null,
  });
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState<string | null>(null);

  const [traits, setTraits] = useState<NormalizedTrait[]>([]);
  const [traitsLoading, setTraitsLoading] = useState(false);
  const [traitsError, setTraitsError] = useState<string | null>(null);

  const [showSellSheet, setShowSellSheet] = useState(false);
  const [showListSheet, setShowListSheet] = useState(false);
  const [showCancelSheet, setShowCancelSheet] = useState(false);

  const [listings, setListings] = useState<Listing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [listingsRefreshNonce, setListingsRefreshNonce] = useState(0);
  const [myListing, setMyListing] = useState<Listing | null>(null);

  const [sales, setSales] = useState<Sale[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);

  // Market history state (from dedicated endpoint)
  const [marketPoints, setMarketPoints] = useState<MarketPoint[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);

  // Wallet + clients for approval logic
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { showToast, updateToast } = useToast();

  // Approval state
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("unknown");
  const [approving, setApproving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [approvalErrorMsg, setApprovalErrorMsg] = useState<string | null>(null);

  const [actionSuccess, setActionSuccess] = useState<{
    title: string;
    message: string;
    txHash: string;
  } | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  // Offers + floor
  useEffect(() => {
    if (!nft) {
      setBestOffer(null);
      setOffers([]);
      setFloor({ eth: null, formatted: null });
      setOffersError(null);
      setOffersLoading(false);
      return;
    }

    const collectionSlug = getCollectionSlug(nft);

    if (!collectionSlug) {
      setBestOffer(null);
      setOffers([]);
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
      identifier: String(nft.identifier),
    });

    fetch(`/api/opensea/offers?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch offers");
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        const best: SimpleOffer | null = json.bestOffer ?? null;
        setBestOffer(best);
        setFloor(
          json.floor ?? {
            eth: null,
            formatted: null,
          },
        );

        const list: SimpleOffer[] = Array.isArray(json.offers) ? json.offers : best ? [best] : [];
        setOffers(list.slice(0, 3));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load offers", err);
        setOffersError("open_sea_error");
        setBestOffer(null);
        setOffers([]);
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

    const contractAddress = typeof nft.contract === "string" ? nft.contract : undefined;

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
      identifier: String(nft.identifier),
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

  // Top 3 cheapest listings in this collection (using best listings by collection)
  useEffect(() => {
    const collectionSlug = getCollectionSlug(nft);

    if (!nft || !collectionSlug) {
      setListings([]);
      setListingsError(null);
      setListingsLoading(false);
      return;
    }

    let cancelled = false;
    setListingsLoading(true);
    setListingsError(null);

    const params = new URLSearchParams({
      chain,
      collection: collectionSlug,
      limit: "3",
    });

    fetch(`/api/opensea/listings?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch listings");
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) {
          setListingsError("open_sea_error");
          setListings([]);
          return;
        }

        const raw: Listing[] = Array.isArray(json.listings) ? json.listings : [];

        // de-dupe by (tokenContract, tokenId)
        const seen = new Set<string>();
        const unique: Listing[] = [];

        for (const l of raw) {
          const key = (l.tokenContract?.toLowerCase() || "") + ":" + (l.tokenId ?? l.id);
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(l);
          if (unique.length === 3) break;
        }

        setListings(unique);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load listings", err);
        setListingsError("open_sea_error");
        setListings([]);
      })
      .finally(() => {
        if (cancelled) return;
        setListingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chain, nft, listingsRefreshNonce]);

  // Sales for this collection (by contract, fallback to collection slug)
  useEffect(() => {
    if (!nft) {
      setSales([]);
      setSalesError(null);
      setSalesLoading(false);
      return;
    }

    const contractAddress = typeof nft.contract === "string" ? nft.contract : undefined;
    const collectionSlug = getCollectionSlug(nft);

    if (!contractAddress && !collectionSlug) {
      setSales([]);
      setSalesError(null);
      setSalesLoading(false);
      return;
    }

    let cancelled = false;
    setSalesLoading(true);
    setSalesError(null);

    const params = new URLSearchParams({
      chain,
      // keep 3 for UI but fetch more points for chart
      limit: "10",
      ...(contractAddress ? { contract: contractAddress } : {}),
      ...(collectionSlug ? { collection: collectionSlug } : {}),
    });

    fetch(`/api/opensea/sales?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch sales");
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) {
          setSalesError("open_sea_error");
          setSales([]);
          return;
        }
        setSales(Array.isArray(json.sales) ? json.sales : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load sales", err);
        setSalesError("open_sea_error");
        setSales([]);
      })
      .finally(() => {
        if (cancelled) return;
        setSalesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chain, nft]);

  // Primary market history from dedicated endpoint
  useEffect(() => {
    if (!nft) {
      setMarketPoints([]);
      setMarketError(null);
      setMarketLoading(false);
      return;
    }

    const contractAddress = typeof nft.contract === "string" ? nft.contract : undefined;
    const collectionSlug = getCollectionSlug(nft);

    if (!contractAddress && !collectionSlug) {
      setMarketPoints([]);
      setMarketError(null);
      setMarketLoading(false);
      return;
    }

    let cancelled = false;
    setMarketLoading(true);
    setMarketError(null);

    const params = new URLSearchParams({
      chain,
      limit: "100",
      ...(contractAddress ? { contract: contractAddress } : {}),
      ...(collectionSlug ? { collection: collectionSlug } : {}),
    });

    fetch(`/api/opensea/market-history?${params.toString()}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch market history (${res.status})`);
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;

        console.log("market-history json", json);

        if (json.ok === false) {
          setMarketError("open_sea_error");
          setMarketPoints([]);
          return;
        }

        let raw: any[] = [];
        if (Array.isArray(json.points)) raw = json.points;
        else if (Array.isArray(json.sales)) raw = json.sales;
        else if (Array.isArray(json.data)) raw = json.data;

        const normalized: MarketPoint[] = [];

        for (const p of raw) {
          if (!p) continue;

          const tsRaw = p.timestamp ?? p.time ?? p.blockTime ?? p.block_timestamp;

          let ts: number | null = null;
          if (typeof tsRaw === "number") {
            ts = tsRaw;
          } else if (typeof tsRaw === "string") {
            const n = Number(tsRaw);
            if (Number.isFinite(n) && n > 1000000000) {
              ts = n;
            } else {
              const d = new Date(tsRaw);
              if (!isNaN(d.getTime())) {
                ts = Math.floor(d.getTime() / 1000);
              }
            }
          }

          const priceRaw =
            p.priceEth ?? p.price_eth ?? p.price ?? p.salePriceEth ?? p.sale_price_eth;

          const price =
            typeof priceRaw === "number"
              ? priceRaw
              : typeof priceRaw === "string"
                ? parseFloat(priceRaw)
                : NaN;

          if (!ts || !Number.isFinite(price) || price <= 0) continue;

          const sourceRaw = p.source;
          const source: MarketPoint["source"] =
            sourceRaw === "floor" ||
            sourceRaw === "offer" ||
            sourceRaw === "sale" ||
            sourceRaw === "other"
              ? sourceRaw
              : "sale";

          normalized.push({
            timestamp: ts,
            priceEth: price,
            source,
          });
        }

        setMarketPoints(normalized);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load market history", err);
        setMarketError("open_sea_error");
        setMarketPoints([]);
      })
      .finally(() => {
        if (cancelled) return;
        setMarketLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chain, nft]);

  // Fetch listings specifically for this tokenId + contract (to detect "my listing")
  useEffect(() => {
    const contractAddress = nft && typeof nft.contract === "string" ? nft.contract : undefined;

    if (!nft || !contractAddress || !address) {
      setMyListing(null);
      return;
    }

    let cancelled = false;
    setMyListing(null);

    const params = new URLSearchParams({
      chain,
      contract: contractAddress,
      tokenId: String(nft.identifier),
      limit: "10",
    });

    fetch(`/api/opensea/listing-by-token?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch token listing");
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (!json.ok || !Array.isArray(json.listings)) {
          setMyListing(null);
          return;
        }

        // Prefer listing where maker == current wallet
        const lowerAddr = address.toLowerCase();
        const mine =
          json.listings.find((l: Listing) => l.maker && l.maker.toLowerCase() === lowerAddr) ??
          null;

        setMyListing(mine);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load token listing", err);
        setMyListing(null);
      });

    return () => {
      cancelled = true;
    };
  }, [chain, nft, address, listingsRefreshNonce]);

  // Approval status: read isApprovedForAll(owner, OPENSEA_SEAPORT_CONDUIT)
  useEffect(() => {
    const contractAddress = nft && typeof nft.contract === "string" ? nft.contract : undefined;

    if (!publicClient || !address || !contractAddress) {
      setApprovalStatus("unknown");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setApprovalStatus("checking");
        const approved = await publicClient.readContract({
          address: contractAddress as `0x${string}`,
          abi: erc721Or1155ApprovalAbi,
          functionName: "isApprovedForAll",
          args: [address as `0x${string}`, OPENSEA_SEAPORT_CONDUIT as `0x${string}`],
        });

        if (!cancelled) {
          setApprovalStatus(approved ? "approved" : "not-approved");
        }
      } catch (err) {
        console.error("Failed to read approval", err);
        if (!cancelled) {
          setApprovalStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient, address, nft, chain]);

  // Fallback market points derived directly from sales
  const derivedMarketPoints: MarketPoint[] = useMemo(
    () =>
      (sales || [])
        .filter(
          (s) =>
            typeof s.timestamp === "number" &&
            s.timestamp > 0 &&
            typeof s.priceEth === "number" &&
            s.priceEth > 0,
        )
        .sort((a, b) => a.timestamp! - b.timestamp!)
        .map((s) => ({
          timestamp: s.timestamp as number,
          priceEth: s.priceEth,
          source: "sale" as const,
        })),
    [sales],
  );

  // Use primary market-history if it has enough points, otherwise fall back to sales-derived points
  const chartPoints: MarketPoint[] = marketPoints.length > 1 ? marketPoints : derivedMarketPoints;

  const isBusy = offersLoading || traitsLoading || listingsLoading || salesLoading || marketLoading;

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

  function formatTimeAgo(timestamp: number | null): string | null {
    if (!timestamp) return null;
    const now = Date.now() / 1000;
    let diff = now - timestamp;
    if (diff < 0) diff = 0;

    const days = Math.floor(diff / (3600 * 24));
    const hours = Math.floor((diff % (3600 * 24)) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);

    if (days >= 7) {
      const d = new Date(timestamp * 1000);
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }

    if (days > 0) {
      if (hours > 0) return `${days}d ${hours}h ago`;
      return `${days}d ago`;
    }

    if (hours > 0) {
      if (minutes > 0) return `${hours}h ${minutes}m ago`;
      return `${hours}h ago`;
    }

    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  }

  function formatBestVsFloorDiff(offer: SimpleOffer | null, f: FloorInfo): string | null {
    if (!offer || f.eth == null || f.eth <= 0) return null;

    const diff = offer.priceEth - f.eth;
    const diffPct = (diff / f.eth) * 100;

    const absPct = Math.abs(diffPct).toFixed(1);

    if (diffPct > 0) {
      return `Best offer is ${absPct}% above floor`;
    }
    if (diffPct < 0) {
      return `Best offer is ${absPct}% below floor`;
    }
    return "Best offer is at floor";
  }

  async function handleApproveOpenSea() {
    if (!walletClient || !address) {
      showToast("error", "Wallet not connected.");
      return;
    }

    const contractAddress = nft && typeof nft.contract === "string" ? nft.contract : undefined;

    if (!contractAddress) {
      showToast("error", "Missing NFT contract.");
      return;
    }

    const loadingId = showToast("loading", "Sending approval…");
    setApproving(true);
    setApprovalErrorMsg(null);

    try {
      const chainId = chainIdFromChain(chain);

      const dataToSend = encodeFunctionData({
        abi: erc721Or1155ApprovalAbi,
        functionName: "setApprovalForAll",
        args: [OPENSEA_SEAPORT_CONDUIT as `0x${string}`, true],
      });

      const txHash = await walletClient.sendTransaction({
        account: address as `0x${string}`,
        chain: { id: chainId } as any,
        to: contractAddress as `0x${string}`,
        data: dataToSend as `0x${string}`,
        value: 0n,
      });

      updateToast(loadingId, {
        type: "success",
        message: "NFT approved!",
      });
      setApprovalStatus("approved");
      setActionSuccess({
        title: "Collection approved",
        message:
          "This collection is now approved for trading via OpenSea Seaport. You can list and accept offers from Deck.",
        txHash,
      });
    } catch (err) {
      console.error("Approval tx failed", err);
      updateToast(loadingId, {
        type: "error",
        message: "Approval failed.",
      });
      setApprovalStatus("error");
      setActionError("Approval failed. Please check your wallet or network and try again.");
    } finally {
      setApproving(false);
    }
  }

  async function handleRevokeOpenSea() {
    if (!walletClient || !address) {
      showToast("error", "Wallet not connected.");
      return;
    }

    const contractAddress = nft && typeof nft.contract === "string" ? nft.contract : undefined;

    if (!contractAddress) {
      showToast("error", "Missing NFT contract.");
      return;
    }

    const loadingId = showToast("loading", "Revoking approval…");
    setRevoking(true);
    setApprovalErrorMsg(null);

    try {
      const chainId = chainIdFromChain(chain);

      const dataToSend = encodeFunctionData({
        abi: erc721Or1155ApprovalAbi,
        functionName: "setApprovalForAll",
        args: [OPENSEA_SEAPORT_CONDUIT as `0x${string}`, false],
      });

      const txHash = await walletClient.sendTransaction({
        account: address as `0x${string}`,
        chain: { id: chainId } as any,
        to: contractAddress as `0x${string}`,
        data: dataToSend as `0x${string}`,
        value: 0n,
      });

      updateToast(loadingId, {
        type: "success",
        message: "Approval revoked",
      });
      setApprovalStatus("not-approved");
      setActionSuccess({
        title: "Approval revoked",
        message:
          "OpenSea Seaport approval for this collection has been revoked. You&apos;ll need to approve again before trading.",
        txHash,
      });
    } catch (err) {
      console.error("Revoke tx failed", err);
      updateToast(loadingId, {
        type: "error",
        message: "Revoke failed.",
      });
      setApprovalStatus("error");
      setActionError("We couldn&apos;t revoke this approval. Please try again.");
    } finally {
      setRevoking(false);
    }
  }

  if (!nft) return null;

  const collectionName = getCollectionLabel(nft);
  const chainLabel = prettyChain(chain);
  const collectionSlug = getCollectionSlug(nft);
  const contractAddress = typeof nft.contract === "string" ? nft.contract : undefined;
  const hasMyListing = !!myListing;

  const listingThumb =
    myListing?.imageUrl || myListing?.image_url || myListing?.image || nft.image_url || null;

  const canAcceptBestOffer = !!bestOffer && !!contractAddress && !offersLoading;

  const baseSearchQuery =
    (typeof nft.collection === "string" && nft.collection) || nft.name || nft.identifier || "";

  const chainSlugOs = openSeaChainSlug(chain);

  const nftUrl =
    nft.opensea_url ??
    (contractAddress
      ? `https://opensea.io/assets/${chainSlugOs}/${contractAddress}/${nft.identifier}`
      : null);

  let collectionUrl: string | null = null;

  if (collectionSlug && collectionSlug.length > 0) {
    collectionUrl = `https://opensea.io/collection/${collectionSlug}`;
  } else if (contractAddress) {
    collectionUrl = `https://opensea.io/assets/${chainSlugOs}/${contractAddress}`;
  } else if (baseSearchQuery) {
    collectionUrl = `https://opensea.io/assets?search[query]=${encodeURIComponent(
      baseSearchQuery,
    )}`;
  } else {
    collectionUrl = null;
  }

  return (
    <div className="relative space-y-4 pb-20" style={{ opacity: isBusy ? 0.96 : 1 }}>
      {/* Top bar */}
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[11px] text-neutral-700 shadow-sm hover:border-neutral-300 hover:bg-neutral-50"
        >
          <span className="text-xs">←</span>
          <span>Back to gallery</span>
        </button>
      </div>

      {/* Hero section */}
      <section className="flex flex-col gap-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
        <div className="flex gap-3">
          <div className="relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-2xl bg-neutral-100">
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

          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {nft.name || `Token #${nft.identifier}`}
              </div>
              <div className="mt-0.5 text-[11px] text-neutral-500">{collectionName}</div>
              <div className="mt-0.5 text-[10px] text-neutral-400">
                {chainLabel} • ID {nft.identifier}
              </div>
            </div>

            {nft.description && (
              <p className="mt-2 line-clamp-3 text-[11px] text-neutral-600">{nft.description}</p>
            )}
          </div>
        </div>

        {/* External links */}
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {nftUrl && (
              <a
                href={nftUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] px-2 py-1.5 text-center text-[11px] text-[var(--text-primary)] hover:border-[var(--primary)] hover:bg-[var(--surface)]"
              >
                View on OpenSea
              </a>
            )}

            {collectionUrl && (
              <a
                href={collectionUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] px-2 py-1.5 text-center text-[11px] text-[var(--text-primary)] hover:border-[var(--primary)] hover:bg-[var(--surface)]"
              >
                View collection
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Traits + market sections */}
      <section className="space-y-3">
        {/* Traits */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
              Traits
            </div>
            {traitsLoading && <div className="text-[10px] text-neutral-500">Loading…</div>}
          </div>

          {traitsError && !traitsLoading && (
            <div className="text-[11px] text-neutral-500">We can&apos;t show traits right now.</div>
          )}

          {!traitsLoading && !traitsError && traits.length === 0 && (
            <div className="text-[11px] text-neutral-500">No traits available for this NFT.</div>
          )}

          {!traitsLoading && !traitsError && traits.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {traits.map((trait) => (
                <div
                  key={`${trait.label}-${trait.value}`}
                  className="rounded-xl border border-neutral-200 bg-neutral-50 px-2 py-1 text-[10px]"
                >
                  <div className="text-[9px] tracking-wide text-neutral-500 uppercase">
                    {trait.label}
                  </div>
                  <div className="text-[11px] text-neutral-900">{trait.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Listing – top 3 cheapest listings in this collection */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
              Listing
            </div>
            <span className="text-[10px] text-neutral-400">Top 3 cheapest listings</span>
          </div>

          {listingsLoading && (
            <div className="rounded-xl bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-500">
              Loading listings…
            </div>
          )}

          {!listingsLoading && listingsError && (
            <div className="rounded-xl bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-500">
              We can&apos;t show listings right now.
            </div>
          )}

          {!listingsLoading && !listingsError && listings.length === 0 && (
            <div className="rounded-xl bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-500">
              No active listings found for this collection.
            </div>
          )}

          {!listingsLoading && !listingsError && listings.length > 0 && (
            <div className="space-y-1.5 text-[11px]">
              {listings.map((listing) => {
                const thumb =
                  listing.imageUrl || listing.image_url || listing.image || nft.image_url || null;

                const tokenLabel: string =
                  (listing.name && listing.name.length > 0
                    ? listing.name
                    : listing.tokenId
                      ? `${collectionName} #${listing.tokenId}`
                      : collectionName) ?? collectionName;

                return (
                  <div
                    key={listing.id}
                    className="flex items-center gap-2 rounded-xl bg-[var(--surface-secondary)] px-2 py-1.5"
                  >
                    {/* Thumbnail */}
                    <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-200">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={tokenLabel}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[9px] text-neutral-500">
                          —
                        </div>
                      )}
                    </div>

                    {/* Middle: name + address, Right: price + time */}
                    <div className="flex flex-1 items-center justify-between gap-2">
                      {/* Name + address */}
                      <div className="flex min-w-0 flex-col">
                        <span className="max-w-[150px] truncate text-neutral-800">
                          {tokenLabel}
                        </span>
                        <span className="text-[10px] text-neutral-500">
                          {listing.maker
                            ? `From ${shortenAddress(listing.maker)}`
                            : "Unknown seller"}
                        </span>
                      </div>

                      {/* Price + time */}
                      <div className="flex flex-col items-end text-right text-[10px]">
                        <span className="text-[11px] font-semibold text-neutral-900">
                          {listing.priceFormatted} ETH
                        </span>
                        <span className="text-neutral-400">
                          {formatTimeRemaining(listing.expirationTime) ?? "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Offers – top 3 WETH offers */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
              Offers
            </div>
            <span className="text-[10px] text-neutral-400">
              {offers.length > 0 ? "Top 3 WETH offers" : "No offer yet"}
            </span>
          </div>

          {offersLoading && (
            <div className="rounded-xl bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-500">
              Loading offers…
            </div>
          )}

          {!offersLoading && offersError && (
            <div className="rounded-xl bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-500">
              We can&apos;t show offers right now.
            </div>
          )}

          {!offersLoading && !offersError && offers.length === 0 && (
            <div className="rounded-xl bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-500">
              No active WETH offers for this NFT.
            </div>
          )}

          {!offersLoading && !offersError && offers.length > 0 && (
            <div className="space-y-1.5 text-[11px]">
              {offers.map((offer, idx) => {
                const isBest = bestOffer && offer.id === bestOffer.id && idx === 0;
                return (
                  <div
                    key={offer.id}
                    className="flex items-center justify-between rounded-xl bg-[var(--surface-secondary)] px-2 py-1.5"
                  >
                    <div className="flex flex-col">
                      <span className="text-emerald-600">{offer.priceFormatted} WETH</span>
                      <span className="text-[10px] text-neutral-500">
                        {offer.maker ? `From ${shortenAddress(offer.maker)}` : "Unknown maker"}
                      </span>
                    </div>
                    <div className="flex flex-col items-end text-right text-[10px]">
                      <span className="text-neutral-500">
                        {formatTimeRemaining(offer.expirationTime) ?? "—"}
                      </span>
                      <span className="text-neutral-400">{isBest ? "Best offer" : "Offer"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sales – last 3 sales for this collection */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
              Sales
            </div>
            <span className="text-[10px] text-neutral-400">Last 3 sales</span>
          </div>

          {salesLoading && (
            <div className="rounded-xl bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-500">
              Loading sales…
            </div>
          )}

          {!salesLoading && salesError && (
            <div className="rounded-xl bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-500">
              We can&apos;t show sales right now.
            </div>
          )}

          {!salesLoading && !salesError && sales.length === 0 && (
            <div className="rounded-xl bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-500">
              No recent on-chain sales found for this collection.
            </div>
          )}

          {!salesLoading && !salesError && sales.length > 0 && (
            <div className="space-y-1.5 text-[11px]">
              {sales.slice(0, 3).map((sale) => {
                const fallbackCollectionLabel =
                  sale.collectionName || sale.collectionSlug || collectionSlug || collectionName;

                const tokenLabelFromAny =
                  (sale as any).tokenName || (sale as any).nftName || (sale as any).name;

                const saleLabel: string =
                  tokenLabelFromAny ||
                  (sale.tokenId
                    ? `${fallbackCollectionLabel} #${sale.tokenId}`
                    : String(fallbackCollectionLabel));

                return (
                  <div
                    key={sale.id}
                    className="flex items-center justify-between rounded-xl bg-[var(--surface-secondary)] px-2 py-1.5"
                  >
                    <div className="flex flex-col">
                      <span className="text-neutral-700">
                        {sale.priceFormatted} {sale.paymentTokenSymbol ?? "ETH"}
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        {sale.seller
                          ? sale.buyer
                            ? `From ${shortenAddress(sale.seller)} → ${shortenAddress(sale.buyer)}`
                            : `From ${shortenAddress(sale.seller)}`
                          : "Unknown counterparties"}
                      </span>
                    </div>
                    <div className="flex flex-col items-end text-right text-[10px]">
                      <span className="max-w-[150px] truncate text-neutral-700">{saleLabel}</span>
                      <span className="text-neutral-500">
                        {formatTimeAgo(sale.timestamp) ?? "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Market: recent sale prices chart, with fallback */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
              Market
            </div>
            <span className="text-[10px] text-neutral-400">Recent collection sales</span>
          </div>

          <div className="flex h-32 items-center justify-center rounded-2xl bg-gradient-to-br from-neutral-50 via-neutral-100 to-neutral-50 px-2">
            {(marketLoading || (salesLoading && !chartPoints.length)) && !chartPoints.length && (
              <div className="text-[11px] text-neutral-500">Loading market data…</div>
            )}

            {!marketLoading && !salesLoading && marketError && chartPoints.length === 0 && (
              <div className="px-4 text-center text-[11px] text-neutral-500">
                We can&apos;t show market data right now.
              </div>
            )}

            {!marketLoading && !salesLoading && !marketError && chartPoints.length === 0 && (
              <div className="px-4 text-center text-[11px] text-neutral-500">
                We don&apos;t have enough historical data to draw a chart yet.
              </div>
            )}

            {chartPoints.length > 0 && <MarketChart points={chartPoints} />}
          </div>

          <p className="mt-2 text-[10px] text-neutral-400">
            Based on recent collection sales from OpenSea.
          </p>
        </div>

        {/* Price summary – bottom with actions + approval gating + listing info */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-neutral-600 uppercase">
            Price
          </div>

          {offersLoading && <div className="text-[11px] text-neutral-500">Loading price data…</div>}

          {!offersLoading && offersError && (
            <div className="text-[11px] text-neutral-500">
              We can&apos;t show price data right now.
            </div>
          )}

          {!offersLoading && !offersError && !bestOffer && !floor.formatted && (
            <div className="text-[11px] text-neutral-500">
              No price data available for this NFT.
            </div>
          )}

          {!offersLoading && !offersError && (bestOffer || floor.formatted) && (
            <div className="space-y-1 text-[11px]">
              {bestOffer && (
                <div className="flex items-baseline justify-between">
                  <span className="text-neutral-600">Best offer</span>
                  <div className="flex flex-col items-end">
                    <span className="font-semibold text-emerald-600">
                      {bestOffer.priceFormatted} WETH
                    </span>
                    {formatTimeRemaining(bestOffer.expirationTime) && (
                      <span className="text-[10px] text-neutral-500">
                        Expires in {formatTimeRemaining(bestOffer.expirationTime)}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {floor.formatted && (
                <div className="flex items-baseline justify-between">
                  <span className="text-neutral-600">Collection floor</span>
                  <span className="text-neutral-800">{floor.formatted} ETH</span>
                </div>
              )}
              {bestOffer && floor.formatted && formatBestVsFloorDiff(bestOffer, floor) && (
                <div className="flex items-baseline justify-between pt-0.5">
                  <span className="text-neutral-500">Context</span>
                  <span className="text-[10px] text-neutral-500">
                    {formatBestVsFloorDiff(bestOffer, floor)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Approval status row */}
          {contractAddress && (
            <div className="mt-3 flex items-center justify-between text-[10px]">
              <span className="text-neutral-500">OpenSea trading approval</span>
              <span className="font-medium">
                {approvalStatus === "approved" && (
                  <span className="text-emerald-600">Approved</span>
                )}
                {approvalStatus === "not-approved" && (
                  <span className="text-amber-600">Not approved</span>
                )}
                {approvalStatus === "checking" && (
                  <span className="text-neutral-500">Checking…</span>
                )}
                {approvalStatus === "error" && <span className="text-red-500">Error</span>}
                {approvalStatus === "unknown" && <span className="text-neutral-400">Unknown</span>}
              </span>
            </div>
          )}

          {approvalErrorMsg && <p className="mt-1 text-[10px] text-red-500">{approvalErrorMsg}</p>}

          {/* Action buttons + listing info */}
          <div className="mt-3 space-y-2">
            {/* If not approved -> single Approve button */}
            {contractAddress && approvalStatus !== "approved" && (
              <button
                type="button"
                className="w-full rounded-xl bg-[var(--primary)] py-2 text-[12px] font-semibold text-[var(--primary-text)] shadow-sm hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={approving || approvalStatus === "checking" || !address}
                onClick={handleApproveOpenSea}
              >
                {approving ? "Approving…" : "Approve collection for OpenSea"}
              </button>
            )}

            {/* If approved -> show Accept + List/Cancel + listing info + revoke */}
            {(!contractAddress || approvalStatus === "approved") && (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!canAcceptBestOffer}
                    onClick={() => setShowSellSheet(true)}
                    className={[
                      "flex-1 rounded-xl px-3 py-2 text-[12px] font-semibold shadow-sm",
                      canAcceptBestOffer
                        ? "border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-text)] hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]"
                        : "cursor-not-allowed border border-neutral-200 bg-neutral-100 text-neutral-400 opacity-60",
                    ].join(" ")}
                  >
                    {canAcceptBestOffer ? "Accept best offer" : "No offer available"}
                  </button>

                  <button
                    type="button"
                    disabled={!contractAddress || !address}
                    onClick={() =>
                      hasMyListing ? setShowCancelSheet(true) : setShowListSheet(true)
                    }
                    className="flex-1 rounded-xl border border-[var(--primary)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--primary)] shadow-sm hover:bg-[var(--surface-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {hasMyListing ? "Cancel listing" : "List on OpenSea"}
                  </button>
                </div>

                {/* Listing info card */}
                <div className="rounded-xl bg-[var(--surface-secondary)] px-3 py-2 text-[11px]">
                  {!contractAddress || !address ? (
                    <span className="text-neutral-500">
                      Connect wallet to see and manage your listing for this NFT.
                    </span>
                  ) : hasMyListing ? (
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-200">
                        {listingThumb ? (
                          <img
                            src={listingThumb}
                            alt={collectionName}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[9px] text-neutral-500">
                            —
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col">
                        <span className="text-neutral-800">
                          Listed for{" "}
                          <span className="font-semibold">{myListing?.priceFormatted} ETH</span>
                        </span>
                        <span className="text-[10px] text-neutral-500">
                          Expires{" "}
                          {formatTimeRemaining(myListing?.expirationTime ?? null) ?? "Unknown"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-neutral-500">This NFT is not listed on OpenSea yet.</span>
                  )}
                </div>

                {contractAddress && approvalStatus === "approved" && (
                  <button
                    type="button"
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={revoking}
                    onClick={handleRevokeOpenSea}
                  >
                    {revoking ? "Revoking approval…" : "Revoke OpenSea approval"}
                  </button>
                )}
              </>
            )}

            {!infoOrGasNoteShown(bestOffer, floor) && (
              <p className="text-[10px] text-neutral-400">
                You&apos;ll pay network gas for approval and some future transactions. Listings
                themselves may be gasless depending on how OpenSea handles them.
              </p>
            )}
          </div>
        </div>
      </section>

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

      {showListSheet && contractAddress && (
        <ListNftSheet
          chain={chain}
          contractAddress={contractAddress}
          tokenId={String(nft.identifier)}
          imageUrl={nft.image_url ?? null}
          collectionName={collectionName}
          onClose={() => setShowListSheet(false)}
          onListed={(listing) => {
            if (listing) {
              setMyListing(listing);
            }
            setListingsRefreshNonce((n) => n + 1);
          }}
        />
      )}

      {showCancelSheet && contractAddress && myListing && (
        <CancelListingSheet
          chain={chain}
          contractAddress={contractAddress}
          tokenId={String(nft.identifier)}
          listing={myListing}
          imageUrl={listingThumb}
          collectionName={collectionName}
          onClose={() => setShowCancelSheet(false)}
          onCancelled={() => {
            setShowCancelSheet(false);

            // Poll OpenSea until the listing is gone
            let attempts = 0;
            const poll = setInterval(() => {
              attempts++;

              // trigger a refresh
              setListingsRefreshNonce((n) => n + 1);

              // stop after 10 seconds max
              if (attempts > 10) clearInterval(poll);
            }, 1000);
          }}
        />
      )}
      {actionSuccess && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 h-full w-full"
            onClick={() => setActionSuccess(null)}
          />

          <div className="relative z-[90] w-full max-w-xs rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5 shadow-2xl">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
              <span className="text-lg text-emerald-600">✓</span>
            </div>

            <div className="text-center">
              <h2 className="text-sm font-semibold text-neutral-900">{actionSuccess.title}</h2>
              <p className="mt-1 text-[11px] leading-snug text-neutral-500">
                {actionSuccess.message}
              </p>
            </div>

            <a
              href={txExplorerUrl(chain, actionSuccess.txHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex w-full items-center justify-center rounded-xl border border-purple-500/70 bg-white py-2 text-[12px] font-semibold text-purple-700 hover:bg-purple-50"
            >
              View on explorer
            </a>

            <button
              type="button"
              onClick={() => setActionSuccess(null)}
              className="mt-2 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 h-full w-full"
            onClick={() => setActionError(null)}
          />

          <div className="relative z-[90] w-full max-w-xs rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5 shadow-2xl">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
              <span className="text-lg text-red-500">!</span>
            </div>

            <div className="text-center">
              <h2 className="text-sm font-semibold text-neutral-900">Action failed</h2>
              <p className="mt-1 text-[11px] leading-snug text-neutral-500">{actionError}</p>
            </div>

            <button
              type="button"
              onClick={() => setActionError(null)}
              className="mt-4 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Small helper so TS is happy for the extra note
 * (always returns false for now – just a hook to evolve later)
 */
function infoOrGasNoteShown(_bestOffer: SimpleOffer | null, _floor: FloorInfo): boolean {
  return false;
}

/**
 * Compact sparkline-style chart for market history (Option A)
 * - Clean line (no area fill, no constant dots)
 * - Emphasis on text summary: last price + date + range
 * - Tooltip + dot only when hovering
 *
 * Updated: higher-resolution SVG coordinates + geometricPrecision
 * to keep line width visually consistent.
 */
function MarketChart({ points }: { points: MarketPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const filtered = points
    .filter((p) => typeof p.timestamp === "number" && p.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (filtered.length < 2) {
    return (
      <div className="px-4 text-center text-[11px] text-neutral-500">
        Not enough data to show a chart yet.
      </div>
    );
  }

  const prices = filtered.map((p) => p.priceEth);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const paddedMin = minPrice * 0.99;
  const paddedMax = maxPrice * 1.01;
  const range = paddedMax - paddedMin || 1;

  // High-res internal coordinate system for smoother, more consistent stroke
  const width = 300;
  const height = 120;

  const pointCoords = filtered.map((p, idx) => {
    const x = filtered.length === 1 ? width / 2 : (idx / (filtered.length - 1)) * width;

    const normalized = (p.priceEth - paddedMin) / range;
    const y = height - normalized * (height - 8) - 4; // top/bottom padding

    return { x, y };
  });

  const pathD = pointCoords.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  const lastIdx = filtered.length - 1;
  const last = filtered[lastIdx];

  const activeIndex = hoverIndex;
  const activePoint = activeIndex != null ? filtered[activeIndex] : null;
  const activeCoord = activeIndex != null ? pointCoords[activeIndex] : null;

  function handleMove(evt: React.MouseEvent<SVGSVGElement>) {
    const rect = (evt.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * width;

    let nearest = 0;
    let nearestDist = Infinity;

    pointCoords.forEach((coord, idx) => {
      const dist = Math.abs(coord.x - x);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = idx;
      }
    });

    setHoverIndex(nearest);
  }

  function handleLeave() {
    setHoverIndex(null);
  }

  const formatEth = (v: number) => (v >= 1 ? v.toFixed(3) : v.toFixed(4));

  const formatShortDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });

  return (
    <div className="flex w-full flex-col gap-1.5">
      {/* Text summary row: last price + date + range */}
      <div className="flex items-baseline justify-between px-1">
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-neutral-900">
            {formatEth(last.priceEth)} ETH
          </span>
          <span className="text-[10px] text-neutral-500">
            Last sale • {formatShortDate(last.timestamp)}
          </span>
        </div>
        <div className="text-right text-[10px] text-neutral-500">
          <span className="mr-0.5">Range</span>
          <span className="font-medium text-neutral-800">
            {formatEth(minPrice)} – {formatEth(maxPrice)} ETH
          </span>
        </div>
      </div>

      {/* Sparkline chart */}
      <div className="relative mt-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-16 w-full overflow-visible"
          preserveAspectRatio="none"
          shapeRendering="geometricPrecision"
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        >
          {/* main line only (no fill) */}
          <path d={pathD} className="stroke-purple-600" strokeWidth={1.4} fill="none" />

          {/* highlighted point + guide only on hover */}
          {activePoint && activeCoord && (
            <>
              <line
                x1={activeCoord.x}
                x2={activeCoord.x}
                y1={0}
                y2={height}
                className="stroke-purple-200"
                strokeWidth={0.5}
                strokeDasharray="2 2"
              />
              <circle cx={activeCoord.x} cy={activeCoord.y} r={3.2} className="fill-white" />
              <circle cx={activeCoord.x} cy={activeCoord.y} r={2.2} className="fill-purple-600" />
            </>
          )}
        </svg>

        {/* Small tooltip, only when hovering */}
        {activePoint && activeCoord && (
          <div
            className="pointer-events-none absolute -top-3 left-0 flex justify-center"
            style={{
              transform: `translateX(${(activeCoord.x / width) * 100}%)`,
            }}
          >
            <div className="translate-x-[-50%] rounded-md border border-neutral-200 bg-white px-2 py-[2px] text-[10px] text-neutral-800 shadow-sm">
              {formatEth(activePoint.priceEth)} ETH{" "}
              <span className="text-neutral-400">• {formatShortDate(activePoint.timestamp)}</span>
            </div>
          </div>
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
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  return (
    nft.collection.name ||
    nft.collection.slug?.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "Unknown collection"
  );
}

function openSeaChainSlug(chain: Chain): string {
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

function prettyChain(chain: Chain): string {
  switch (chain) {
    case "base":
      return "Base";
    case "ethereum":
      return "Ethereum";
    case "arbitrum":
      return "Arbitrum";
    case "optimism":
      return "Optimism";
    default:
      return "Ethereum";
  }
}

function chainIdFromChain(chain: Chain): number {
  switch (chain) {
    case "base":
      return 8453;
    case "ethereum":
      return 1;
    case "arbitrum":
      return 42161;
    case "optimism":
      return 10;
    default:
      return 1;
  }
}
function txExplorerUrl(chain: Chain, txHash: string): string {
  switch (chain) {
    case "base":
      return `https://basescan.org/tx/${txHash}`;
    case "ethereum":
      return `https://etherscan.io/tx/${txHash}`;
    case "arbitrum":
      return `https://arbiscan.io/tx/${txHash}`;
    case "optimism":
      return `https://optimistic.etherscan.io/tx/${txHash}`;
    default:
      return `https://etherscan.io/tx/${txHash}`;
  }
}

function AppContainer() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  );
}

export default AppContainer;

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
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  function openErrorModal(message: string) {
    setError(message);
    setErrorMessage(message);
    setShowErrorModal(true);
  }

  const feePct = 2.5 / 100;
  const payout = offer.priceEth * (1 - feePct);
  const payoutFormatted = payout >= 1 ? payout.toFixed(3) : payout.toFixed(4);

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
        setInfo(json.message || "Accepting offers is not enabled yet. No transaction was created.");
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
        const { orders, criteriaResolvers, fulfillments, recipient } = tx.inputData;

        if (recipient && address && recipient.toLowerCase() !== address.toLowerCase()) {
          console.error("Recipient from backend does not match current address", {
            recipient,
            address,
          });
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
        setError("Backend did not return a usable transaction payload from OpenSea.");
        return;
      }

      const chainId = chainIdFromChain(chain);
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
      setLastTxHash(txHash);
      setShowSuccessModal(true); // show success modal
      // don't call onClose() here; modal will close the sheet
    } catch (err) {
      console.error("Error while sending transaction", err);
      openErrorModal(
        "Failed to send transaction. Please check your wallet or network and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/25 backdrop-blur-sm">
      <button className="absolute inset-0 h-full w-full" onClick={onClose} />

      <div className="relative z-[70] w-full max-w-sm rounded-t-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 shadow-xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />

        <h2 className="text-center text-sm font-semibold text-neutral-900">Accept best offer</h2>

        <div className="mt-4 space-y-3 text-[12px]">
          <div className="flex justify-between">
            <span className="text-neutral-600">Offer</span>
            <span className="font-semibold text-neutral-900">{offer.priceFormatted} WETH</span>
          </div>

          <div className="flex justify-between">
            <span className="text-neutral-600">OpenSea fee (2.5%)</span>
            <span className="text-neutral-500">-{(offer.priceEth * 0.025).toFixed(4)} WETH</span>
          </div>

          <div className="flex justify-between border-t border-neutral-200 pt-1">
            <span className="text-neutral-700">You&apos;ll receive</span>
            <span className="font-semibold text-emerald-600">{payoutFormatted} WETH</span>
          </div>

          <div className="flex justify-between pt-1">
            <span className="text-neutral-500">Offer expires</span>
            <span className="text-neutral-600">{formatExpiration()}</span>
          </div>

          {error && <div className="mt-2 text-[11px] leading-tight text-red-500">{error}</div>}

          {info && !error && (
            <div className="mt-2 text-[11px] leading-tight text-amber-600">{info}</div>
          )}

          {!info && !error && (
            <div className="mt-2 space-y-1 text-[11px] leading-tight text-[var(--text-muted)]">
              <p>
                For your safety, the transaction will only proceed if the on-chain offer amount
                exactly matches the value shown here.
              </p>
              <p>
                Your wallet may show a banner like
                <span className="font-medium">
                  {" "}
                  &quot;Proceed with caution – The transaction uses the Seaport protocol to transfer
                  tokens to an untrusted address&quot;
                </span>
                . This is expected for OpenSea Seaport trades and simply indicates that the NFT is
                being transferred through the Seaport contract.
              </p>
            </div>
          )}
        </div>

        <button
          className="mt-4 w-full rounded-xl bg-[var(--primary)] py-2 text-[12px] font-semibold text-[var(--primary-text)] shadow-sm hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-60"
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
        {showSuccessModal && lastTxHash && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <button
              type="button"
              className="absolute inset-0 h-full w-full"
              onClick={() => {
                setShowSuccessModal(false);
                onClose(); // close the sheet
              }}
            />

            <div className="relative z-[90] w-full max-w-xs rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5 shadow-2xl">
              {/* Success icon */}
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
                <span className="text-lg text-emerald-600">✓</span>
              </div>

              <div className="text-center">
                <h2 className="text-sm font-semibold text-neutral-900">Offer accepted</h2>
                <p className="mt-1 text-[11px] leading-snug text-neutral-500">
                  You&apos;ve sold this NFT. You can view the transaction on the block explorer.
                </p>
              </div>

              <a
                href={txExplorerUrl(chain, lastTxHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex w-full items-center justify-center rounded-xl border border-purple-500/70 bg-white py-2 text-[12px] font-semibold text-purple-700 hover:bg-purple-50"
              >
                View on explorer
              </a>

              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false);
                  onClose();
                }}
                className="mt-2 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {showErrorModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <button
              type="button"
              className="absolute inset-0 h-full w-full"
              onClick={() => setShowErrorModal(false)}
            />

            <div className="relative z-[90] w-full max-w-xs rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5 shadow-2xl">
              {/* Error icon */}
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
                <span className="text-lg text-red-500">!</span>
              </div>

              <div className="text-center">
                <h2 className="text-sm font-semibold text-neutral-900">Accept offer failed</h2>
                <p className="mt-1 text-[11px] leading-snug text-neutral-500">
                  {errorMessage ||
                    "We couldn&apos;t complete this trade. Please try again in a moment."}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowErrorModal(false)}
                className="mt-4 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function mapOpenSeaOrderToListing(order: any): Listing {
  const asset = order?.maker_asset_bundle?.assets?.[0];

  const priceWeiStr = order?.current_price ?? "0";
  let priceEth = 0;
  let priceFormatted = "0.0000";

  if (typeof priceWeiStr === "string") {
    const n = Number(priceWeiStr) / 1e18;
    if (Number.isFinite(n)) {
      priceEth = n;
      priceFormatted = n >= 1 ? n.toFixed(3) : n.toFixed(4);
    }
  }

  const expiration = typeof order?.expiration_time === "number" ? order.expiration_time : null;

  const makerAddr = order?.maker?.address ?? null;

  const tokenId = asset?.token_id ?? null;
  const tokenContract = asset?.asset_contract?.address ?? null;
  const name = asset?.name ?? null;
  const imageUrl = asset?.image_url ?? null;

  return {
    id: order?.order_hash ?? "",
    priceEth,
    priceFormatted,
    maker: makerAddr,
    expirationTime: expiration,
    protocolAddress: order?.protocol_address ?? null,
    tokenId,
    tokenContract,
    name,
    imageUrl,
    image_url: imageUrl,
    image: imageUrl,
  };
}

function ListNftSheet({
  chain,
  contractAddress,
  tokenId,
  imageUrl,
  collectionName,
  onClose,
  onListed,
}: {
  chain: Chain;
  contractAddress: string;
  tokenId: string;
  imageUrl: string | null;
  collectionName: string;
  onClose: () => void;
  onListed: (listing?: Listing | null) => void;
}) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [price, setPrice] = useState<string>("");
  const [durationDays, setDurationDays] = useState<string>("7");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  function openErrorModal(message: string) {
    setError(message);
    setErrorMessage(message);
    setShowErrorModal(true);
  }
  const openSeaUrl = `https://opensea.io/assets/${openSeaChainSlug(
    chain,
  )}/${contractAddress}/${tokenId}`;

  // --- Fee assumptions for UI preview only ------------------------------
  // OpenSea error said "expecting 100 basis points" => 1% marketplace fee.
  const OPENSEA_FEE_BPS = 100; // 100 bps = 1%

  // If later you fetch collection royalty from backend, plug it here (in bps).
  const COLLECTION_FEE_BPS = 0; // e.g. 500 = 5%

  const priceNum = Number(price);
  const hasValidPrice = Number.isFinite(priceNum) && priceNum > 0;

  const osFeePct = OPENSEA_FEE_BPS / 10_000; // 0.01
  const collectionFeePct = COLLECTION_FEE_BPS / 10_000;
  const totalFeePct = osFeePct + collectionFeePct;

  const osFeeEth = hasValidPrice ? priceNum * osFeePct : 0;
  const collectionFeeEth = hasValidPrice ? priceNum * collectionFeePct : 0;
  const netEth = hasValidPrice ? priceNum * (1 - totalFeePct) : 0;

  function formatEth(v: number) {
    if (!Number.isFinite(v) || v <= 0) return "0";
    return v >= 1 ? v.toFixed(3) : v.toFixed(4);
  }

  async function handleList() {
    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      if (!address) {
        setError("Wallet is not connected.");
        return;
      }

      if (!address) {
        openErrorModal("Wallet is not connected.");
        return;
      }

      if (!walletClient) {
        openErrorModal("Wallet client is not available for signing.");
        return;
      }

      const durationNum = Number(durationDays);
      if (!Number.isFinite(durationNum) || durationNum <= 0) {
        setError("Please enter a valid duration in days.");
        return;
      }

      // --- Phase 1: build + sign Seaport 1.6 order locally -----------------
      const chainId = chainIdFromChain(chain);

      const typed = buildSimpleSeaportListingTypedData({
        chainId,
        offerer: address as `0x${string}`,
        contractAddress: contractAddress as `0x${string}`,
        tokenId,
        priceEth: priceNum,
        durationDays: durationNum,
      });

      const signature = await walletClient.signTypedData({
        account: address as `0x${string}`,
        domain: typed.domain,
        types: typed.types as any, // viem generic types; safe here
        primaryType: "OrderComponents",
        message: typed.value as any,
      });

      console.log("Deck Seaport 1.6 listing order", {
        parameters: typed.parameters,
        components: typed.value,
        signature,
      });

      // --- Send to backend (still stubbed – no real OpenSea call yet) ------
      const seaportOrderForBackend = serializeBigInt({
        protocolAddress: SEAPORT_1_6_ADDRESS,
        parameters: typed.parameters,
        components: typed.value,
        signature,
      });

      const res = await fetch("/api/opensea/list-nft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain,
          contractAddress,
          tokenId,
          priceEth: priceNum,
          durationDays: durationNum,
          sellerAddress: address,
          seaportOrder: seaportOrderForBackend,
        }),
      });

      const json: any = await res.json().catch(() => ({}));

      if (!res.ok || json.ok === false) {
        openErrorModal(
          json?.message ||
            "We couldn't create this listing on OpenSea. Please try again in a moment.",
        );
        return;
      }

      const order = json?.openSea?.order;
      let mapped: Listing | null = null;

      if (order) {
        mapped = mapOpenSeaOrderToListing(order);
      }

      setInfo(json?.message || "Listing created on OpenSea.");

      setShowSuccessModal(true);
      onListed(mapped);
    } catch (err) {
      console.error("ListNftSheet error", err);
      openErrorModal("Failed to create listing. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/25 backdrop-blur-sm">
      <button className="absolute inset-0 h-full w-full" onClick={onClose} />

      <div className="relative z-[70] w-full max-w-sm rounded-t-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 shadow-xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />

        <h2 className="text-center text-sm font-semibold text-neutral-900">List on OpenSea</h2>

        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-200">
            {imageUrl ? (
              <img src={imageUrl} alt={collectionName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[9px] text-neutral-500">
                —
              </div>
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-neutral-800">
              {collectionName} #{tokenId}
            </span>
            <span className="text-[10px] text-neutral-500">Chain: {prettyChain(chain)}</span>
          </div>
        </div>

        <div className="mt-4 space-y-3 text-[12px]">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-neutral-600">Price (ETH)</label>
            <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-1.5">
              <input
                type="number"
                min="0"
                step="0.0001"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-transparent text-[12px] text-[var(--text-primary)] outline-none"
                placeholder="0.05"
              />
              <span className="ml-2 text-[11px] text-neutral-500">ETH</span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-neutral-600">Duration (days)</label>
            <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-1.5">
              <input
                type="number"
                min="1"
                step="1"
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                className="w-full bg-transparent text-[12px] text-[var(--text-primary)] outline-none"
                placeholder="7"
              />
              <span className="ml-2 text-[11px] text-neutral-500">days</span>
            </div>
          </div>
          {hasValidPrice && (
            <div className="mt-2 space-y-1 rounded-xl bg-[var(--surface-secondary)] px-3 py-2 text-[11px] text-[var(--text-primary)]">
              <div className="flex justify-between">
                <span>OpenSea fee ({(OPENSEA_FEE_BPS / 100).toFixed(2)}%)</span>
                <span>-{formatEth(osFeeEth)} ETH</span>
              </div>

              {COLLECTION_FEE_BPS > 0 && (
                <div className="flex justify-between">
                  <span>Collection fee ({(COLLECTION_FEE_BPS / 100).toFixed(2)}%)</span>
                  <span>-{formatEth(collectionFeeEth)} ETH</span>
                </div>
              )}

              <div className="flex justify-between border-t border-neutral-200 pt-1">
                <span className="font-medium text-neutral-800">
                  You&apos;ll receive (before gas)
                </span>
                <span className="font-semibold text-emerald-600">{formatEth(netEth)} ETH</span>
              </div>

              <p className="mt-1 text-[10px] leading-snug text-[var(--text-muted)]">
                This is an estimate based on OpenSea marketplace fees
                {COLLECTION_FEE_BPS > 0 && " and collection royalties"}. Actual proceeds may differ
                slightly on OpenSea.
              </p>
            </div>
          )}

          {error && <div className="mt-1 text-[11px] leading-tight text-red-500">{error}</div>}

          {info && !error && (
            <div className="mt-1 text-[11px] leading-tight text-emerald-600">{info}</div>
          )}

          {!info && !error && (
            <div className="mt-1 space-y-1 text-[11px] leading-tight text-[var(--text-muted)]">
              <p>
                Your wallet may be asked to sign an off-chain Seaport order. The backend will then
                call OpenSea&apos;s Create Listing API using that signature.
              </p>
              <p>
                You might also see a yellow banner like
                <span className="font-medium">
                  {" "}
                  &quot;Proceed with caution – The transaction uses the Seaport protocol to transfer
                  tokens to an untrusted address&quot;
                </span>
                . This is a standard warning for OpenSea listings because the Seaport contract holds
                your NFT in escrow until it sells.
              </p>
            </div>
          )}
        </div>

        <button
          className="mt-4 w-full rounded-xl bg-[var(--primary)] py-2 text-[12px] font-semibold text-[var(--primary-text)] shadow-sm hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
          onClick={handleList}
        >
          {submitting ? "Listing…" : "List"}
        </button>

        <button
          className="mt-2 w-full text-center text-[12px] text-neutral-500"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </button>
        {showSuccessModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <button
              type="button"
              className="absolute inset-0 h-full w-full"
              onClick={() => {
                setShowSuccessModal(false);
                onClose();
              }}
            />

            <div className="relative z-[90] w-full max-w-xs rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5 shadow-2xl">
              {/* Animated checkmark */}
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
                <span className="text-lg text-emerald-600">✓</span>
              </div>

              <div className="text-center">
                <h2 className="text-sm font-semibold text-neutral-900">NFT listed successfully</h2>
                <p className="mt-1 text-[11px] leading-snug text-neutral-500">
                  You can cancel or relist your NFT directly from Deck.
                </p>
              </div>

              {/* View on OpenSea button */}
              <a
                href={openSeaUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex w-full items-center justify-center rounded-xl border border-purple-500/70 bg-white py-2 text-[12px] font-semibold text-purple-700 hover:bg-purple-50"
              >
                View on OpenSea
              </a>

              {/* Close button */}
              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false);
                  onClose();
                }}
                className="mt-2 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Close
              </button>
            </div>
          </div>
        )}
        {showErrorModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
            {/* click outside to close */}
            <button
              type="button"
              className="absolute inset-0 h-full w-full"
              onClick={() => setShowErrorModal(false)}
            />

            <div className="relative z-[90] w-full max-w-xs rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5 shadow-2xl">
              {/* Error icon */}
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
                <span className="text-lg text-red-500">!</span>
              </div>

              <div className="text-center">
                <h2 className="text-sm font-semibold text-neutral-900">Listing failed</h2>
                <p className="mt-1 text-[11px] leading-snug text-neutral-500">
                  {errorMessage || "We couldn't create this listing. Please try again in a moment."}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowErrorModal(false)}
                className="mt-4 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CancelListingSheet({
  chain,
  contractAddress: _contractAddress, // mark unused
  tokenId,
  listing,
  imageUrl,
  collectionName,
  onClose,
  onCancelled,
}: {
  chain: Chain;
  contractAddress: string;
  tokenId: string;
  listing: Listing;
  imageUrl: string | null;
  collectionName: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // NEW: modal + tx hash state
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  function openErrorModal(message: string) {
    setError(message);
    setErrorMessage(message);
    setShowErrorModal(true);
  }

  async function handleCancel() {
    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      if (!address || !walletClient) {
        openErrorModal("Wallet is not connected.");
        return;
      }

      // 1. fetch order components
      const ocRes = await fetch("/api/opensea/order-components", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain,
          orderId: listing.id,
          expectedOfferer: address,
        }),
      });

      const ocJson = await ocRes.json();

      if (!ocJson.ok) {
        openErrorModal(ocJson.message || "Failed to fetch order components from backend.");
        return;
      }

      const seaportAddress = ocJson.seaportAddress;
      const orderComponents = ocJson.orderComponents;

      if (!seaportAddress || !orderComponents) {
        openErrorModal("Missing Seaport address or order components.");
        return;
      }

      const data = encodeFunctionData({
        abi: seaportCancelAbi,
        functionName: "cancel",
        args: [[orderComponents]],
      });

      const txHash = await walletClient.sendTransaction({
        account: address as `0x${string}`,
        chain: {
          id: chainIdFromChain(chain),
          name: "",
          nativeCurrency: undefined,
          rpcUrls: {},
        } as any,
        to: seaportAddress as `0x${string}`,
        data,
        value: 0n,
      });

      setInfo(`Cancel transaction submitted: ${txHash}`);
      setLastTxHash(txHash);
      setShowSuccessModal(true); // ✅ show success modal
      // ❌ do NOT call onCancelled()/onClose() here – let the user close via modal
    } catch (err) {
      console.error("cancel tx error", err);
      openErrorModal("Failed to submit cancel transaction. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/25 backdrop-blur-sm">
      <button className="absolute inset-0 h-full w-full" onClick={onClose} />

      <div className="relative z-[70] w-full max-w-sm rounded-t-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 shadow-xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />

        <h2 className="text-center text-sm font-semibold text-neutral-900">Cancel listing</h2>

        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-200">
            {imageUrl ? (
              <img src={imageUrl} alt={collectionName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[9px] text-neutral-500">
                —
              </div>
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-neutral-800">
              {collectionName} #{tokenId}
            </span>
            <span className="text-[10px] text-neutral-500">
              Listed for {listing.priceFormatted} ETH
            </span>
          </div>
        </div>

        <div className="mt-3 text-[11px] leading-tight text-[var(--text-muted)]">
          This will request OpenSea to cancel this listing. Depending on the protocol, your wallet
          may be asked to sign an off-chain message or send a small on-chain transaction.
        </div>

        {error && <div className="mt-2 text-[11px] leading-tight text-red-500">{error}</div>}

        {info && !error && (
          <div className="mt-2 text-[11px] leading-tight text-emerald-600">{info}</div>
        )}

        <button
          className="mt-4 w-full rounded-xl bg-[var(--primary)] py-2 text-[12px] font-semibold text-[var(--primary-text)] shadow-sm hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
          onClick={handleCancel}
        >
          {submitting ? "Cancelling…" : "Cancel listing"}
        </button>

        <button
          className="mt-2 w-full text-center text-[12px] text-neutral-500"
          onClick={onClose}
          disabled={submitting}
        >
          Close
        </button>
      </div>

      {/* ✅ SUCCESS MODAL WITH ICON + EXPLORER BUTTON */}
      {showSuccessModal && lastTxHash && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 h-full w-full"
            onClick={() => {
              setShowSuccessModal(false);
              onCancelled(); // tell parent to refresh + hide sheet
              onClose();
            }}
          />

          <div className="relative z-[90] w-full max-w-xs rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5 shadow-2xl">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
              <span className="text-lg text-emerald-600">✓</span>
            </div>

            <div className="text-center">
              <h2 className="text-sm font-semibold text-neutral-900">Listing cancelled</h2>
              <p className="mt-1 text-[11px] leading-snug text-neutral-500">
                This NFT is no longer listed on OpenSea. You can view the cancel transaction on the
                block explorer.
              </p>
            </div>

            <a
              href={txExplorerUrl(chain, lastTxHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex w-full items-center justify-center rounded-xl border border-purple-500/70 bg-white py-2 text-[12px] font-semibold text-purple-700 hover:bg-purple-50"
            >
              View on explorer
            </a>

            <button
              type="button"
              onClick={() => {
                setShowSuccessModal(false);
                onCancelled();
                onClose();
              }}
              className="mt-2 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ❌ ERROR MODAL */}
      {showErrorModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 h-full w-full"
            onClick={() => setShowErrorModal(false)}
          />

          <div className="relative z-[90] w-full max-w-xs rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5 shadow-2xl">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
              <span className="text-lg text-red-500">!</span>
            </div>

            <div className="text-center">
              <h2 className="text-sm font-semibold text-neutral-900">Cancel failed</h2>
              <p className="mt-1 text-[11px] leading-snug text-neutral-500">
                {errorMessage ||
                  "We couldn&apos;t cancel this listing. Please try again in a moment."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowErrorModal(false)}
              className="mt-4 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
