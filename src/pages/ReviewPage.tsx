import { ArrowLeft, Check, Clock3, Edit3, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { compareTypedAnswer, getAssetForCard, renderCard } from '../lib/content'
import { formatDue } from '../lib/date'
import { previewReview } from '../lib/fsrs'
import { useApp } from '../state/AppContext'
import type { ReviewRating } from '../types'
import { rectStyle } from '../lib/occlusion'

export const ReviewPage = () => {
  const { data, plan, navigate, reviewCard } = useApp()
  const [initialQueue] = useState(() => plan.queue.map((entry) => entry.card.id))
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState<ReviewRating[]>([])
  const [startedAt, setStartedAt] = useState(() => performance.now())
  const [typedAnswer, setTypedAnswer] = useState('')
  const cardId = initialQueue[index]
  const card = data.cards.find((candidate) => candidate.id === cardId)
  const item = data.items.find((candidate) => candidate.id === card?.itemId)

  const preview = useMemo(() => card ? previewReview(card, data.settings.retention) : null, [card, data.settings.retention])

  const grade = (rating: ReviewRating) => {
    if (!revealed || !card) return
    const duration = Math.max(2, Math.round((performance.now() - startedAt) / 1000))
    reviewCard(card.id, rating, duration)
    setResults((current) => [...current, rating])
    setIndex((current) => current + 1)
    setRevealed(false)
    setTypedAnswer('')
    setStartedAt(performance.now())
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'Escape') navigate('today')
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

  if (!card || !item) {
    const recalled = results.filter((rating) => rating > 1).length
    return (
      <div className="session-complete">
        <div className="success-mark"><Check size={30} /></div>
        <p className="eyebrow">Session complete</p>
        <h1>That was enough for today.</h1>
        <p>You reviewed {results.length} prompts and recalled {recalled}. Neo Anki has already rebuilt tomorrow’s plan.</p>
        <div className="completion-stats">
          <div><strong>{results.length}</strong><span>reviewed</span></div>
          <div><strong>{recalled}</strong><span>recalled</span></div>
          <div><strong>{results.length - recalled}</strong><span>to reinforce</span></div>
        </div>
        <button className="primary-button" onClick={() => navigate('today')}>Return to Today</button>
      </div>
    )
  }

  const content = renderCard(item, card)
  const asset = getAssetForCard(item, data.assets)
  const typedResult = revealed && content.typed ? compareTypedAnswer(typedAnswer, content.answer) : null
  const progress = ((index + (revealed ? 0.5 : 0)) / initialQueue.length) * 100

  return (
    <div className="review-page">
      <header className="review-header">
        <button className="text-button" onClick={() => navigate('today')}><ArrowLeft size={18} /> End session</button>
        <div className="session-progress" role="progressbar" aria-label="Review session progress" aria-valuemin={0} aria-valuemax={initialQueue.length} aria-valuenow={index + 1}><span style={{ width: `${progress}%` }} /></div>
        <div className="review-count">{index + 1} / {initialQueue.length}</div>
      </header>

      <article className={revealed ? 'review-card revealed' : 'review-card'} aria-live="polite">
        <div className="review-meta"><span>{item.collection}</span><span>{card.fsrs.state === 0 ? 'New' : 'Review'}</span></div>
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
