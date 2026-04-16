'use client'

/**
 * OptionCards preview page — exercises every variant of <OptionCards/> with
 * local React state, no ChatPanel / chatSessions store dependency.
 *
 * Notes on the real component contract (see src/components/OptionCards.tsx):
 *   - Options must be { number: string; text: string } — we synthesize
 *     numbered labels (A/B/C/1/2/3) from plain string arrays below.
 *   - Single-select uses `onSelect(text)`. Multi-select uses
 *     `onSubmitMulti({ selections, ordered })`. Both callbacks are declared
 *     separately, but OptionCards decides which to call based on `multi` /
 *     `ordered` flags, so we wire both to a single `record(variant, payload)`
 *     helper.
 *   - `ordered` implies `multi` inside the component.
 *   - Component reads `locale` from useAppStore — that works fine standalone;
 *     no chat-session state is required.
 *   - `allowCustom` defaults to truthy for single-select (the input renders
 *     unless explicitly `allowCustom === false`), so "plain radio" variants
 *     below pass `allowCustom={false}` to keep them pure.
 */

import { useState } from 'react'
import { OptionCards, type MultiSubmission } from '@/components/OptionCards'

type Option = { number: string; text: string }

function numbered(texts: string[], style: 'alpha' | 'digit' = 'digit'): Option[] {
  return texts.map((text, i) => ({
    number: style === 'alpha' ? String.fromCharCode(65 + i) : String(i + 1),
    text,
  }))
}

type Submission =
  | { kind: 'single'; text: string }
  | { kind: 'multi'; payload: MultiSubmission }

function JsonDisplay({ value }: { value: Submission | null }) {
  return (
    <pre className="mt-3 rounded-lg bg-slate-900 text-slate-100 text-xs p-3 overflow-x-auto">
      {value ? JSON.stringify(value, null, 2) : '// no submission yet'}
    </pre>
  )
}

function Section({
  index,
  title,
  description,
  children,
  submission,
}: {
  index: number
  title: string
  description: string
  children: React.ReactNode
  submission: Submission | null
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-2">
        <h2 className="text-lg font-semibold text-slate-900">
          {index}. {title}
        </h2>
        <p className="text-sm text-slate-500">{description}</p>
      </header>
      <div className="max-w-xl">{children}</div>
      <JsonDisplay value={submission} />
    </section>
  )
}

export default function OptionCardsPreviewPage() {
  const [s1, setS1] = useState<Submission | null>(null)
  const [s2, setS2] = useState<Submission | null>(null)
  const [s3, setS3] = useState<Submission | null>(null)
  const [s4, setS4] = useState<Submission | null>(null)
  const [s5, setS5] = useState<Submission | null>(null)
  const [s6, setS6] = useState<Submission | null>(null)
  const [s7, setS7] = useState<Submission | null>(null)
  const [s8, setS8] = useState<Submission | null>(null)

  const singleOpts = numbered(['A', 'B', 'C'], 'alpha')
  const flowOpts = numbered([
    '浏览商品',
    '购物车',
    '下单支付',
    '订单跟踪',
    '评价',
    '推荐',
  ])
  const priorityOpts = numbered(['用户体验', '开发速度', '成本', '可扩展性'])
  const featureOpts = numbered(['核心功能A', '核心功能B', '核心功能C', '核心功能D'])

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 p-6 text-white shadow">
          <h1 className="text-2xl font-bold">OptionCards Preview</h1>
          <p className="mt-1 text-sm opacity-90">
            brainstorm v2 variants (client-only, no server)
          </p>
        </div>

        <Section
          index={1}
          title="Single-select radio"
          description="Simple options. Click submits immediately via onSelect."
          submission={s1}
        >
          <OptionCards
            options={singleOpts}
            allowCustom={false}
            onSelect={(text) => setS1({ kind: 'single', text })}
          />
        </Section>

        <Section
          index={2}
          title="Single-select + allowIndifferent"
          description='"无所谓" appended at bottom; clicking it submits as normal onSelect.'
          submission={s2}
        >
          <OptionCards
            options={singleOpts}
            allowCustom={false}
            allowIndifferent
            onSelect={(text) => setS2({ kind: 'single', text })}
          />
        </Section>

        <Section
          index={3}
          title="Single-select + allowCustom"
          description="Text input appended; typing + Enter submits the custom text via onSelect."
          submission={s3}
        >
          <OptionCards
            options={singleOpts}
            allowCustom
            onSelect={(text) => setS3({ kind: 'single', text })}
          />
        </Section>

        <Section
          index={4}
          title="Multi-select checkboxes (min=3, max=5)"
          description="Submit button disabled under 3 or when empty; hard-capped at 5 picks."
          submission={s4}
        >
          <OptionCards
            options={flowOpts}
            multi
            min={3}
            max={5}
            onSelect={() => {}}
            onSubmitMulti={(payload) => setS4({ kind: 'multi', payload })}
          />
        </Section>

        <Section
          index={5}
          title="Multi-select + ordered"
          description="Ranked picks show ①②③④ in pick order. Deselect and the remaining ranks renumber."
          submission={s5}
        >
          <OptionCards
            options={priorityOpts}
            multi
            ordered
            onSelect={() => {}}
            onSubmitMulti={(payload) => setS5({ kind: 'multi', payload })}
          />
        </Section>

        <Section
          index={6}
          title="Multi-select + allowCustom"
          description="Custom typed entry coexists with checked options; it is appended to selections on submit."
          submission={s6}
        >
          <OptionCards
            options={featureOpts}
            multi
            allowCustom
            onSelect={() => {}}
            onSubmitMulti={(payload) => setS6({ kind: 'multi', payload })}
          />
        </Section>

        <Section
          index={7}
          title='Multi-select + allowIndifferent'
          description='"无所谓" is mutually exclusive — picking it clears others; picking any option clears it.'
          submission={s7}
        >
          <OptionCards
            options={featureOpts}
            multi
            allowIndifferent
            onSelect={() => {}}
            onSubmitMulti={(payload) => setS7({ kind: 'multi', payload })}
          />
        </Section>

        <Section
          index={8}
          title="Multi + ordered + allowCustom + allowIndifferent"
          description="All flags on — edge case combining rank badges, custom entry, and indifferent mutual-exclusion."
          submission={s8}
        >
          <OptionCards
            options={priorityOpts}
            multi
            ordered
            allowCustom
            allowIndifferent
            onSelect={() => {}}
            onSubmitMulti={(payload) => setS8({ kind: 'multi', payload })}
          />
        </Section>
      </div>
    </main>
  )
}
