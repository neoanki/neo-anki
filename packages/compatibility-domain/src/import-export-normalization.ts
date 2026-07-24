/**
 * Compatibility conversion for workspace documents created before native card
 * templates. Legacy presentation and scheduling concepts are accepted only at
 * this import boundary and are materialized into Neo-native data.
 */

type UnknownRecord = Record<string, unknown>

const record = (value: unknown): UnknownRecord => value && typeof value === 'object' ? value as UnknownRecord : {}
const list = (value: unknown): UnknownRecord[] => Array.isArray(value) ? value.map(record) : []
const text = (value: unknown) => typeof value === 'string' ? value : ''

const legacyEntities: Record<string, string> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  '#39': "'",
}

const decodeEntities = (value: string) => {
  let cursor = 0
  let output = ''
  while (cursor < value.length) {
    if (value[cursor] !== '&') {
      output += value[cursor]
      cursor += 1
      continue
    }
    const end = value.indexOf(';', cursor + 1)
    const token = end > cursor && end - cursor <= 6 ? value.slice(cursor + 1, end).toLowerCase() : ''
    const replacement = legacyEntities[token]
    if (replacement === undefined) {
      output += '&'
      cursor += 1
      continue
    }
    output += replacement
    cursor = end + 1
  }
  return output
}

const replaceSoundReferences = (value: string) => {
  const lowerValue = value.toLowerCase()
  let cursor = 0
  let output = ''
  while (cursor < value.length) {
    const start = lowerValue.indexOf('[sound:', cursor)
    if (start < 0) return output + value.slice(cursor)
    const end = value.indexOf(']', start + 7)
    if (end < 0) return output + value.slice(cursor)
    output += `${value.slice(cursor, start)} Audio: ${value.slice(start + 7, end)} `
    cursor = end + 1
  }
  return output
}

