import { ArrowLeft, ArrowRight, Check, Clock3, Edit3, Layers3, RotateCcw, Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { compareTypedAnswer, getAssetForCard } from '../lib/content'
import { formatDue, formatDuration } from '../lib/date'
import { previewReview } from '../lib/fsrs'
import { rectStyle } from '../lib/occlusion'
import { useApp } from '../state/AppContext'
import type { ReviewRating } from '../types'
import { compareExtensionPromptV2, extensionUiContributionsV2, hasExtensionPromptTypeV2, renderExtensionPromptV2 } from '../extensions/v2/registry'
import { ExtensionUiFrameV2 } from '../extensions/v2/ExtensionUiFrameV2'
import { SandboxedCardFrame } from '../components/SandboxedCardFrame'
import { safeExternalUrl } from '../lib/urls'
import { KnowledgeItemEditor } from '../components/KnowledgeItemEditor'

export const ReviewPage = () => {
  const { activeSession, data, endSession, navigate, reviewCard, undoLastReview } = useApp()
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState<ReviewRating[]>([])
  const [durations, setDurations] = useState<number[]>([])
  const [reviewedIndices, setReviewedIndices] = useState<number[]>([])
  const startedAtRef = useRef(0)
  const [typedAnswer, setTypedAnswer] = useState('')
  const [editing, setEditing] = useState(false)
  const [renderError, setRenderError] = useState('')
  const [atTransition, setAtTransition] = useState(false)
  const gradingRef = useRef(false)
  const currentCardIdRef = useRef<string | undefined>(undefined)
  const activeTimeRef = useRef({ startedAt: 0, elapsedMs: 0 })
  const revealedHeadingRef = useRef<HTMLHeadingElement>(null)
  const transitionHeadingRef = useRef<HTMLHeadingElement>(null)
  const completionHeadingRef = useRef<HTMLHeadingElement>(null)
  const typedInputRef = useRef<HTMLInputElement>(null)
  const entry = activeSession?.queue[index]
  const card = data.cards.find((candidate) => candidate.id === entry?.card.id)
  const item = data.items.find((candidate) => candidate.id === card?.itemId)
  const [externalContentState, setExternalContentState] = useState<{ cardId: string; value: Awaited<ReturnType<typeof renderExtensionPromptV2>> } | null>(null)
  const [typedResultState, setTypedResultState] = useState<{ key: string; value: { result: 'exact' | 'close' | 'incorrect'; similarity: number } | null } | null>(null)
  const externalContent = externalContentState && externalContentState.cardId === card?.id ? externalContentState.value : null
  const fallbackContent = useMemo(() => item ? ({ prompt: item.prompt, answer: item.answer, context: item.context, typed: false, mediaId: item.mediaIds[0], citations: item.citations }) : null, [item])
  const content = externalContent || fallbackContent

  const preview = useMemo(() => card ? previewReview(card, card.schedulerOptions || data.settings.retention) : null, [card, data.settings.retention])

  const resetTimer = () => {
    const now = performance.now()
    startedAtRef.current = now
    activeTimeRef.current = { startedAt: document.hidden ? 0 : now, elapsedMs: 0 }
  }

  const continueToBlock = () => {
    setAtTransition(false)
    resetTimer()
  }

  const grade = (rating: ReviewRating, allowUnrevealed = false, expectedCardId = card?.id) => {
    if ((!revealed && !allowUnrevealed) || !card || !activeSession || gradingRef.current || expectedCardId !== card.id || currentCardIdRef.current !== card.id) return
    gradingRef.current = true
    const now = performance.now()
    const activeMilliseconds = activeTimeRef.current.elapsedMs + (activeTimeRef.current.startedAt ? now - activeTimeRef.current.startedAt : 0)
    const rawDuration = Math.max(2, Math.round((now - startedAtRef.current) / 1000))
    const duration = Math.max(2, Math.min(120, Math.round(activeMilliseconds / 1000)))
    const shouldBurySiblings = card.scheduling?.queue === 'new' || card.fsrs.state === 0 ? (card.schedulerOptions?.buryNewSiblings ?? data.settings.burySiblings) : (card.schedulerOptions?.buryReviewSiblings ?? data.settings.burySiblings)
    const siblingIds = new Set(shouldBurySiblings ? data.cards.filter((candidate) => candidate.itemId === card.itemId && candidate.id !== card.id).map((candidate) => candidate.id) : [])
    let nextIndex = index + 1
    while (nextIndex < activeSession.queue.length) {
      const candidate = data.cards.find((value) => value.id === activeSession.queue[nextIndex]?.card.id)
      if (candidate && !candidate.suspended && !siblingIds.has(candidate.id) && (!candidate.buriedUntil || Date.parse(candidate.buriedUntil) <= Date.now())) break
      nextIndex += 1
    }
    const nextEntry = activeSession.queue[nextIndex]
    reviewCard(card.id, rating, duration, rawDuration)
    setResults((current) => [...current, rating])
    setDurations((current) => [...current, duration])
    setReviewedIndices((current) => [...current, index])
    setIndex(nextIndex)
    setAtTransition(Boolean(nextEntry && nextEntry.blockId !== entry?.blockId))
    setRevealed(false)
    setTypedAnswer('')
    if (!nextEntry || nextEntry.blockId === entry?.blockId) resetTimer()
  }

  const undo = () => {
    const reviewedIndex = reviewedIndices.at(-1)
    if (reviewedIndex === undefined) return
    undoLastReview()
    setIndex(reviewedIndex)
    setResults((current) => current.slice(0, -1))
    setDurations((current) => current.slice(0, -1))
    setReviewedIndices((current) => current.slice(0, -1))
    setAtTransition(false)
    setRevealed(true)
    resetTimer()
    gradingRef.current = false
  }

  useEffect(() => {
    currentCardIdRef.current = card?.id
    gradingRef.current = false
  }, [card?.id])

  useEffect(() => {
    let current = true
    queueMicrotask(() => {
      if (!current) return
      setRenderError('')
      setExternalContentState(null)
      if (item && card && card.variant !== 'forward' && !hasExtensionPromptTypeV2(card.variant)) setRenderError(`The extension for “${card.variant}” is unavailable. Neo Anki is showing the saved Prompt and Answer as a compatibility fallback; re-enable the extension to restore its intended behavior.`)
    })
    if (item && card && card.variant !== 'forward') {
      if (hasExtensionPromptTypeV2(card.variant)) void renderExtensionPromptV2(item, card).then((value) => { if (current) setExternalContentState({ cardId: card.id, value }) }).catch((error) => { if (current) setRenderError(error instanceof Error ? error.message : 'The extension could not render this practice prompt.') })
    }
    return () => { current = false }
  }, [card, item])

  useEffect(() => {
    let current = true
    if (revealed && card && (content?.typed || card.rendering?.typedAnswer)) {
      const expected = card.rendering?.typedAnswer?.expected || content?.answer || ''
      const key = `${card.id}:${typedAnswer}:${expected}`
      if (!card.rendering?.typedAnswer) void compareExtensionPromptV2(card.variant, typedAnswer, expected).then((value) => { if (current) setTypedResultState({ key, value: value || compareTypedAnswer(typedAnswer, expected) }) }).catch(() => { if (current) setTypedResultState({ key, value: compareTypedAnswer(typedAnswer, expected) }) })
    }
    return () => { current = false }
  }, [card, content, revealed, typedAnswer])

  useEffect(() => {
    const now = performance.now()
    startedAtRef.current = now
    activeTimeRef.current = { startedAt: document.hidden ? 0 : now, elapsedMs: 0 }
  }, [])

  useEffect(() => {
    if (revealed) revealedHeadingRef.current?.focus({ preventScroll: true })
    else window.requestAnimationFrame(() => typedInputRef.current?.focus({ preventScroll: true }))
  }, [revealed, card?.id])

  useEffect(() => {
    if (atTransition) transitionHeadingRef.current?.focus({ preventScroll: true })
    else if (activeSession && (!entry || !card || !item)) completionHeadingRef.current?.focus({ preventScroll: true })
  }, [activeSession, atTransition, card, entry, item])

  useEffect(() => {
    const onVisibility = () => {
      const now = performance.now()
      if (document.hidden) {
        if (activeTimeRef.current.startedAt) activeTimeRef.current.elapsedMs += now - activeTimeRef.current.startedAt
        activeTimeRef.current.startedAt = 0
      } else if (!activeTimeRef.current.startedAt) activeTimeRef.current.startedAt = now
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'Escape') endSession()
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && results.length > 0) { event.preventDefault(); undo(); return }
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
      if (revealed && event.key === '4') grade(4)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!activeSession) {
    return <div className="session-complete"><p className="eyebrow">No active session</p><h1>Choose how you want to practice.</h1><button className="primary-button" onClick={() => navigate('today')}>Return to Today</button></div>
  }

  if (!entry || !card || !item) {
    const recalled = results.filter((rating) => rating >= 3).length
    const elapsed = durations.reduce((sum, duration) => sum + duration, 0)
    return (
      <div className="session-complete">
        <div className="success-mark"><Check size={30} /></div>
        <p className="eyebrow">Session complete</p>
        <h1 ref={completionHeadingRef} tabIndex={-1}>That was enough for this session.</h1>
        <p>You reviewed {results.length} practice {results.length === 1 ? 'prompt' : 'prompts'} across {activeSession.blocks.length} {activeSession.blocks.length === 1 ? 'context' : 'contexts'}. {activeSession.request.reschedule === false ? 'This was preview-only practice, so due dates and intervals were not changed.' : 'Everything left simply rolls into the next session.'}</p>
        <div className="completion-stats">
          <div><strong>{formatDuration(elapsed)}</strong><span>focused time</span></div>
          <div><strong>{recalled}</strong><span>successful retrievals</span></div>
          <div><strong>{results.length - recalled}</strong><span>forgotten</span></div>
        </div>
        <div className="button-row">{results.length > 0 && <button className="secondary-button" onClick={undo}><Undo2 size={17}/> Undo last answer</button>}<button className="primary-button" onClick={endSession}>{activeSession.request.kind === 'custom' ? 'Return to Library' : 'Return to Today'}</button></div>
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
        <h1 ref={transitionHeadingRef} tabIndex={-1}>{previousBlock.contextKey} complete.</h1>
        <p>Take a breath. Next is <strong>{currentBlock.contextKey}</strong>—{currentBlock.cards.length} practice {currentBlock.cards.length === 1 ? 'prompt' : 'prompts'}, about {formatDuration(currentBlock.estimatedSeconds)}.</p>
        <button className="primary-button" onClick={continueToBlock}>Begin {currentBlock.contextKey} <ArrowRight size={18} /></button>
        <span className="keyboard-hint">Press <kbd>Space</kbd> or <kbd>Enter</kbd> when you’re ready.</span>
      </div>
    )
  }

  if (!content) return <div className="route-loading" role="status">Loading prompt…</div>
  const templateRendering = card.rendering?.source === 'anki-template' ? card.rendering : undefined
  const asset = content.mediaId ? data.assets.find((candidate) => candidate.id === content.mediaId) : getAssetForCard(item, data.assets)
  const missingRequestedAsset = Boolean(content.mediaId && !asset)
  const typedExpected = templateRendering?.typedAnswer?.expected || content.answer
  const isTyped = Boolean(templateRendering?.typedAnswer || content.typed)
  const typedKey = `${card.id}:${typedAnswer}:${typedExpected}`
  const typedResult = revealed && isTyped ? templateRendering?.typedAnswer ? compareTypedAnswer(typedAnswer, typedExpected) : typedResultState?.key === typedKey ? typedResultState.value : null : null
  const progress = ((index + 1) / activeSession.queue.length) * 100
  const isolatedReviewTools = extensionUiContributionsV2('review')

  return (
    <div className="review-page">
      <header className="review-header">
        <div className="review-nav-actions"><button className="text-button" onClick={endSession}><ArrowLeft size={18} /> End session</button>{results.length > 0 && <button className="text-button" onClick={undo} title="Undo last answer (⌘Z)"><Undo2 size={17}/> Undo</button>}</div>
        <div className="session-progress" role="progressbar" aria-label="Review session progress" aria-valuemin={1} aria-valuemax={activeSession.queue.length} aria-valuenow={index + 1} aria-valuetext={`Reviewing practice prompt ${index + 1} of ${activeSession.queue.length}`}><span style={{ width: `${progress}%` }} /></div>
        <div className="review-status">
          <div className="review-tool-host">
            {isolatedReviewTools.map((contribution) => <ExtensionUiFrameV2 key={`${contribution.extensionId}:${contribution.id}`} contribution={contribution} reloadKey={`${card.id}:${revealed ? 'answer' : 'prompt'}`} dto={{ card: { id: card.id, noteId: item.id, deck: item.collection, tags: item.tags, suspended: card.suspended, dueAt: card.fsrs.due }, revealed }} />)}
          </div>
          <div className="review-count"><span>{entry.contextKey}</span>{index + 1} / {activeSession.queue.length}</div>
        </div>
      </header>

      {activeSession.request.kind === 'custom' && <div className="custom-study-banner" role="status"><strong>Custom study</strong><span>{activeSession.request.reschedule === false ? 'Preview only · ratings are recorded, scheduling is unchanged' : 'Ratings update normal scheduling'}</span></div>}

      <div className="visually-hidden" role="status" aria-live="polite">{revealed ? 'Answer revealed. Choose Forgot, Recalled with effort, Recalled, or Easy recall.' : 'Practice prompt ready.'}</div>
      {renderError && <div className="inline-message warning extension-render-warning" role="alert"><span>{renderError}</span><button className="text-button" onClick={() => navigate('extensions')}>Open Extensions</button></div>}
      {missingRequestedAsset && <div className="inline-message error" role="alert">This practice prompt’s selected media file is missing. Open the knowledge item to replace it.</div>}
      <article className={revealed ? 'review-card revealed' : 'review-card'}>
        <div className="review-meta"><span>Block {entry.blockIndex + 1} · {item.collection}</span><span>{card.fsrs.state === 0 ? 'New' : 'Review'}</span></div>
        {templateRendering ? <div className="prompt-content template-card-content">
          <p className="review-label">{revealed ? 'Answer' : 'Prompt'}</p>
          <h1 ref={revealedHeadingRef} className="visually-hidden" tabIndex={-1}>{revealed ? 'Answer' : 'Prompt'}</h1>
          <SandboxedCardFrame html={revealed ? templateRendering.answerHtml : templateRendering.questionHtml} css={templateRendering.css} title={`${revealed ? 'Answer' : 'Prompt'} for ${item.collection}`} theme={data.settings.theme} />
        </div> : <div className="prompt-content"><p className="review-label">Prompt</p><h1>{content.prompt}</h1></div>}
        {!templateRendering && asset?.mimeType.startsWith('image/') && <div className="review-media image-stage"><img src={asset.dataUrl} alt={asset.altText || asset.filename}/>{!revealed && item.occlusions.filter((rect) => !card.occlusionId || rect.id === card.occlusionId).map((rect) => <span className="occlusion-mask" style={rectStyle(rect)} key={rect.id}>Hidden</span>)}</div>}
        {/* User-supplied study audio may not have a caption track. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        {!templateRendering && asset?.mimeType.startsWith('audio/') && <audio className="review-audio" controls src={asset.dataUrl}>Your browser cannot play this audio.</audio>}
        {isTyped && !revealed && <div className="form-field typed-answer"><label htmlFor="typed-answer">Type your answer</label><input ref={typedInputRef} id="typed-answer" autoComplete="off" spellCheck={false} value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setRevealed(true) }}/><small>Leave it blank when you do not know; your answer stays on this device.</small></div>}
        {revealed && (
          <div className="answer-content">
            {!templateRendering && <><h2 ref={revealedHeadingRef} className="review-label answer-focus-heading" tabIndex={-1}>Answer</h2><div className="answer-text">{content.answer}</div></>}
            {typedResult && <div className="typed-comparison"><p className={`typed-result ${typedResult.result}`}>{typedResult.result === 'exact' ? 'Exact match' : typedResult.result === 'close' ? 'Almost—check the difference' : 'Different answer'}</p><dl><div><dt>Your answer</dt><dd>{typedAnswer}</dd></div><div><dt>Expected</dt><dd>{typedExpected}</dd></div></dl><p>Use the suggested result as evidence, then choose your own grade.</p></div>}
            {content.context && <p className="answer-context">{content.context}</p>}
            {content.citations.length > 0 && <div className="review-citations"><strong>Sources</strong>{content.citations.map((citation) => { const url = safeExternalUrl(citation.url); return url ? <a key={citation.id} href={url} target="_blank" rel="noopener noreferrer">{citation.title}</a> : <span key={citation.id}>{citation.title}</span> })}</div>}
          </div>
        )}
        <button className="edit-card-button" aria-label="Edit this knowledge item" onClick={() => setEditing(true)}><Edit3 size={17} /> Edit</button>
      </article>
      {editing && <KnowledgeItemEditor item={item} onClose={() => setEditing(false)} />}

      <div className="review-actions">
        {!revealed ? (
          <button className="primary-button reveal-button" onClick={() => setRevealed(true)}>{isTyped ? (typedAnswer.trim() ? 'Check answer' : "I don’t know — reveal") : 'Reveal answer'} <kbd>{isTyped ? 'Enter' : 'Space'}</kbd></button>
        ) : (
          <div className="grade-grid" aria-label="How well did you remember?">
            <button className="grade-button forgot" onClick={() => grade(1)}><span><RotateCcw size={19} />Forgot</span><small>{activeSession.request.reschedule === false ? 'No schedule change' : preview ? formatDue(preview.forgot.toISOString()) : ''}</small><kbd>1</kbd></button>
            <button className="grade-button effort" onClick={() => grade(2)}><span><Clock3 size={19} />Recalled with effort</span><small>{activeSession.request.reschedule === false ? 'No schedule change' : preview ? formatDue(preview.effort.toISOString()) : ''}</small><kbd>2</kbd></button>
            <button className="grade-button recalled" onClick={() => grade(3)}><span><Check size={19} />Recalled</span><small>{activeSession.request.reschedule === false ? 'No schedule change' : preview ? formatDue(preview.recalled.toISOString()) : ''}</small><kbd>3</kbd></button>
            <button className="grade-button easy" onClick={() => grade(4)}><span><Sparkles size={19} />Easy recall</span><small>{activeSession.request.reschedule === false ? 'No schedule change' : preview ? formatDue(preview.easy.toISOString()) : ''}</small><kbd>4</kbd></button>
          </div>
        )}
      </div>
    </div>
  )
}
