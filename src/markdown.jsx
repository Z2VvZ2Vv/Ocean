import { Children, createContext, createElement, lazy, memo, Suspense, useContext } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'

const CodeBlock = lazy(() => import('./code-block.jsx'))
const Diagram = lazy(() => import('./diagram.jsx'))

const Rendering = createContext({})

function FlowText({ tag, children, ...props }) {
  const { generating } = useContext(Rendering)
  const content = generating ? Children.map(children, (child, index) => {
    if (typeof child !== 'string') return child
    return (child.match(/(?:\S+\s*){1,3}|\s+/gu) || []).map((words, position) => (
      <span className="stream-fragment" key={`${index}-${position}`}>{words}</span>
    ))
  }) : children
  return createElement(tag, props, content)
}

function Fence({ node, children }) {
  const { generating, sandboxEnabled, theme } = useContext(Rendering)
  const code = node.children[0]
  if (code?.tagName !== 'code') return <pre>{children}</pre>
  const tag = code.properties.className?.find(name => name.startsWith('language-'))
  const language = tag?.slice('language-'.length).toLowerCase() || ''
  const source = code.children.map(part => part.value || '').join('').replace(/\n$/, '')
  return <Suspense fallback={<pre>{children}</pre>}>
    {language === 'mermaid' && !generating ? <Diagram source={source} theme={theme} />
      : <CodeBlock source={source} language={language} generating={generating} sandboxEnabled={sandboxEnabled} />}
  </Suspense>
}

const components = {
  pre: Fence,
  p: ({ node, ...props }) => <FlowText tag="p" {...props} />,
  li: ({ node, ...props }) => <FlowText tag="li" {...props} />,
  h1: ({ node, ...props }) => <FlowText tag="h1" {...props} />,
  h2: ({ node, ...props }) => <FlowText tag="h2" {...props} />,
  h3: ({ node, ...props }) => <FlowText tag="h3" {...props} />,
  strong: ({ node, ...props }) => <FlowText tag="strong" {...props} />,
  em: ({ node, ...props }) => <FlowText tag="em" {...props} />,
  img: ({ alt }) => <span>{alt}</span>,
  a: ({ href, children }) => /^https?:\/\//i.test(href || '') ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>,
}

export default memo(function Markdown({ text, generating, sandboxEnabled, theme }) {
  return <Rendering.Provider value={{ generating, sandboxEnabled, theme }}>
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
      {text}
    </ReactMarkdown>
  </Rendering.Provider>
})
