import { useEffect, useMemo, useState } from 'react'
import './App.css'

const MIN_WORD_LENGTH = 3
const MAX_WORD_LENGTH = 25
const DEFAULT_MAX_GUESSES = 6
const DEFAULT_LANGUAGE = 'en'
const KEYBOARD_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']
const STATUS_PRIORITY = { absent: 1, present: 2, correct: 3 }
const DEFAULT_KEY_BASE64 =
  import.meta.env.VITE_APP_AES_KEY ||
  'B7Nw+9s+4aYvLHuXGgEcg2YkdE+5EYXPLkZXl2bqsx0=' // 32-byte key, replace in env for production

let cachedCryptoKey = null

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const base64UrlEncode = (bytes) => {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const base64UrlDecode = (input) => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function getCryptoKey() {
  if (cachedCryptoKey) return cachedCryptoKey
  const rawKey = base64UrlDecode(DEFAULT_KEY_BASE64)
  cachedCryptoKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return cachedCryptoKey
}

async function encryptPayload(payload) {
  const key = await getCryptoKey()
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit nonce
  const encoded = encoder.encode(JSON.stringify(payload))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  const ciphertext = new Uint8Array(encrypted)
  const combined = new Uint8Array(iv.length + ciphertext.length)
  combined.set(iv, 0)
  combined.set(ciphertext, iv.length)
  return base64UrlEncode(combined)
}

async function decryptPayload(encoded) {
  const key = await getCryptoKey()
  const data = base64UrlDecode(encoded)
  const iv = data.slice(0, 12)
  const ciphertext = data.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  const json = decoder.decode(decrypted)
  return JSON.parse(json)
}

const sanitizeWord = (word) => word.replace(/[^a-z]/gi, '').toUpperCase()

const evaluateGuess = (guess, solution) => {
  const result = Array.from({ length: solution.length }, () => 'absent')
  const remaining = {}

  for (let i = 0; i < solution.length; i += 1) {
    const letter = solution[i]
    if (letter === guess[i]) {
      result[i] = 'correct'
    } else {
      remaining[letter] = (remaining[letter] || 0) + 1
    }
  }

  for (let i = 0; i < solution.length; i += 1) {
    if (result[i] === 'correct') continue
    const letter = guess[i]
    if (remaining[letter]) {
      result[i] = 'present'
      remaining[letter] -= 1
    }
  }

  return result
}

const mergeKeyboardState = (current, guess, states) => {
  const next = { ...current }
  for (let i = 0; i < guess.length; i += 1) {
    const letter = guess[i]
    const status = states[i]
    const prevRank = STATUS_PRIORITY[next[letter]] || 0
    const newRank = STATUS_PRIORITY[status] || 0
    if (newRank >= prevRank) next[letter] = status
  }
  return next
}

const TileRow = ({ letters, states, wordLength, isActive }) => {
  const slots = Array.from({ length: wordLength })
  return (
    <div className="tile-row" style={{ '--word-length': wordLength }}>
      {slots.map((_, idx) => {
        const letter = letters[idx] || ''
        const state = states ? states[idx] : ''
        const statusClass = state ? `tile-${state}` : isActive && letter ? 'tile-active' : ''
        return (
          <div className={`tile ${statusClass}`} key={idx}>
            {letter}
          </div>
        )
      })}
    </div>
  )
}

const Keyboard = ({ onKey, letterStates }) => (
  <div className="keyboard">
    {KEYBOARD_ROWS.map((row, idx) => (
      <div className={`keyboard-row row-${idx + 1}`} key={row}>
        {row.split('').map((letter) => (
          <button
            type="button"
            className={`key key-${letterStates[letter] || 'neutral'}`}
            key={letter}
            onClick={() => onKey(letter)}
          >
            {letter}
          </button>
        ))}
      </div>
    ))}
  </div>
)

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')
  const [shareLink, setShareLink] = useState('')
  const [showCreator, setShowCreator] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return !params.get('d')
  })
  const [copyStatus, setCopyStatus] = useState('')
  const [loadError, setLoadError] = useState('')
  const [puzzle, setPuzzle] = useState(null)
  const [guesses, setGuesses] = useState([])
  const [evaluations, setEvaluations] = useState([])
  const [currentGuess, setCurrentGuess] = useState('')
  const [letterStates, setLetterStates] = useState({})
  const [gameStatus, setGameStatus] = useState('idle') // idle | playing | won | lost
  const [toast, setToast] = useState('')
  const [copyToast, setCopyToast] = useState([])
  const [createForm, setCreateForm] = useState({
    word: '',
    maxGuesses: DEFAULT_MAX_GUESSES,
    title: '',
    hint: '',
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const wordLength = puzzle?.word?.length || MIN_WORD_LENGTH
  const maxGuesses = puzzle?.maxGuesses || DEFAULT_MAX_GUESSES

  const gameOverMessage = useMemo(() => {
    if (gameStatus === 'won') return `You solved it in ${guesses.length} guess${guesses.length === 1 ? '' : 'es'}!`
    if (gameStatus === 'lost') return `Game over — the word was ${puzzle.word}.`
    return ''
  }, [gameStatus, guesses.length, puzzle?.word])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const encoded = params.get('d')
    if (encoded) {
      loadPuzzle(encoded)
    }
  }, [])

  const loadPuzzle = async (encoded) => {
    if (!encoded) return
    try {
      const payload = await decryptPayload(encoded)
      const word = sanitizeWord(payload.word || payload.secret || '')
      const boundedWord = word.slice(0, MAX_WORD_LENGTH)
      const maxGuessesValue = Math.min(12, Math.max(1, Number(payload.maxGuesses || DEFAULT_MAX_GUESSES)))
      if (!boundedWord || boundedWord.length < MIN_WORD_LENGTH) {
        throw new Error('Invalid word length')
      }
      const normalized = {
        word: boundedWord,
        maxGuesses: maxGuessesValue,
        title: payload.title || payload.hint || '',
        hint: payload.hint || '',
        language: payload.language || DEFAULT_LANGUAGE,
      }
      setPuzzle(normalized)
      setGuesses([])
      setEvaluations([])
      setLetterStates({})
      setCurrentGuess('')
      setGameStatus('playing')
      setLoadError('')
    } catch (err) {
      setLoadError('Could not decode puzzle link. Double-check that the URL is complete.')
      setPuzzle(null)
    }
  }

  const handleCreateChange = (field, value) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleGenerateLink = async () => {
    const word = sanitizeWord(createForm.word)
    if (!word) {
      setToast('Secret word must contain letters.')
      return
    }
    if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) {
      setToast(`Word length must be between ${MIN_WORD_LENGTH} and ${MAX_WORD_LENGTH} letters.`)
      return
    }
    const maxGuessesValue = Math.min(12, Math.max(1, Number(createForm.maxGuesses || DEFAULT_MAX_GUESSES)))
    const payload = {
      word,
      maxGuesses: maxGuessesValue,
      title: createForm.title?.trim(),
      hint: createForm.hint?.trim(),
      language: DEFAULT_LANGUAGE,
    }
    try {
      const encoded = await encryptPayload(payload)
      const url = `${window.location.origin}${window.location.pathname}?d=${encoded}`
      setShareLink(url)
      setCopyStatus('')
      setToast('Link generated. Copy it to share!')
    } catch (err) {
      setToast('Encryption failed. Please try again.')
    }
  }

  const copyToClipboard = async (value, messageSetter) => {
    if (!navigator.clipboard) {
      messageSetter('Clipboard unavailable in this browser.')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      messageSetter('Copied!')
      setTimeout(() => messageSetter(''), 1500)
    } catch (err) {
      messageSetter('Copy failed')
    }
  }

  const handleKeyPress = (key) => {
    if (gameStatus !== 'playing' || !puzzle) return
    if (key === 'ENTER') {
      submitGuess()
      return
    }
    if (key === 'BACKSPACE') {
      setCurrentGuess((prev) => prev.slice(0, -1))
      return
    }
    const letter = key.toUpperCase()
    if (/^[A-Z]$/.test(letter) && currentGuess.length < puzzle.word.length) {
      setCurrentGuess((prev) => prev + letter)
    }
  }

  const submitGuess = () => {
    if (!puzzle) return
    if (currentGuess.length !== puzzle.word.length) {
      setToast(`Guesses must be ${puzzle.word.length} letters.`)
      return
    }

    const evaluation = evaluateGuess(currentGuess, puzzle.word)
    const nextGuesses = [...guesses, currentGuess]
    const nextEvaluations = [...evaluations, evaluation]
    setGuesses(nextGuesses)
    setEvaluations(nextEvaluations)
    setLetterStates((prev) => mergeKeyboardState(prev, currentGuess, evaluation))
    setCurrentGuess('')

    if (currentGuess === puzzle.word) {
      setGameStatus('won')
      setToast('Nice!')
    } else if (nextGuesses.length >= puzzle.maxGuesses) {
      setGameStatus('lost')
      setToast('Out of guesses.')
    }
  }

  useEffect(() => {
    if (!puzzle) return undefined
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey) return
      const key = event.key.toUpperCase()
      if (key === 'ENTER' || key === 'BACKSPACE' || /^[A-Z]$/.test(key)) {
        event.preventDefault()
        handleKeyPress(key)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [puzzle, currentGuess, gameStatus, guesses, evaluations])

  const shareResult = () => {
    if (!puzzle || gameStatus !== 'won') return
    const emojiMap = { correct: '🟩', present: '🟨', absent: '⬛' }
    const lines = evaluations
      .map((row) => row.map((state) => emojiMap[state] || '⬛').join(''))
      .join('\n')
    const text = `Secret Wordle ${guesses.length}/${puzzle.maxGuesses}\n${lines}`
    copyToClipboard(text, (msg) => {
      setCopyStatus(msg)
      if (msg.toLowerCase().includes('copied')) {
        const id = Date.now()
        setCopyToast((prev) => [...prev, { id, text: 'Copied results to clipboard' }])
        setTimeout(
          () => setCopyToast((prev) => prev.filter((item) => item.id !== id)),
          1800,
        )
      }
    })
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="toggle-wrap">
          <label className="theme-toggle">
            <input
              type="checkbox"
              checked={theme === 'light'}
              onChange={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            />
            <span className="toggle-track">
              <span className="toggle-icon moon">🌙</span>
              <span className="toggle-icon sun">☀️</span>
              <span className={`toggle-thumb ${theme === 'light' ? 'thumb-light' : 'thumb-dark'}`} />
            </span>
          </label>
        </div>
        <div className="brand">
          <h1>Wordle Maker</h1>
        </div>
      </header>

      <div className="hero-cta">
        <button type="button" className="make-btn" onClick={() => setShowCreator(true)}>
          Make your own puzzle
        </button>
      </div>

      <main className="shell">
        <section className="play-area">
          {puzzle && (puzzle.title || puzzle.hint) && (
            <div className="puzzle-info">
              {puzzle.title && <p className="title">{puzzle.title}</p>}
              {puzzle.hint && <p className="hint">Hint: {puzzle.hint}</p>}
            </div>
          )}
          <div className="board">
            {Array.from({ length: maxGuesses }).map((_, idx) => {
              const guess = guesses[idx] || ''
              const state = evaluations[idx]
              const isActive = gameStatus === 'playing' && idx === guesses.length
              const letters = idx === guesses.length ? currentGuess.split('') : guess.split('')
              return (
                <TileRow
                  key={`${idx}-${guess}`}
                  letters={letters}
                  states={state}
                  wordLength={wordLength}
                  isActive={isActive}
                />
              )
            })}
          </div>

          <div className="controls">
            <div className="guess-row">
              <input
                type="text"
                value={currentGuess}
                maxLength={wordLength}
                placeholder={`${wordLength} letters`}
                onChange={(e) => {
                  const next = sanitizeWord(e.target.value).slice(0, wordLength)
                  setCurrentGuess(next)
                }}
                disabled={gameStatus !== 'playing'}
              />
              <button type="button" onClick={submitGuess} disabled={gameStatus !== 'playing'}>
                Enter
              </button>
              <button type="button" className="ghost" onClick={() => setCurrentGuess((prev) => prev.slice(0, -1))}>
                ⌫
              </button>
            </div>
            <Keyboard onKey={handleKeyPress} letterStates={letterStates} />
          </div>

          <div className="play-footer">
            {loadError && <p className="status error">{loadError}</p>}
            {gameOverMessage && <p className="status">{gameOverMessage}</p>}
            {gameStatus === 'won' && (
              <button type="button" className="ghost" onClick={shareResult}>
                Share result
              </button>
            )}
          </div>
        </section>
      </main>

      {showCreator && (
        <div className="modal-backdrop" onClick={() => setShowCreator(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Create a puzzle</p>
                <h2>Make your own</h2>
              </div>
              <button type="button" className="ghost" onClick={() => setShowCreator(false)}>
                Close
              </button>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Secret word</span>
                <input
                  type="text"
                  placeholder="e.g. BRIGHT"
                  value={createForm.word}
                  onChange={(e) => handleCreateChange('word', e.target.value)}
                />
                <small>
                  Letters only, {MIN_WORD_LENGTH}-{MAX_WORD_LENGTH} characters. Stored uppercase; not visible in the URL.
                </small>
              </label>
              <label className="field">
                <span>Max guesses</span>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={createForm.maxGuesses}
                  onChange={(e) => handleCreateChange('maxGuesses', e.target.value)}
                />
              </label>
              <label className="field">
                <span>Title</span>
                <input
                  type="text"
                  placeholder="Optional"
                  value={createForm.title}
                  onChange={(e) => handleCreateChange('title', e.target.value)}
                />
              </label>
              <label className="field">
                <span>Hint</span>
                <input
                  type="text"
                  placeholder="Optional clue"
                  value={createForm.hint}
                  onChange={(e) => handleCreateChange('hint', e.target.value)}
                />
              </label>
            </div>
            <div className="actions">
              <button type="button" className="primary" onClick={handleGenerateLink}>
                Generate link
              </button>
              {shareLink && (
                <>
                  <div className="share-row">
                    <input type="text" readOnly value={shareLink} />
                    <button type="button" onClick={() => copyToClipboard(shareLink, setCopyStatus)}>
                      Copy
                    </button>
                  </div>
                  {copyStatus && <p className="status">{copyStatus}</p>}
                </>
              )}
              {toast && <p className="status subtle">{toast}</p>}
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack">
        {gameStatus === 'won' && <div className="toast">You won!</div>}
        {copyToast.map((item) => (
          <div className="toast" key={item.id}>
            {item.text}
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
