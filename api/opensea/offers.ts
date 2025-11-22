// api/opensea/offers.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

type SimpleOffer = {
  id: string
  priceEth: number
  priceFormatted: string
  maker: string | null
  expirationTime: number | null
  source: 'item' | 'collection'
}

type FloorInfo = {
  eth: number | null
  formatted: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const chain = req.query.chain as string | undefined
  const collectionSlug = req.query.collection as string | undefined
  const identifier = req.query.identifier as string | undefined
  const contract = req.query.contract as string | undefined

  if (!chain || (chain !== 'base' && chain !== 'ethereum')) {
    return res
      .status(400)
      .json({ error: "Invalid or missing chain. Expected 'base' or 'ethereum'." })
  }

  if (!collectionSlug) {
    return res.status(400).json({ error: 'Missing collection slug' })
  }

  // identifier + contract are only needed for **item-level** offers
  const hasItemContext = Boolean(identifier && contract)

  const apiKey = process.env.OPENSEA_API_KEY
  const baseUrl = process.env.OPENSEA_API_URL ?? 'https://api.opensea.io/api/v2'

  if (!apiKey) {
    console.error('Missing OPENSEA_API_KEY')
    return res.status(500).json({ error: 'Server misconfigured' })
  }

  const osChain = chain === 'base' ? 'base' : 'ethereum'
  const protocol = 'seaport'

  let bestOffer: SimpleOffer | null = null
  let floor: FloorInfo = { eth: null, formatted: null }

  try {
    // ---------- 1) Collection stats (floor + maybe collection-level top offer) ----------
    const statsUrl = `${baseUrl}/collections/${collectionSlug}/stats`
    const statsRes = await fetch(statsUrl, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
      },
    })

    if (statsRes.ok) {
      const statsJson = (await statsRes.json()) as {
        total?: Record<string, unknown>
      }

      const total = (statsJson.total ?? {}) as Record<string, unknown>

      // Helpful once to see what fields exist (check Vercel logs)
      console.log('OpenSea collection stats keys:', Object.keys(total))

      // FLOOR: try floor_price (v2 docs)
      const floorRaw = total['floor_price']
      if (typeof floorRaw === 'number') {
        floor.eth = floorRaw
        floor.formatted =
          floorRaw >= 1 ? floorRaw.toFixed(3) : floorRaw.toFixed(4)
      }

      // Try to detect a collection-level top offer (if any)
      const possibleTop =
        typeof total['top_offer'] === 'number'
          ? (total['top_offer'] as number)
          : typeof total['top_bid'] === 'number'
            ? (total['top_bid'] as number)
            : typeof total['top_offer_price'] === 'number'
              ? (total['top_offer_price'] as number)
              : null

      if (typeof possibleTop === 'number' && possibleTop > 0) {
        const priceEth = possibleTop
        const priceFormatted =
          priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4)

        // Only set this if we *never* find an item-specific offer later
        bestOffer = {
          id: 'collection-top-offer',
          priceEth,
          priceFormatted,
          maker: null,
          expirationTime: null,
          source: 'collection',
        }
      }
    } else {
      const text = await statsRes.text()
      console.error('OpenSea stats error', statsRes.status, text)
    }

    // ---------- 2) Item-level best offer (overrides collection-level if valid) ----------
    if (hasItemContext) {
      const offersParams = new URLSearchParams({
        asset_contract_address: contract as string,
        token_ids: identifier as string,
        order_by: 'eth_price',
        order_direction: 'desc',
        limit: '1',
      })

      const offersUrl = `${baseUrl}/orders/${osChain}/${protocol}/offers?${offersParams.toString()}`

      const offersRes = await fetch(offersUrl, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': apiKey,
        },
      })

      if (offersRes.ok) {
        const offersJson = (await offersRes.json()) as { orders?: any[] }
        const rawOrders = Array.isArray(offersJson.orders)
          ? offersJson.orders
          : []

        if (rawOrders.length > 0) {
          const order = rawOrders[0]

          // current_price format is inconsistent; handle both ETH string / number and wei string
          const raw = order.current_price
          let priceEth: number | null = null

          if (typeof raw === 'string') {
            const numeric = Number(raw)
            if (!Number.isNaN(numeric) && numeric > 0) {
              // Heuristic:
              // if it's a gigantic integer, assume wei -> convert to ETH
              if (Number.isInteger(numeric) && numeric > 1e10) {
                priceEth = numeric / 1e18
              } else {
                // assume already in ETH units
                priceEth = numeric
              }
            }
          } else if (typeof raw === 'number' && raw > 0) {
            if (Number.isInteger(raw) && raw > 1e10) {
              priceEth = raw / 1e18
            } else {
              priceEth = raw
            }
          }

          // Only override bestOffer if we parsed a meaningful > 0 price
          if (priceEth && priceEth > 0) {
            const priceFormatted =
              priceEth >= 1 ? priceEth.toFixed(3) : priceEth.toFixed(4)

            const makerAddress: string | null =
              order.maker?.address ?? order.maker?.account?.address ?? null

            const expirationTime: number | null =
              typeof order.expiration_time === 'number'
                ? order.expiration_time
                : null

            bestOffer = {
              id:
                order.order_hash ??
                order.id ??
                `${makerAddress ?? 'unknown'}-${raw}`,
              priceEth,
              priceFormatted,
              maker: makerAddress,
              expirationTime,
              source: 'item',
            }
          }
        }
      } else {
        const text = await offersRes.text()
        console.error('OpenSea offers error', offersRes.status, text)
      }
    }

    // ---------- 3) Return combined result ----------
    return res.status(200).json({ bestOffer, floor })
  } catch (err) {
    console.error('Unexpected error in /api/opensea/offers', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
