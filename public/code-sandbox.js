function pythonWorker() {
  const indexURL = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/'
  const folder = '/mnt/data'

  function collectFiles(python) {
    const fs = python.FS
    const files = []
    for (const name of fs.readdir(folder)) {
      if (!/\.(png|jpe?g|webp|csv|txt|json)$/i.test(name)) continue
      const path = `${folder}/${name}`
      const info = fs.lstat(path)
      if (!fs.isFile(info.mode) || info.size < 1 || info.size > 750000) continue
      const data = fs.readFile(path)
      let binary = ''
      for (let offset = 0; offset < data.length; offset += 16384) {
        binary += String.fromCharCode(...data.subarray(offset, offset + 16384))
      }
      files.push({ name, data: btoa(binary) })
      if (files.length === 3) break
    }
    return files
  }

  self.onmessage = async ({ data: { code, stdin, files } }) => {
    let output = ''
    const append = value => {
      if (output.length < 12000) output += value.slice(0, 12000 - output.length) + '\n'
    }
    try {
      importScripts(indexURL + 'pyodide.js')
      const python = await loadPyodide({ indexURL })
      python.setStdout({ batched: append })
      python.setStderr({ batched: append })
      const lines = stdin ? stdin.replace(/\r?\n$/, '').split(/\r?\n/) : []
      python.setStdin({ stdin: () => lines.shift() ?? null })
      python.FS.mkdirTree(folder)
      python.FS.chdir(folder)
      if (files.length) {
        python.FS.mkdirTree(`${folder}/attachments`)
        for (const { name, blob } of files) {
          python.FS.writeFile(`${folder}/attachments/${name}`, new Uint8Array(await blob.arrayBuffer()))
        }
      }
      python.runPython('import os; os.environ["MPLBACKEND"] = "Agg"')
      await python.loadPackagesFromImports(code)
      const result = await python.runPythonAsync(code)
      if (result !== undefined) append(String(result))
      result?.destroy?.()
      if (python.loadedPackages.matplotlib && !python.FS.readdir(folder).some(name => /\.png$/i.test(name))) {
        python.runPython(`
import sys as _ocean_sys
_ocean_plt = _ocean_sys.modules.get('matplotlib.pyplot')
if _ocean_plt:
    for _ocean_i, _ocean_fig in enumerate(_ocean_plt.get_fignums()[:3], start=1):
        _ocean_plt.figure(_ocean_fig).savefig(f'/mnt/data/graphique-{_ocean_i}.png', dpi=110)
`)
      }
      self.postMessage({ output: output.trimEnd(), artifacts: collectFiles(python) })
    } catch (error) {
      self.postMessage({ error: String(error).slice(0, 3000), output: output.trimEnd() })
    }
  }
}

function javascriptWorker() {
  const send = self.postMessage.bind(self)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  self.onmessage = async ({ data: { code, stdin } }) => {
    let output = ''
    const lines = stdin ? stdin.replace(/\r?\n$/, '').split(/\r?\n/) : []
    const readLine = () => lines.shift() ?? null
    const format = value => {
      if (typeof value === 'string') return value
      try { return JSON.stringify(value) ?? String(value) }
      catch { return String(value) }
    }
    const log = (...values) => {
      for (const value of values) {
        if (output.length >= 12000) break
        output += format(value).slice(0, 12000 - output.length) + ' '
      }
      if (output.length < 12000) output = output.trimEnd() + '\n'
    }
    const console = { log, info: log, warn: log, error: log, debug: log, dir: log, table: log }
    try {
      const result = await new AsyncFunction('console', 'readLine', `"use strict";\n${code}`)(console, readLine)
      if (result !== undefined) log(result)
      send({ output: output.trimEnd() })
    } catch (error) {
      send({ error: String(error).slice(0, 3000), output: output.trimEnd() })
    }
  }
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.ports.length !== 1 || typeof event.data?.code !== 'string') return
  const port = event.ports[0]
  const source = document.documentElement.dataset.language === 'javascript' ? javascriptWorker : pythonWorker
  const url = URL.createObjectURL(new Blob([`(${source.toString()})();`], { type: 'text/javascript' }))
  try {
    const worker = new Worker(url)
    worker.onmessage = ({ data }) => {
      port.postMessage(data)
      worker.terminate()
    }
    worker.onerror = () => {
      port.postMessage({ error: 'Impossible de démarrer le moteur de code.' })
      worker.terminate()
    }
    worker.postMessage({ code: event.data.code, stdin: event.data.stdin || '', files: event.data.files || [] })
  } catch {
    port.postMessage({ error: 'Le navigateur a bloqué le moteur de code.' })
  } finally {
    URL.revokeObjectURL(url)
  }
}, { once: true })