const plainText = (value: string) => decodeEntities(replaceSoundReferences(value)
  .replace(/<br[\s/]*>/gi, '\n')
  .replace(/<hr[\s/]*>/gi, '\n')
  .replace(/<\/(?:div|p|li|tr|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n[ \t]+/g, '\n')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const applyConditionals = (format: string, values: Record<string, string>) => {
  let current = format
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false
    current = current.replace(/{{([#^])([^{}]+)}}([\s\S]*?){{\/\2}}/g, (_match, mode: string, name: string, body: string) => {
      changed = true
      const present = Boolean(plainText(values[name.trim()] || ''))
      return mode === '#' ? present ? body : '' : present ? '' : body
    })
    if (!changed) break
  }
  return current
}

const deletionSide = (value: string, ordinal: number, side: 'prompt' | 'answer') => value.replace(
  /{{c(\d+)::([\s\S]*?)(?:::(.*?))?}}/gi,
  (_match, rawOrdinal: string, content: string, hint: string | undefined) =>
    Number(rawOrdinal) !== ordinal || side === 'answer' ? content : `[${hint ? plainText(hint) : '…'}]`,
)

const renderLegacySide = (
  format: string,
  values: Record<string, string>,
  side: 'prompt' | 'answer',
  ordinal: number,
  front = '',
) => {
  const conditioned = applyConditionals(format, { ...values, FrontSide: front })
  const rendered = conditioned.replace(/{{([^{}]+)}}/g, (_match, rawToken: string) => {
    const token = rawToken.trim()
    if (token === 'FrontSide') return front
    const separator = token.indexOf(':')
    const filter = separator > 0 ? token.slice(0, separator).trim().toLowerCase() : ''
    const name = separator > 0 ? token.slice(separator + 1).trim() : token
    const value = values[name] || ''
    if (filter === 'cloze' || filter === 'cloze-only') return deletionSide(value, ordinal, side)
    return value
  })
  return plainText(deletionSide(rendered, ordinal, side))
}

const nativeSchedule = (value: unknown, fallbackDueAt: string) => {
  const source = record(value)
  if (source.strategy === 'neo-fsrs') return source
  const interval = Math.max(0, Number(source.intervalDays) || 0)
  const repetitions = Math.max(0, Math.trunc(Number(source.repetitions) || 0))
  const queue = source.queue === 'new' || source.queue === 'learn' || source.queue === 'review' || source.queue === 'relearn' || source.queue === 'preview'
    ? source.queue
    : repetitions ? 'review' : 'new'
  return {
    strategy: 'neo-fsrs',
    queue,
    dueAt: Number.isFinite(Date.parse(text(source.dueAt))) ? source.dueAt : fallbackDueAt,
    stability: Math.max(0, Number(source.stability) || interval),
    difficulty: Math.min(10, Math.max(0, Number(source.difficulty) || 5)),
    elapsedDays: interval,
    scheduledDays: interval,
    reps: repetitions,
    lapses: Math.max(0, Math.trunc(Number(source.lapses) || 0)),
    state: queue === 'new' ? 0 : queue === 'learn' ? 1 : queue === 'relearn' ? 3 : 2,
    ...(Number.isFinite(Date.parse(text(source.lastReviewAt))) ? { lastReviewAt: source.lastReviewAt } : {}),
  }
}

const materializeLegacyTemplates = (workspace: UnknownRecord) => {
  const noteTypes = list(workspace.noteTypes)
  const fields = list(workspace.fields)
  const templates = list(workspace.templates)
  const notes = list(workspace.notes)
  const cards = list(workspace.cards)
  const now = text(workspace.updatedAt) || new Date(0).toISOString()

  for (const noteType of noteTypes) {
    const typeId = text(noteType.id)
    const ownedFields = fields.filter((field) => text(field.noteTypeId) === typeId)
    const fieldNameById = new Map(ownedFields.map((field) => [text(field.id), text(field.name)]))
    const ownedNotes = notes.filter((note) => text(note.noteTypeId) === typeId)
    const ownedTemplates = templates.filter((template) => text(template.noteTypeId) === typeId)
    const legacyKind = noteType.kind === 'cloze'

    for (const template of ownedTemplates) {
      if (typeof template.promptFieldId === 'string' && typeof template.answerFieldId === 'string') continue
      const templateId = text(template.id)
      const matchingCards = cards.filter((card) => text(card.templateId) === templateId)
      const questionFormat = text(template.questionFormat) || '{{Front}}'
      const answerFormat = text(template.answerFormat) || '{{Back}}'
      const legacyTemplate = structuredClone(template)
      const ordinals = legacyKind
        ? [...new Set(matchingCards.map((card) => Math.max(1, Math.trunc(Number(card.clozeOrdinal) || Number(card.ordinal) + 1))))].sort((a, b) => a - b)
        : [0]
      if (!ordinals.length) ordinals.push(1)

      for (const [index, ordinal] of ordinals.entries()) {
        const suffix = ordinal ? `:deletion:${ordinal}` : ''
        const target = index === 0 ? template : { ...structuredClone(legacyTemplate), id: `${templateId}${suffix}`, ordinal: Number(template.ordinal) + index }
        if (index > 0) templates.push(target)
        const promptFieldId = `field:native-prompt:${templateId}${suffix}`
        const answerFieldId = `field:native-answer:${templateId}${suffix}`
        const labelSuffix = ordinals.length > 1 ? ` ${ordinal}` : ''
        const nextFieldOrdinal = fields.filter((field) => text(field.noteTypeId) === typeId).length
        fields.push(
          { id: promptFieldId, revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: `${text(template.name) || 'Card'} prompt${labelSuffix}`, ordinal: nextFieldOrdinal, rtl: false, sticky: false },
          { id: answerFieldId, revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: `${text(template.name) || 'Card'} answer${labelSuffix}`, ordinal: nextFieldOrdinal + 1, rtl: false, sticky: false },
        )
        target.promptFieldId = promptFieldId
        target.answerFieldId = answerFieldId
        target.supportingFieldIds = []
        target.responseMode = /{{\s*type:/i.test(text(template.questionFormat)) ? 'type' : 'reveal'
        delete target.questionFormat
        delete target.answerFormat
        delete target.browserQuestionFormat
        delete target.browserAnswerFormat

        for (const note of ownedNotes) {
          const noteFields = record(note.fields)
          const values = Object.fromEntries([...fieldNameById].map(([fieldId, name]) => [name, text(noteFields[fieldId])]))
          const prompt = renderLegacySide(questionFormat, values, 'prompt', ordinal || 1)
          const answer = renderLegacySide(answerFormat, values, 'answer', ordinal || 1, prompt)
          noteFields[promptFieldId] = prompt
          noteFields[answerFieldId] = answer
          note.fields = noteFields
        }
        for (const card of matchingCards) {
          const cardOrdinal = Math.max(1, Math.trunc(Number(card.clozeOrdinal) || Number(card.ordinal) + 1))
          if (!legacyKind || cardOrdinal === (ordinal || 1)) card.templateId = target.id
          if (legacyKind) card.deletionOrdinal = cardOrdinal
          delete card.clozeOrdinal
        }
      }
    }

    noteType.fieldIds = fields.filter((field) => text(field.noteTypeId) === typeId).sort((left, right) => Number(left.ordinal) - Number(right.ordinal)).map((field) => field.id)
    noteType.templateIds = templates.filter((template) => text(template.noteTypeId) === typeId).sort((left, right) => Number(left.ordinal) - Number(right.ordinal)).map((template) => template.id)
    noteType.kind = legacyKind ? 'deletion' : 'standard'
    delete noteType.css
  }
  workspace.fields = fields
  workspace.templates = templates
}

export const normalizeImportedWorkspaceDocument = <T>(input: T): T => {
  const output = structuredClone(input) as unknown as UnknownRecord
  const workspace = record(output.workspace)
  if (!Object.keys(workspace).length) return output as T
  materializeLegacyTemplates(workspace)
  const fallbackDueAt = text(workspace.updatedAt) || new Date(0).toISOString()
  for (const preset of list(workspace.presets)) delete preset.scheduler
  for (const card of list(workspace.cards)) {
    card.scheduling = nativeSchedule(card.scheduling, fallbackDueAt)
    if (card.filteredDeck) {
      const filtered = record(card.filteredDeck)
      if (typeof filtered.originalDeckId === 'string') card.deckId = filtered.originalDeckId
      delete card.filteredDeck
    }
  }
  for (const review of list(workspace.reviews)) {
    if (review.previousScheduling) review.previousScheduling = nativeSchedule(review.previousScheduling, text(review.reviewedAt) || fallbackDueAt)
    if (review.nextScheduling) review.nextScheduling = nativeSchedule(review.nextScheduling, text(review.reviewedAt) || fallbackDueAt)
    delete review.scheduler
  }
  output.workspace = workspace
  return output as T
}
