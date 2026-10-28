import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useSwitchChain, useChainId } from 'wagmi'
import { parseUnits, erc20Abi, parseEventLogs, type Address } from 'viem'
import { arc } from 'viem/chains'
import { Wallet, Coins, Loader2, CheckCircle2, ExternalLink, AlertCircle } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'

// Arc Mainnet constants
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as Address
// Arc Mainnet — deployado em 2026-10-26
const AGENTIC_COMMERCE = '0x975a005E4107c12e585DB71059fe857449510c99' as Address
const SEARCH_PRICE = parseUnits('1', 6) // 1 USDC per search
// Treasury / evaluator: receives 1% fee and evaluates every job
// Must differ from the client (EvaluatorMustDifferFromClient guard in contract)
const TREASURY = '0xd2f80f6cf27483392f70f21b3381109f9c33c390' as Address

const acAbi = [
  {
    type: 'function', name: 'createJob', stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider', type: 'address' }, { name: 'evaluator', type: 'address' },
      { name: 'expiredAt', type: 'uint256' }, { name: 'description', type: 'string' },
      { name: 'hook', type: 'address' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'setBudget', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'optParams', type: 'bytes' }],
    outputs: [],
  },
  {
    type: 'function', name: 'fund', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'optParams', type: 'bytes' }],
    outputs: [],
  },
  {
    type: 'function', name: 'submit', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'deliverable', type: 'bytes32' }, { name: 'optParams', type: 'bytes' }],
    outputs: [],
  },
  {
    type: 'event', name: 'JobCreated',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true }, { name: 'client', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true }, { name: 'evaluator', type: 'address', indexed: false },
      { name: 'expiredAt', type: 'uint256', indexed: false }, { name: 'hook', type: 'address', indexed: false },
    ],
  },
] as const

type Step = 'idle' | 'creating' | 'approving' | 'funding' | 'submitting' | 'done' | 'error'

interface Props {
  onPaid: () => void
}

