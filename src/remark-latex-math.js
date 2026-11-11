import remarkMath from 'remark-math'

// Recognize TeX delimiters before CommonMark treats them as escaped punctuation.
// A syntax extension also leaves inline code, fenced code and link URLs literal.
export default function remarkLatexMath(options) {
  remarkMath.call(this, options)
  const data = this.data()
  data.micromarkExtensions.push({
    text: { 92: { name: 'latexMath', tokenize: tokenizeLatexMath } },
  })
  data.fromMarkdownExtensions.push({
    enter: {
      latexMath(token) {
        const display = this.sliceSerialize(token).startsWith('\\[')
        this.enter({
          type: 'inlineMath', value: '',
          data: {
            hName: 'code',
            hProperties: { className: ['language-math', display ? 'math-display' : 'math-inline'] },
            hChildren: [],
          },
        }, token)
        this.buffer()
      },
    },
    exit: {
      latexMathData(token) {
        this.config.enter.data.call(this, token)
        this.config.exit.data.call(this, token)
      },
      latexMath(token) {
        const value = this.resume()
        const node = this.stack.at(-1)
        node.value = value.slice(0, -2).trim()
        node.data.hChildren.push({ type: 'text', value: node.value })
        this.exit(token)
      },
    },
  })
}

function tokenizeLatexMath(effects, ok, nok) {
  let closing
  return start

  function start(code) {
    effects.enter('latexMath')
    effects.enter('latexMathMarker')
    effects.consume(code)
    return opening
  }

  function opening(code) {
    if (code !== 40 && code !== 91) return nok(code)
    closing = code === 40 ? 41 : 93
    effects.consume(code)
    effects.exit('latexMathMarker')
    return content
  }

  function content(code) {
    if (code === null) return nok(code)
    if (code < -2) {
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      return content
    }
    effects.enter('latexMathData')
    return mathData(code)
  }

  function mathData(code) {
    if (code === null || code < -2) {
      effects.exit('latexMathData')
      return content(code)
    }
    effects.consume(code)
    return code === 92 ? afterBackslash : mathData
  }

  function afterBackslash(code) {
    // Another opening delimiter means the original formula was incomplete.
    if (code === 40 || code === 91) return nok(code)
    if (code === null || code < -2) {
      effects.exit('latexMathData')
      return content(code)
    }
    effects.consume(code)
    if (code === closing) {
      effects.exit('latexMathData')
      effects.exit('latexMath')
      return ok
    }
    return mathData
  }
}
