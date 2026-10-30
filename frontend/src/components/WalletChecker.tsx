import { useState } from 'react'
import { AlertTriangle, CheckCircle, Search, XCircle } from 'lucide-react'

interface WalletResult {
  address: string
  chain: string
  is_sanctioned: boolean
  verdict_status: string
  verdict_summary: string
  sources: string[]
}

interface CheckWalletsResponse {
  results: WalletResult[]
  total: number
  sanctioned_count: number
}

interface WalletCheckerProps {
  isPaid?: boolean
}

export function WalletChecker({ isPaid = false }: WalletCheckerProps) {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<WalletResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ total: number; sanctioned: number } | null>(null)

  const walletCount = input.split('\n').filter(l => l.trim()).length

  const handleVerify = async () => {
    const wallets = input.split('\n').map(l => l.trim()).filter(Boolean)
    if (!wallets.length) return
    setLoading(true)
    setError(null)
    setResults(null)
    setSummary(null)
    try {
      const res = await fetch('/api/check-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets }),
      })
      if (!res.ok) {
        const err = await res.json() as { detail?: string }
        throw new Error(err.detail ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as CheckWalletsResponse
      setResults(data.results)
      setSummary({ total: data.total, sanctioned: data.sanctioned_count })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full flex flex-col gap-4">

      {/* Input — identical layout to CSNU Names box */}
      <div className="rounded-2xl bg-white/60 backdrop-blur border border-white/70 shadow-sm px-5 py-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-700 tracking-wide uppercase" style={{ letterSpacing: '0.07em' }}>
            Wallet addresses to verify
          </label>
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {walletCount} {walletCount === 1 ? 'address' : 'addresses'}
          </span>
        </div>
        <textarea
          className="w-full h-36 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 resize-none"
          placeholder={"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045\nTWBAPzpPiZarfVsY2BLXeaLhNHurn4wkWG\n1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf..."}
          value={input}
          onChange={e => setInput(e.target.value)}
          spellCheck={false}
        />
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <Search className="w-3 h-3" />
          <span>One address per line only. Supports EVM, Bitcoin, Tron, Solana, XRP and more.</span>
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-2">
          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}

      {/* Button */}
      <button
        onClick={() => { void handleVerify() }}
        disabled={loading || !input.trim() || !isPaid}
        className="w-full h-12 rounded-2xl bg-neutral-900 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Verifying...
          </>
        ) : (
          <>
            <Search className="w-4 h-4" />
            Verify against sanctions lists
          </>
        )}
      </button>

      {/* Summary */}
      {summary && (
        <div className={`rounded-xl px-4 py-3 flex items-center justify-between text-sm font-medium ${
          summary.sanctioned > 0
            ? 'bg-red-50 border border-red-100 text-red-700'
            : 'bg-green-50 border border-green-100 text-green-700'
        }`}>
          <span>{summary.total} {summary.total === 1 ? 'address' : 'addresses'} checked</span>
          <span>{summary.sanctioned === 0 ? 'No matches found' : `${summary.sanctioned} sanctioned`}</span>
        </div>
      )}

      {/* Results */}
      {results && results.length > 0 && (
        <div className="flex flex-col gap-3">
          {results.map((r, i) => (
            <div
              key={i}
              className={`rounded-2xl border p-4 flex flex-col gap-2 ${
                r.verdict_status === 'FORMATO_INVALIDO'
                  ? 'bg-yellow-50 border-yellow-100'
                  : r.is_sanctioned
                  ? 'bg-red-50 border-red-100'
                  : 'bg-green-50 border-green-100'
              }`}
            >
              <div className="flex items-start gap-2">
                {r.verdict_status === 'FORMATO_INVALIDO' ? (
                  <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                ) : r.is_sanctioned ? (
                  <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex flex-col gap-1 min-w-0">
                  <span className={`text-xs font-bold uppercase tracking-wide ${
                    r.verdict_status === 'FORMATO_INVALIDO' ? 'text-yellow-700'
                    : r.is_sanctioned ? 'text-red-700' : 'text-green-700'
                  }`}>
                    {r.verdict_status === 'FORMATO_INVALIDO' ? 'Invalid format'
                      : r.is_sanctioned ? 'Sanctioned' : 'Not sanctioned'}
                  </span>
                  <span className="text-xs font-mono text-neutral-600 break-all">{r.address}</span>
                  {r.chain && r.chain !== 'Não identificada / Formato genérico' && (
                    <span className="text-xs text-neutral-500">Network: {r.chain}</span>
                  )}
                  {r.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {r.sources.map((src, j) => (
                        <span key={j} className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-medium">
                          {src}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-center text-neutral-400 pb-2">
        Data sources: OFAC (US), Israel NBCTF, UK OFSI, EU EEAS, UN Security Council, Switzerland SECO
      </p>
    </div>
  )
}
