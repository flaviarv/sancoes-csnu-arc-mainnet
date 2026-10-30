import { useState } from 'react'
import { ShieldCheck, Wallet } from 'lucide-react'
import CsnuChecker from './components/CsnuChecker'
import PaymentGate from './components/PaymentGate'
import { WalletChecker } from './components/WalletChecker'

type Tab = 'csnu' | 'wallets'

export default function App() {
  const [tab, setTab] = useState<Tab>('csnu')
  const [isCsnuPaid, setIsCsnuPaid] = useState(false)
  const [isWalletPaid, setIsWalletPaid] = useState(false)

  return (
    <div className="min-h-dvh" style={{ background: 'linear-gradient(145deg, #f5f4f0 0%, #eef1f7 100%)' }}>
      <div className="max-w-xl mx-auto px-4 py-8 pb-24 space-y-5">

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
                Sanctions Intelligence
              </h1>
              <p className="text-xs text-slate-500">PLD/CFT compliance — powered by Arc Mainnet</p>
            </div>
          </div>
        </div>

        {/* Tabs — topo */}
        <div className="flex rounded-2xl bg-white/60 border border-white/70 shadow-sm p-1 gap-1">
          <button
            onClick={() => setTab('csnu')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === 'csnu'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck size={15} />
            CSNU Names
          </button>
          <button
            onClick={() => setTab('wallets')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === 'wallets'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Wallet size={15} />
            Wallet Sanctions
          </button>
        </div>

        {/* CSNU tab */}
        {tab === 'csnu' && (
          <>
            <div className="rounded-2xl bg-white/60 backdrop-blur border border-white/70 shadow-sm px-5 py-4">
              <p className="text-sm text-slate-600 text-pretty leading-relaxed">
                Check whether a person or entity name appears in the{' '}
                <strong className="text-slate-800">Consolidated Sanctions List</strong> of the UN
                Security Council (CSNU). Enter one name per line and verify all at once.
              </p>
            </div>

            {!isCsnuPaid ? (
              <PaymentGate onPaid={() => setIsCsnuPaid(true)} serviceLabel="CSNU name search" />
            ) : (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2 text-sm text-emerald-700">
                <ShieldCheck size={15} />
                <span className="font-medium">Search unlocked</span>
                <span className="text-emerald-500 text-xs ml-auto">ERC-8183 escrow paid</span>
              </div>
            )}

            <CsnuChecker isPaid={isCsnuPaid} />

            <p className="text-center text-xs text-slate-400 pt-2">
              Data source: CSNU Consolidated Sanctions List (UN Security Council)
            </p>
          </>
        )}

        {/* Wallet Sanctions tab */}
        {tab === 'wallets' && (
          <>
            <div className="rounded-2xl bg-white/60 backdrop-blur border border-white/70 shadow-sm px-5 py-4">
              <p className="text-sm text-slate-600 text-pretty leading-relaxed">
                Check whether a crypto wallet address is sanctioned by international governmental
                lists:{' '}
                <strong className="text-slate-800">
                  OFAC (US), Israel NBCTF, UK OFSI, EU, UN, and Switzerland SECO
                </strong>
                . Supports EVM, Bitcoin, Tron, Solana, and more.
              </p>
            </div>

            {!isWalletPaid ? (
              <PaymentGate onPaid={() => setIsWalletPaid(true)} serviceLabel="wallet sanctions search" />
            ) : (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2 text-sm text-emerald-700">
                <ShieldCheck size={15} />
                <span className="font-medium">Search unlocked</span>
                <span className="text-emerald-500 text-xs ml-auto">ERC-8183 escrow paid</span>
              </div>
            )}

            <WalletChecker isPaid={isWalletPaid} />

            <p className="text-center text-xs text-slate-400 pt-2">
              Data sources: OFAC · Israel NBCTF · UK OFSI · EU EEAS · UN CSNU · Switzerland SECO
            </p>
          </>
        )}

      </div>
    </div>
  )
}
