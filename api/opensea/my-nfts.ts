// api/opensea/my-nfts.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'

// We'll validate inputs to avoid weird / malicious params
const querySchema = z.object({
  address: z
    .string()
    .toLowerCase()
    .regex(/^0x[a-f0-9]{40}$/, 'Invalid address'),
  chain: z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism'])
    .default('base'),
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENSEA_API_KEY
  const baseUrl = process.env.OPENSEA_API_URL ?? 'https://api.opensea.io/api/v2'

  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'Server misconfigured: OpenSea API key missing' })
  }

  const parsed = querySchema.safeParse({
    address: req.query.address,
    chain: req.query.chain ?? 'base',
  })

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid parameters',
      details: parsed.error.flatten(),
    })
  }

  const { address, chain } = parsed.data

  try {
    // OpenSea v2 "Get NFTs by account" endpoint
    const url = `${baseUrl}/chain/${chain}/account/${address}/nfts`

    const response = await fetch(url, {
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('OpenSea error', response.status, text)
      return res.status(502).json({ error: 'Failed to fetch from OpenSea' })
    }

    const json = await response.json()
    return res.status(200).json(json)
  } catch (err) {
    console.error('OpenSea fetch failed', err)
    return res.status(500).json({ error: 'Unexpected server error' })
  }
}
