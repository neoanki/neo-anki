import type { HTMLAttributes, ReactNode } from 'react'

export const ExtensionPage = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div className="page neo-ext-page" {...props}>{children}</div>

export const ExtensionHeader = ({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) => <header className="page-header neo-ext-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-intro">{description}</p>}</div></header>

export const ExtensionMetricGrid = ({ children, label }: { children: ReactNode; label: string }) => <section className="neo-ext-metric-grid" aria-label={label}>{children}</section>

export const ExtensionMetric = ({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) => <article className="neo-ext-metric"><span>{label}</span><strong>{value}</strong>{detail && <p>{detail}</p>}</article>

export const ExtensionSection = ({ title, children }: { title: string; children: ReactNode }) => <section className="neo-ext-section"><h2>{title}</h2>{children}</section>

export const ExtensionNotice = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'danger' }) => <p className={`neo-ext-notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>{children}</p>
