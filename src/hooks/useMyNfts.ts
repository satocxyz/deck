// src/hooks/useMyNfts.ts
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'

type OpenSeaNft = {
  identifier: string
  name?: string
  image_url?: string
  collection?: {
    name?: string
    slug?: string
  }
}

type OpenSeaResponse = {
  nfts: OpenSeaNft[]
  next?: string | null
}

export function useMyNfts(chain: 'base' | 'ethereum' = 'base') {
  const { address, isConnected } = useAccount()
  const [data, setData] = useState<OpenSeaResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isConnected || !address) {
      setData(null)
      setError(null)
      return
    }

    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          address,
          chain,
        })

        const res = await fetch(`/api/opensea/my-nfts?${params.toString()}`)

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load NFTs')
        }

        const json = (await res.json()) as OpenSeaResponse
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Unknown error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [isConnected, address, chain])

  return { data, loading, error }
}
