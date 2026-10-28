import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, AlertTriangle, CheckCircle, Loader2, ShieldAlert, ShieldCheck, Info } from 'lucide-react'

interface NameResult {
  name: string
  is_contained: boolean
  message: string
}

interface CheckResponse {
  results: NameResult[]
}

interface Props {
  onSearchComplete?: (results: NameResult[], namesText: string) => void
  isPaid: boolean
}

export default function CsnuChecker({ onSearchComplete, isPaid }: Props) {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<NameResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const lineCount = input.split('\n').filter(l => l.trim()).length

  async function handleCheck() {
    if (!input.trim()) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const res = await fetch('/api/check-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_input: input }),
      })
      if (!res.ok) {
        const detail: unknown = await res.json().catch(() => ({}))
        const detailMsg = typeof (detail as Record<string, unknown>)?.detail === 'string'
          ? (detail as Record<string, unknown>).detail as string
          : `Server error ${res.status}`
        throw new Error(detailMsg)
      }
      const data = await res.json() as CheckResponse
      setResults(data.results)
      setSearched(true)
      onSearchComplete?.(data.results, input)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection error — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const sanctionedCount = results.filter(r => r.is_contained).length
  const clearCount = results.filter(r => !r.is_contained).length

  return (
    <div className="space-y-5">
      {/* Input area */}
      <div className="rounded-2xl bg-white/70 backdrop-blur border border-white/60 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-semibold text-slate-700 tracking-wide uppercase" style={{ letterSpacing: '0.07em' }}>
            Names to verify
          </label>
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {lineCount} {lineCount === 1 ? 'name' : 'names'}
          </span>
        </div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          rows={6}
          placeholder={"Noor Wali Mehsud\nAbu Sayyaf\nAbubakar Shekau"}
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300 transition font-mono"
          style={{ fontFamily: "'JetBrains Mono', 'Menlo', monospace" }}
        />
        <p className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
          <Info size={12} />
          One name per line only. Lines with multiple names are not supported.
        </p>
      </div>

      {/* CTA */}
      {!isPaid && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-3.5 text-sm text-amber-700 flex items-center gap-2.5">
          <AlertTriangle size={16} className="shrink-0" />
          Connect your wallet and pay <strong>0.1 USDC</strong> per search to unlock verification.
        </div>
      )}

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => { void handleCheck() }}
        disabled={loading || !input.trim() || !isPaid}
        className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-slate-900 text-white font-semibold py-4 text-sm tracking-wide disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:bg-slate-800 active:bg-slate-950"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Checking names…
          </>
        ) : (
          <>
            <Search size={16} />
            Verify against CSNU list
          </>
        )}
      </motion.button>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm flex items-start gap-2.5"
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary bar */}
      <AnimatePresence>
        {searched && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            {sanctionedCount > 0 && (
              <div className="flex-1 rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-2">
                <ShieldAlert size={16} className="text-red-500 shrink-0" />
                <span className="text-sm font-semibold text-red-700">{sanctionedCount} sanctioned</span>
              </div>
            )}
            {clearCount > 0 && (
              <div className="flex-1 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-500 shrink-0" />
                <span className="text-sm font-semibold text-emerald-700">{clearCount} not found</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results list */}
      <AnimatePresence>
        {results.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-2.5"
          >
            {results.map((r, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`rounded-xl px-4 py-3.5 flex items-start gap-3 border ${
                  r.is_contained
                    ? 'bg-red-50 border-red-200'
                    : 'bg-emerald-50 border-emerald-100'
                }`}
              >
                {r.is_contained ? (
                  <ShieldAlert size={16} className="text-red-500 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{r.name}</p>
                  <p className={`text-xs mt-0.5 ${r.is_contained ? 'text-red-600' : 'text-emerald-600'}`}>
                    {r.is_contained
                      ? 'Listed in the CSNU sanctions list'
                      : 'Not found in the CSNU sanctions list'}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
