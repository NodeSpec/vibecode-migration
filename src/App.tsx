import { useState } from 'react'
import { splitBill } from './split.ts'

function App() {
  const [bill, setBill] = useState('')
  const [tip, setTip] = useState('15')
  const [people, setPeople] = useState('2')

  const perPerson = splitBill(Number(bill), Number(tip), Number(people))

  return (
    <main>
      <h1>Split the bill</h1>
      <label>
        Bill total
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={bill}
          onChange={(e) => setBill(e.target.value)}
        />
      </label>
      <label>
        Tip %
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={tip}
          onChange={(e) => setTip(e.target.value)}
        />
      </label>
      <label>
        People
        <input
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={people}
          onChange={(e) => setPeople(e.target.value)}
        />
      </label>
      <p className="result" aria-live="polite">
        {perPerson === null ? (
          'Enter a valid bill, tip and number of people.'
        ) : (
          <>
            Each person pays <strong>{perPerson.toFixed(2)}</strong>
          </>
        )}
      </p>
    </main>
  )
}

export default App