export default function PaymentGate({ onPaid }: Props) {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const isWrongChain = isConnected && chainId !== arc.id
  const [step, setStep] = useState<Step>('idle')
  const [jobId, setJobId] = useState<bigint | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // Read USDC balance
  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const formattedBalance = usdcBalance !== undefined
    ? (Number(usdcBalance) / 1e6).toFixed(2)
    : '—'

  // viem default timeout: 180 000 ms (3 min) — increased to 600 000 ms (10 min)
  const TX_TIMEOUT_MS = 600_000
  const { writeContractAsync } = useWriteContract()
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, timeout: TX_TIMEOUT_MS })

  const calledRef = useRef(false)
  useEffect(() => {
    if (receipt && step === 'submitting' && !calledRef.current) {
      calledRef.current = true
      // use a microtask to move setState out of the synchronous effect body
      void Promise.resolve().then(() => {
        setStep('done')
        toast.success('Payment confirmed — search unlocked!')
        onPaid()
      })
    }
  }, [receipt, step, onPaid])

  async function handlePay() {
    if (!address) return
    setErrMsg(null)
    try {
      // Ensure we are on Arc Mainnet before any contract call
      if (chainId !== arc.id) {
        await switchChainAsync({ chainId: arc.id })
      }

      // Build a publicClient pointing at Arc Mainnet RPC
      const { createPublicClient, http } = await import('viem')
      const publicClient = createPublicClient({
        chain: arc,
        transport: http('https://rpc.mainnet.arc.io'),
      })

      // helper: wait for a tx and require at least 1 confirmation
      async function waitTx(hash: `0x${string}`) {
        return publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 })
      }

      // Step 1: create job
      // provider = user (receives 0.99 USDC back after completion)
      // evaluator must differ from client — if user IS treasury, use contract address as evaluator
      setStep('creating')
      const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600)
      // evaluator must differ from client — if user IS treasury, use contract address as evaluator
      const evaluator: Address = address.toLowerCase() === TREASURY.toLowerCase()
        ? AGENTIC_COMMERCE
        : TREASURY
      const createHash = await writeContractAsync({
        address: AGENTIC_COMMERCE,
        abi: acAbi,
        functionName: 'createJob',
        args: [
          TREASURY,     // provider = treasury (receives 0.99 USDC — the service fee)
          evaluator,    // evaluator ≠ client
          expiredAt,
          'CSNU sanctions check — 1 search',
          '0x0000000000000000000000000000000000000000',
        ],
        chainId: arc.id,
      })
      const createReceipt = await waitTx(createHash)
      const [jobCreated] = parseEventLogs({ abi: acAbi, eventName: 'JobCreated', logs: createReceipt.logs })
      const newJobId = jobCreated.args.jobId
      setJobId(newJobId)

      // Step 2: setBudget — must confirm before approve
      const budgetHash = await writeContractAsync({
        address: AGENTIC_COMMERCE,
        abi: acAbi,
        functionName: 'setBudget',
        args: [newJobId, SEARCH_PRICE, '0x'],
        chainId: arc.id,
      })
      await waitTx(budgetHash)

      // Step 3: approve USDC — must confirm before fund
      setStep('approving')
      const approveHash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [AGENTIC_COMMERCE, SEARCH_PRICE],
        chainId: arc.id,
      })
      await waitTx(approveHash)

      // Step 4: fund job
      setStep('funding')
      const fundHash = await writeContractAsync({
        address: AGENTIC_COMMERCE,
        abi: acAbi,
        functionName: 'fund',
        args: [newJobId, '0x'],
        chainId: arc.id,
      })
      await waitTx(fundHash)

      // Step 5: backend calls submit() + complete() as treasury (provider + evaluator)
      setStep('submitting')
      await fetch('/api/complete-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: Number(newJobId) }),
      })

      setTxHash(fundHash)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transaction failed'
      setErrMsg(msg.length > 120 ? msg.slice(0, 117) + '...' : msg)
      setStep('error')
      toast.error('Payment failed')
    }
  }

  const stepLabels: Record<Step, string> = {
    idle: 'Pay 1 USDC to search',
    creating: 'Creating escrow job…',
    approving: 'Approving USDC spend…',
    funding: 'Funding escrow…',
    submitting: 'Finalizing payment…',
    done: 'Paid — search unlocked',
    error: 'Retry payment',
  }

  const isProcessing = ['creating', 'approving', 'funding', 'submitting'].includes(step)

  if (!isConnected) {
    return (
      <div className="rounded-2xl bg-white/70 backdrop-blur border border-white/60 shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
            <Wallet size={17} className="text-slate-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Connect your wallet</p>
            <p className="text-xs text-slate-500">Required to pay for a search</p>
          </div>
        </div>
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button
              onClick={show}
              className="w-full rounded-xl bg-slate-900 text-white text-sm font-semibold py-3 hover:bg-slate-800 transition"
            >
              Connect wallet
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-white/70 backdrop-blur border border-white/60 shadow-sm p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <Coins size={17} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Pay per search</p>
            <p className="text-xs text-slate-500">ERC-8183 escrow on Arc Mainnet</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Balance</p>
          <p className="text-sm font-semibold text-slate-700 tabular-nums">{formattedBalance} USDC</p>
        </div>
      </div>

      {/* Wrong chain warning */}
      {isWrongChain && (
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-700">
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-500" />
          <span>Wrong network detected. Clicking Pay will switch to <strong>Arc Mainnet</strong> automatically.</span>
        </div>
      )}

      {/* Price row */}
      <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
        <span className="text-xs text-slate-500">Price per search</span>
        <span className="text-sm font-bold text-slate-800 tabular-nums">1.00 USDC</span>
      </div>

      {/* Timeout comparison */}
      <div className="rounded-xl border border-slate-100 overflow-hidden text-xs">
        <div className="px-3 py-2 bg-slate-50 text-slate-500 font-semibold uppercase tracking-wide" style={{ letterSpacing: '0.07em' }}>
          Confirmation timeout
        </div>
        <div className="flex divide-x divide-slate-100">
          <div className="flex-1 px-3 py-2.5 bg-white">
            <p className="text-slate-400 mb-0.5">Default (viem)</p>
            <p className="font-bold text-slate-500 tabular-nums line-through">3 min</p>
            <p className="text-slate-400">180 000 ms</p>
          </div>
          <div className="flex-1 px-3 py-2.5 bg-blue-50">
            <p className="text-blue-500 mb-0.5">Current config</p>
            <p className="font-bold text-blue-700 tabular-nums">10 min</p>
            <p className="text-blue-400">600 000 ms</p>
          </div>
        </div>
      </div>

      {/* Step progress */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5">
              {(['creating', 'approving', 'funding', 'submitting'] as const).map((s) => {
                const order = ['creating', 'approving', 'funding', 'submitting']
                const isDone = order.indexOf(s) < order.indexOf(step)
                const isCurrent = step === s
                const labels = { creating: 'Create escrow job', approving: 'Approve USDC', funding: 'Fund escrow', submitting: 'Finalize payment' }
                return (
                  <div key={s} className="flex items-center gap-2.5 text-xs">
                    {isCurrent ? (
                      <Loader2 size={12} className="animate-spin text-blue-500 shrink-0" />
                    ) : isDone ? (
                      <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border border-slate-200 shrink-0" />
                    )}
                    <span className={isCurrent ? 'text-slate-700 font-medium' : 'text-slate-400'}>
                      {labels[s]}
                    </span>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Done state */}
      {step === 'done' && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2.5 border border-emerald-100">
          <CheckCircle2 size={14} className="shrink-0" />
          <span className="font-medium">Search unlocked</span>
          {jobId !== null && (
            <a
              href={`https://explorer.arc.io/search?q=${jobId.toString()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-emerald-600 hover:text-emerald-800"
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}

      {/* Error */}
      {step === 'error' && errMsg && (
        <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2 border border-red-100">{errMsg}</p>
      )}

      {/* CTA */}
      {step !== 'done' && (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { void handlePay() }}
          disabled={isProcessing}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm py-3.5 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isProcessing && <Loader2 size={14} className="animate-spin" />}
          {stepLabels[step]}
        </motion.button>
      )}
    </div>
  )
}
