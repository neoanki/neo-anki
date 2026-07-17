import { ArrowLeft, ArrowRight, Check, Clock3, Edit3, Layers3, RotateCcw, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getAssetForCard } from '../lib/content'
import { formatDue, formatDuration } from '../lib/date'
import { previewReview } from '../lib/fsrs'
import { rectStyle } from '../extensions/image-occlusion'
import { extensionRuntime } from '../extensions/runtime'
import { useApp } from '../state/AppContext'
import type { ReviewRating } from '../types'
import { ExtensionHostBoundary } from '../components/ExtensionHostBoundary'
import { createExtensionHost } from '../extensions/host'

export const ReviewPage = () => {
  const { activeSession, data, endSession, navigate, reviewCard, undoLastReview } = useApp()
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState<ReviewRating[]>([])
  const [durations, setDurations] = useState<number[]>([])
  const [startedAt, setStartedAt] = useState(() => performance.now())
  const [typedAnswer, setTypedAnswer] = useState('')
  const [atTransition, setAtTransition] = useState(false)
  const gradingRef = useRef(false)
  const currentCardIdRef = useRef<string | undefined>(undefined)
  const entry = activeSession?.queue[index]
  const card = data.cards.find((candidate) => candidate.id === entry?.card.id)
  const item = data.items.find((candidate) => candidate.id === card?.itemId)

  const preview = useMemo(() => card ? previewReview(card, data.settings.retention) : null, [card, data.settings.retention])

  const continueToBlock = () => {
    setAtTransition(false)
    setStartedAt(performance.now())
  }

  const grade = (rating: ReviewRating, allowUnrevealed = false, expectedCardId = card?.id) => {
    if ((!revealed && !allowUnrevealed) || !card || !activeSession || gradingRef.current || expectedCardId !== card.id || currentCardIdRef.current !== card.id) return
    gradingRef.current = true
    const duration = Math.max(2, Math.round((performance.now() - startedAt) / 1000))
    const nextEntry = activeSession.queue[index + 1]
    reviewCard(card.id, rating, duration)
    setResults((current) => [...current, rating])
    setDurations((current) => [...current, duration])
    setIndex((current) => current + 1)
    setAtTransition(Boolean(nextEntry && nextEntry.blockId !== entry?.blockId))
    setRevealed(false)
    setTypedAnswer('')
    if (!nextEntry || nextEntry.blockId === entry?.blockId) setStartedAt(performance.now())
  }

  const undo = () => {
    if (index <= 0) return
    undoLastReview()
    setIndex((current) => Math.max(0, current - 1))
    setResults((current) => current.slice(0, -1))
    setDurations((current) => current.slice(0, -1))
    setAtTransition(false)
    setRevealed(true)
    setStartedAt(performance.now())
    gradingRef.current = false
  }

  useEffect(() => {
    currentCardIdRef.current = card?.id
    gradingRef.current = false
  }, [card?.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'Escape') endSession()
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && index > 0) { event.preventDefault(); undo(); return }
      if (atTransition && (event.code === 'Space' || event.key === 'Enter')) {
        event.preventDefault()
        continueToBlock()
        return
      }
      if (atTransition) return
      if (event.code === 'Space') {
        event.preventDefault()
        setRevealed(true)
      }
      if (revealed && event.key === '1') grade(1)
      if (revealed && event.key === '2') grade(2)
      if (revealed && event.key === '3') grade(3)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!activeSession) {
    return <div className="session-complete"><p className="eyebrow">No active session</p><h1>Choose how you want to practice.</h1><button className="primary-button" onClick={() => navigate('today')}>Return to Today</button></div>
  }

  if (!entry || !card || !item) {
    const recalled = results.filter((rating) => rating > 1).length
    const elapsed = durations.reduce((sum, duration) => sum + duration, 0)
    return (
      <div className="session-complete">
        <div className="success-mark"><Check size={30} /></div>
        <p className="eyebrow">Session complete</p>
        <h1>That was enough for this session.</h1>
        <p>You reviewed {results.length} prompts across {activeSession.blocks.length} {activeSession.blocks.length === 1 ? 'context' : 'contexts'}. Everything left simply rolls into the next session.</p>
        <div className="completion-stats">
          <div><strong>{formatDuration(elapsed)}</strong><span>focused time</span></div>
          <div><strong>{recalled}</strong><span>recalled</span></div>
          <div><strong>{results.length - recalled}</strong><span>to reinforce</span></div>
        </div>
        <div className="button-row"><button className="secondary-button" onClick={undo}><Undo2 size={17}/> Undo last answer</button><button className="primary-button" onClick={endSession}>Return to Today</button></div>
      </div>
    )
  }

  const currentBlock = activeSession.blocks[entry.blockIndex]
  const previousBlock = activeSession.blocks[Math.max(0, entry.blockIndex - 1)]

  if (atTransition) {
    return (
      <div className="context-transition">
        <div className="review-nav-actions transition-end"><button className="text-button" onClick={endSession}><ArrowLeft size={18} /> End session</button><button className="text-button" onClick={undo}><Undo2 size={17}/> Undo</button></div>
        <div className="transition-mark"><Layers3 size={28} /></div>
        <p className="eyebrow">Context switch · block {entry.blockIndex + 1} of {activeSession.blocks.length}</p>
        <h1>{previousBlock.contextKey} complete.</h1>
        <p>Take a breath. Next is <strong>{currentBlock.contextKey}</strong>—{currentBlock.cards.length} prompts, about {formatDuration(currentBlock.estimatedSeconds)}.</p>
        <button className="primary-button" onClick={continueToBlock}>Begin {currentBlock.contextKey} <ArrowRight size={18} /></button>
        <span className="keyboard-hint">Press <kbd>Space</kbd> or <kbd>Enter</kbd> when you’re ready.</span>
      </div>
    )
  }

  const content = extensionRuntime.render(item, card)
  const asset = getAssetForCard(item, data.assets)
  const typedResult = revealed && content.typed ? extensionRuntime.compareAnswer(card.variant, typedAnswer, content.answer) : null
  const progress = ((index + (revealed ? 0.5 : 0)) / activeSession.queue.length) * 100
  const reviewTools = extensionRuntime.reviewTools()

  return (
    <div className="review-page">
      <header className="review-header">
        <div className="review-nav-actions"><button className="text-button" onClick={endSession}><ArrowLeft size={18} /> End session</button>{index > 0 && <button className="text-button" onClick={undo} title="Undo last answer (⌘Z)"><Undo2 size={17}/> Undo</button>}</div>
        <div className="session-progress" role="progressbar" aria-label="Review session progress" aria-valuemin={0} aria-valuemax={activeSession.queue.length} aria-valuenow={index + 1}><span style={{ width: `${progress}%` }} /></div>
        <div className="review-status">
          <div className="review-tool-host">
            {reviewTools.map(({ id, extensionId, component: Tool }) => (
              <ExtensionHostBoundary key={`${extensionId}:${id}`} onError={(error) => extensionRuntime.reportDiagnostic(extensionId, id, error)}>
                <Tool extensionId={extensionId} card={structuredClone(card)} item={structuredClone(item)} assets={structuredClone(data.assets)} revealed={revealed} host={createExtensionHost(extensionId)} submitRating={(rating) => grade(rating, true, card.id)} />
              </ExtensionHostBoundary>
            ))}
          </div>
          <div className="review-count"><span>{entry.contextKey}</span>{index + 1} / {activeSession.queue.length}</div>
        </div>
      </header>

      <article className={revealed ? 'review-card revealed' : 'review-card'} aria-live="polite">
        <div className="review-meta"><span>Block {entry.blockIndex + 1} · {item.collection}</span><span>{card.fsrs.state === 0 ? 'New' : 'Review'}</span></div>
        <div className="prompt-content"><p className="review-label">Prompt</p><h1>{content.prompt}</h1></div>
        {asset?.mimeType.startsWith('image/') && <div className="review-media image-stage"><img src={asset.dataUrl} alt={asset.altText || asset.filename}/>{!revealed && item.occlusions.filter((rect) => !card.occlusionId || rect.id === card.occlusionId).map((rect) => <span className="occlusion-mask" style={rectStyle(rect)} key={rect.id}>Hidden</span>)}</div>}
        {/* User-supplied study audio may not have a caption track. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        {asset?.mimeType.startsWith('audio/') && <audio className="review-audio" controls src={asset.dataUrl}>Your browser cannot play this audio.</audio>}
        {content.typed && !revealed && <div className="form-field typed-answer"><label htmlFor="typed-answer">Type your answer</label><input id="typed-answer" value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && typedAnswer.trim()) setRevealed(true) }}/></div>}
        {revealed && (
          <div className="answer-content">
            <p className="review-label">Answer</p>
            <div className="answer-text">{content.answer}</div>
            {typedResult && <p className={`typed-result ${typedResult.result}`}>{typedResult.result === 'exact' ? 'Exact match' : typedResult.result === 'close' ? 'Almost—check the difference' : 'Different answer'}</p>}
            {content.context && <p className="answer-context">{content.context}</p>}
            {content.citations.length > 0 && <div className="review-citations"><strong>Sources</strong>{content.citations.map((citation) => citation.url ? <a key={citation.id} href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a> : <span key={citation.id}>{citation.title}</span>)}</div>}
          </div>
        )}
        <button className="edit-card-button" aria-label="Edit this knowledge item" onClick={() => navigate('library')}><Edit3 size={17} /> Edit</button>
      </article>

      <div className="review-actions">
        {!revealed ? (
          <button className="primary-button reveal-button" onClick={() => setRevealed(true)} disabled={content.typed && !typedAnswer.trim()}>{content.typed ? 'Check answer' : 'Reveal answer'} <kbd>{content.typed ? 'Enter' : 'Space'}</kbd></button>
        ) : (
          <div className="grade-grid" aria-label="How well did you remember?">
            <button className="grade-button forgot" onClick={() => grade(1)}><span><RotateCcw size={19} />Forgot</span><small>{preview ? formatDue(preview.forgot.toISOString()) : ''}</small><kbd>1</kbd></button>
            <button className="grade-button effort" onClick={() => grade(2)}><span><Clock3 size={19} />Recalled with effort</span><small>{preview ? formatDue(preview.effort.toISOString()) : ''}</small><kbd>2</kbd></button>
            <button className="grade-button recalled" onClick={() => grade(3)}><span><Check size={19} />Recalled</span><small>{preview ? formatDue(preview.recalled.toISOString()) : ''}</small><kbd>3</kbd></button>
          </div>
        )}
      </div>
    </div>
  )
}
