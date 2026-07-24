import type { CardRenderingProjection } from '../types'

export const NativeCardContent = ({
  content,
  revealed,
  className = '',
}: {
  content: CardRenderingProjection
  revealed: boolean
  className?: string
}) => (
  <div className={`native-card-content ${revealed ? 'revealed' : ''} ${className}`.trim()}>
    <section className="native-card-face" aria-label="Practice question">
      <span className="native-card-field-label">{content.prompt.label}</span>
      <div className="native-card-primary">{content.prompt.value || 'Empty prompt'}</div>
    </section>
    {revealed && (
      <section className="native-card-face native-card-answer" aria-label="Revealed response">
        <span className="native-card-field-label">{content.answer.label}</span>
        <div className="native-card-primary">{content.answer.value || 'Empty answer'}</div>
        {content.supporting.length > 0 && (
          <dl className="native-card-supporting">
            {content.supporting.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
          </dl>
        )}
      </section>
    )}
  </div>
)
