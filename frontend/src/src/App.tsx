import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import CsnuChecker from './components/CsnuChecker'
import PaymentGate from './components/PaymentGate'

export default function App() {
  const [isPaid, setIsPaid] = useState(false)

  return (
    <div className="min-h-dvh" style={{ background: 'linear-gradient(145deg, #f5f4f0 0%, #eef1f7 100%)' }}>
      <div className="max-w-md mx-auto px-4 py-8 pb-24 space-y-5">
        {/* Header */}
        <div className="pt-2 pb-1">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center shadow">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <h1
                className="text-xl font-bold text-slate-900"
                style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.02em' }}
              >
                CSNU Sanctions Checker
              </h1>
              <p className="text-xs text-slate-500">UN Security Council list verification</p>
            </div>
          </div>
        </div>

        {/* Description card */}
        <div className="rounded-2xl bg-white/60 backdrop-blur border border-white/70 shadow-sm px-5 py-4">
          <p className="text-sm text-slate-600 text-pretty leading-relaxed">
            Check whether a person or entity name appears in the{' '}
            <strong className="text-slate-800">Consolidated Sanctions List</strong> of the UN Security Council (CSNU).
            Enter one name per line and verify all at once.
          </p>
        </div>

        {/* Payment gate */}
        {!isPaid && (
          <PaymentGate onPaid={() => setIsPaid(true)} />
        )}

        {/* Paid badge */}
        {isPaid && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2 text-sm text-emerald-700">
            <ShieldCheck size={15} />
            <span className="font-medium">Search unlocked</span>
            <span className="text-emerald-500 text-xs ml-auto">ERC-8183 escrow paid</span>
          </div>
        )}

        {/* Checker */}
        <CsnuChecker isPaid={isPaid} />

        {/* Footer note */}
        <p className="text-center text-xs text-slate-400 pt-2">
          Data source: CSNU Consolidated Sanctions List (UN Security Council)
        </p>
      </div>
    </div>
  )
}
