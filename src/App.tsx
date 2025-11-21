import { sdk } from "@farcaster/miniapp-sdk";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useMyNfts, type Chain } from "./hooks/useMyNfts";

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

  useEffect(() => {
    (async () => {
      try {
        // sdk.context is already a Promise<MiniAppContext>
        const context = await sdk.context;
        if (context?.client?.safeAreaInsets) {
          setSafeArea(context.client.safeAreaInsets);
        }

        // Tell the host the app is ready (hides splash screen)
        await sdk.actions.ready();
      } catch (err) {
        console.error("sdk.ready or context failed", err);
      }
    })();
  }, []);

  const { isConnected } = useAccount();
  const { data, loading, error } = useMyNfts(chain);

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
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "12px",
        }}
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Deck</h1>
          <p className="text-[11px] text-neutral-400">
            NFTs from your Farcaster wallet
          </p>
        </div>
      </header>

      <ConnectMenu />

      <ChainSelector chain={chain} onChange={setChain} />

      <main style={{ marginTop: "16px" }}>
        {!isConnected && (
          <p style={{ fontSize: "13px", opacity: 0.7 }}>
            Connect your Farcaster wallet to see your NFT deck.
          </p>
        )}

        {isConnected && loading && (
          <p style={{ fontSize: "13px", opacity: 0.7 }}>
            Loading your NFTs on {prettyChain(chain)}…
          </p>
        )}

        {isConnected && error && (
          <p style={{ fontSize: "13px", color: "#f97373" }}>Error: {error}</p>
        )}

        {isConnected &&
          data &&
          data.nfts?.length === 0 &&
          !loading &&
          !error && (
            <p style={{ fontSize: "13px", opacity: 0.7 }}>
              No NFTs found on {prettyChain(chain)} for this wallet.
            </p>
          )}

        {isConnected && data && data.nfts?.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "8px",
              paddingBottom: "40px",
            }}
          >
            {data.nfts.map((nft) => (
              <article
                key={`${nft.identifier}-${nft.collection?.slug ?? "unknown"}`}
                style={{
                  borderRadius: "16px",
                  overflow: "hidden",
                  border: "1px solid #27272f",
                  background: "#0b0b10",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    paddingBottom: "100%",
                    backgroundColor: "#050508",
                  }}
                >
                  {nft.image_url ? (
                    <img
                      src={nft.image_url}
                      alt={nft.name || `NFT #${nft.identifier}`}
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                      loading="lazy"
                    />
                  ) : (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        opacity: 0.6,
                      }}
                    >
                      No image
                    </div>
                  )}
                </div>
                <div style={{ padding: "6px 8px" }}>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {nft.name || `#${nft.identifier}`}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      opacity: 0.6,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {nft.collection?.name ?? "Unknown collection"}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

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

function prettyChain(chain: Chain): string {
  if (chain === "base") return "Base";
  return "Ethereum";
}

export default App;
