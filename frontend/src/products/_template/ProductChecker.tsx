/**
 * Template para novos produtos em criptokyc.tech
 *
 * Como usar:
 * 1. Copie esta pasta para products/novo-produto/
 * 2. Renomeie ProductChecker.tsx para o nome do produto
 * 3. Adicione o produto em config/business-rules.ts → PRODUCTS
 * 4. Registre a rota no backend (api/router ou main_docker.py)
 * 5. Importe no App.tsx e adicione uma nova aba
 *
 * Regras de negócio (preço, endereços, chain) vêm SEMPRE de:
 * @/config/business-rules.ts
 */

import { useState } from 'react'
import { PRODUCTS } from '@/config/business-rules'

// Altere para o produto correto
const PRODUCT = PRODUCTS.CSNU_NAMES

interface Props {
  isPaid: boolean
}

export function ProductChecker({ isPaid }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<string>('')

  async function handleSubmit() {
    if (!isPaid || !input.trim()) return
    setLoading(true)
    try {
      const res = await fetch(PRODUCT.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const text = await res.text()
      setResults(text)
    } finally {
      setLoading(false)
    }
  }

  function onClickSearch() {
    void handleSubmit()
  }

  return (
    <div>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        disabled={!isPaid}
        placeholder={isPaid ? 'Enter query...' : 'Pay to unlock'}
        className="w-full border rounded p-2"
      />
      <button onClick={onClickSearch} disabled={!isPaid || loading}>
        {loading ? 'Loading...' : 'Search'}
      </button>
      <pre>{results}</pre>
    </div>
  )
}
