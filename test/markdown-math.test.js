import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from '../src/remark-latex-math.js'

function render(text) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex],
  }, text))
}

test('les formules du tableau de récapitulatif sont rendues avec KaTeX', () => {
  const html = render(String.raw`| Cas | Champ électrique en \(O\) | Potentiel en \(O\) |
| --- | ---: | ---: |
| Cas 1 | \(\vec E_O=\vec 0\) | \(V(O)=\dfrac{8kq}{a}\) |
| Cas 2 | \(\vec E_O=\vec 0\) | \(V(O)=0\) |
| Cas 3 | \(\vec E_O=\dfrac{8\sqrt{2}kq}{a^2}\vec e_x\) | \(V(O)=0\) |`)
  assert.equal((html.match(/<th(?: |>|\n)/g) || []).length, 3)
  assert.equal((html.match(/<td(?: |>|\n)/g) || []).length, 9)
  assert.equal((html.match(/class="katex"/g) || []).length, 8)
  assert.match(html, /<mfrac>/)
  assert.match(html, /<msqrt>/)
  assert.doesNotMatch(html, /katex-error/)
})

test('les quatre délimiteurs fonctionnent dans les paragraphes et tableaux', () => {
  const html = render(String.raw`Inline \(x_1\) et $x_2$.

\[
\frac{U}{d}
\]

$$
E=mc^2
$$

| Inline | Bloc |
| --- | --- |
| $x_3$ | \[x_4\] |`)
  assert.equal((html.match(/class="katex"/g) || []).length, 6)
  assert.equal((html.match(/class="katex-display"/g) || []).length, 3)
  assert.doesNotMatch(html, /katex-error/)
})

test('les délimiteurs restent littéraux dans le code et les destinations de lien', () => {
  const html = render('`\\(x_1\\)` et `\\[x_2\\]`\n\n```text\n\\(x_3\\)\n\\[x_4\\]\n```\n\n[Source](https://example.test/\\(x\\))')
  assert.match(html, /<code>\\\(x_1\\\)<\/code>/)
  assert.match(html, /<code>\\\[x_2\\\]<\/code>/)
  assert.match(html, /<pre><code class="language-text">\\\(x_3\\\)\n\\\[x_4\\\]/)
  assert.match(html, /href="https:\/\/example.test\/\(x\)"/)
  assert.doesNotMatch(html, /class="katex"/)
})

test('les délimiteurs échappés, incomplets ou dépareillés ne deviennent pas des formules', () => {
  const html = render(String.raw`Littéral \\(x\\), incomplet \(y et dépareillé \[z\).`)
  assert.doesNotMatch(html, /class="katex"/)
  assert.match(html, /Littéral \\\(x\\\), incomplet \(y et dépareillé \[z\)\./)
})

test('le contenu mathématique est protégé des transformations Markdown', () => {
  const html = render(String.raw`**Champ \(E_0=\vec e_x\)** et \(\text{prix : \$5}\).`)
  assert.equal((html.match(/class="katex"/g) || []).length, 2)
  assert.match(html, /<strong>Champ <span class="katex">/)
  assert.match(html, /prix/)
  assert.doesNotMatch(html, /<em>|katex-error/)
})

test('les formules sur plusieurs lignes ignorent les préfixes de citation et de liste', () => {
  const html = render(String.raw`> \[
> \frac{U}{d}
> \]

- Champ \(E_0 =
  \vec e_x\).`)
  assert.equal((html.match(/class="katex"/g) || []).length, 2)
  assert.match(html, /<annotation encoding="application\/x-tex">\\frac\{U\}\{d\}<\/annotation>/)
  assert.match(html, /<blockquote>/)
  assert.match(html, /<li>/)
  assert.doesNotMatch(html, /katex-error/)
})
