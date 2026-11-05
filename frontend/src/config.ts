/**
 * wagmi configuration — Arc Mainnet.
 * Chain RPC comes from the central business rules / official Arc docs.
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc } from 'viem/chains'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [arc, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arc.id]: http('https://rpc.mainnet.arc.io'),
    [mainnet.id]: http(),
  },
})
