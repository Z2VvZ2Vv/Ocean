function pythonWorker() {
  const indexURL = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/'
  self.onmessage = async ({ data: code }) => {
    let output = ''
    const append = value => {
      if (output.length < 12000) output += value.slice(0, 12000 - output.length) + '\n'
    }
    try {
      importScripts(indexURL + 'pyodide.js')
      const python = await loadPyodide({ indexURL })
      python.setStdout({ batched: append })
      python.setStderr({ batched: append })
      const result = await python.runPythonAsync(code)
      if (result !== undefined) append(String(result))
      result?.destroy?.()
      self.postMessage({ output: output.trimEnd() || 'Exécution terminée, sans sortie.' })
    } catch (error) {
      self.postMessage({ error: String(error).slice(0, 3000), output: output.trimEnd() })
    }
  }
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.ports.length !== 1 || typeof event.data?.code !== 'string') return
  const port = event.ports[0]
  const url = URL.createObjectURL(new Blob([`(${pythonWorker.toString()})();`], { type: 'text/javascript' }))
  try {
    const worker = new Worker(url)
    worker.onmessage = ({ data }) => {
      port.postMessage(data)
      worker.terminate()
    }
    worker.onerror = () => {
      port.postMessage({ error: 'Impossible de démarrer le moteur Python.' })
      worker.terminate()
    }
    worker.postMessage(event.data.code)
  } catch {
    port.postMessage({ error: 'Le navigateur a bloqué le moteur Python.' })
  } finally {
    URL.revokeObjectURL(url)
  }
}, { once: true })
