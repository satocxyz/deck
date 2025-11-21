import { sdk } from "@farcaster/miniapp-sdk";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useMyNfts, type Chain } from "./hooks/useMyNfts";

function App() {
  const [chain, setChain] = useState<Chain>("base");

  useEffect(() => {
    (async () => {
      try {
        await sdk.actions.ready();
      } catch (err) {
        console.error("sdk.ready failed", err);
      }
    })();
  }, []);

  const { isConnected } = useAccount();
  const { data, loading, error } = useMyNfts(chain);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#050508",
        color: "#fff",
        padding: "16px",
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
          <h1 style={{ fontSize: "20px", fontWeight: 700 }}>Deck</h1>
          <p style={{ fontSize: "11px", opacity: 0.7 }}>
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

        {isConnected && data && data.nfts?.length === 0 && !loading && !error && (
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
      <div
        style={{
          marginTop: "8px",
          padding: "10px 12px",
          borderRadius: "14px",
          border: "1px solid #27272f",
          background: "#090910",
          fontSize: "11px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <span style={{ opacity: 0.8 }}>Wallet connected</span>
        <span
          style={{
            maxWidth: "140px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            opacity: 0.7,
          }}
        >
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
      style={{
        marginTop: "8px",
        width: "100%",
        padding: "11px 14px",
        borderRadius: "16px",
        border: "1px solid #7c3aed",
        background:
          "linear-gradient(135deg, #7c3aed, #4f46e5, #0f172a)",
        color: "#fff",
        fontWeight: 600,
        fontSize: "13px",
        cursor: "pointer",
        opacity: !connector || isPending ? 0.6 : 1,
      }}
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
    <div
      style={{
        marginTop: "10px",
        padding: "4px",
        borderRadius: "999px",
        background: "#090910",
        border: "1px solid #27272f",
        display: "flex",
        gap: "4px",
        fontSize: "11px",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === chain;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              borderRadius: "999px",
              border: "none",
              padding: "6px 0",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: active ? 600 : 500,
              background: active ? "#f9fafb" : "transparent",
              color: active ? "#020617" : "#e5e7eb",
            }}
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
