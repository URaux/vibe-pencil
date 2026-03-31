'use client'

import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface ChatMarkdownProps {
  content: string
}

export const ChatMarkdown = memo(function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children }) {
          return (
            <pre className="my-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              {children}
            </pre>
          )
        },
        code({ children, className }) {
          // Inline code — no language class means no block context
          if (!className) {
            return (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm text-slate-800 font-mono">
                {children}
              </code>
            )
          }
          // Block code — inside <pre>, inherit highlight.js styles
          return <code className={className}>{children}</code>
        },
        p({ children }) {
          return <p className="my-1.5 leading-relaxed">{children}</p>
        },
        ul({ children }) {
          return <ul className="my-1.5 list-disc pl-5">{children}</ul>
        },
        ol({ children }) {
          return <ol className="my-1.5 list-decimal pl-5">{children}</ol>
        },
        li({ children }) {
          return <li className="my-0.5">{children}</li>
        },
        h1({ children }) {
          return <h1 className="my-2 text-base font-bold">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="my-2 text-sm font-bold">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="my-1.5 text-sm font-semibold">{children}</h3>
        },
        h4({ children }) {
          return <h4 className="my-1.5 text-sm font-semibold">{children}</h4>
        },
        h5({ children }) {
          return <h5 className="my-1.5 text-sm font-semibold">{children}</h5>
        },
        h6({ children }) {
          return <h6 className="my-1.5 text-sm font-semibold">{children}</h6>
        },
        table({ children }) {
          return (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          )
        },
        th({ children }) {
          return (
            <th className="border border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold">
              {children}
            </th>
          )
        },
        td({ children }) {
          return (
            <td className="border border-slate-200 px-2 py-1 text-xs">
              {children}
            </td>
          )
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-1.5 border-l-2 border-slate-300 pl-3 italic text-slate-500">
              {children}
            </blockquote>
          )
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              className="text-blue-600 underline hover:text-blue-800"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
})
