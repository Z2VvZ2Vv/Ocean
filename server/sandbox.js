import { Sandbox } from '@vercel/sandbox'
import { artifactBytes, artifactLimit, artifactType, codeLanguage } from '../src/code.js'

const pythonEntry = `
import runpy
import sys
from pathlib import Path

runpy.run_path('main.py', run_name='__main__')
plt = sys.modules.get('matplotlib.pyplot')
if plt and not any(Path('.').glob('*.png')) and not any(Path('artifacts').glob('*.png')):
    for i, figure in enumerate(plt.get_fignums()[:3], start=1):
        plt.figure(figure).savefig(f'artifacts/graphique-{i}.png', dpi=110)
`

const programs = {
  python: { run: ['python3', '-c', pythonEntry] },
  javascript: { run: ['node', 'main.mjs'] },
  typescript: { run: ['node', '--experimental-transform-types', 'main.ts'] },
  c: { package: 'gcc', build: ['gcc', '-std=c17', 'main.c', '-o', 'program', '-lm'], run: ['./program'] },
  cpp: { package: 'g++', build: ['g++', '-std=c++20', 'main.cpp', '-o', 'program'], run: ['./program'] },
  csharp: { package: 'mono-mcs', build: ['mcs', 'Program.cs', '-out:Program.exe'], run: ['mono', 'Program.exe'] },
  java: { package: 'default-jdk-headless', run: ['java', 'Main.java'] },
  go: { package: 'golang-go', build: ['go', 'build', '-o', 'program', 'main.go'], run: ['./program'] },
  rust: { package: 'rustc', build: ['rustc', 'main.rs', '-o', 'program'], run: ['./program'] },
  ruby: { package: 'ruby', run: ['ruby', 'main.rb'] },
  php: { package: 'php-cli', run: ['php', 'main.php'] },
  bash: { run: ['bash', 'main.sh'] },
}

async function readBounded(sandbox, path, limit, signal) {
  const stream = await sandbox.readFile({ path }, { signal })
  if (!stream) return { bytes: Buffer.alloc(0), truncated: false }
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk)
    chunks.push(bytes.subarray(0, limit - size))
    size += bytes.length
    if (size > limit) break
  }
  return { bytes: Buffer.concat(chunks), truncated: size > limit }
}

async function stage(sandbox, command, stdinPath, outputPath, { timeoutMs, fileLimit, signal }) {
  const process = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-c', 'output=$1; ulimit -f "$2"; shift 2; exec "$@" < "$0" > "$output" 2>&1', stdinPath, outputPath, String(fileLimit), ...command],
    env: { OCEAN_OUTPUT_DIR: 'artifacts', GOTOOLCHAIN: 'local', PYTHONPATH: '.ocean-deps', MPLBACKEND: 'Agg' }, timeoutMs, signal,
  })
  const { bytes, truncated } = await readBounded(sandbox, outputPath, 12000, signal)
  return { exitCode: process.exitCode, output: bytes.toString('utf8') + (truncated ? '\n… (sortie tronquée)' : '') }
}

async function collectArtifacts(sandbox, language, signal) {
  const folders = language === 'python' ? ['artifacts', '.'] : ['artifacts']
  const listing = await sandbox.runCommand({
    cmd: 'bash', args: ['-c', 'find "$@" -maxdepth 1 -type f -print0 | head -c 16384 > .ocean-files', 'ocean', ...folders],
    timeoutMs: 2000, signal,
  })
  if (listing.exitCode !== 0) return []
  const { bytes } = await readBounded(sandbox, '.ocean-files', 16384, signal)
  const paths = bytes.toString('utf8').split('\0').filter(path => {
    const [directory, name, ...rest] = path.split('/')
    return folders.includes(directory) && !rest.length && artifactType(name)
  })
  const files = []
  for (const path of paths.slice(0, 12)) {
    const file = await readBounded(sandbox, path, artifactBytes, signal)
    if (!file.truncated && file.bytes.length) files.push({ name: path.split('/')[1], data: file.bytes.toString('base64') })
    if (files.length === artifactLimit) break
  }
  return files
}

export async function runSandboxCode({ language, code, stdin, packages = [] }, signal, createSandbox = options => Sandbox.create(options)) {
  const program = programs[language]
  const target = codeLanguage(language)
  if (!program || !target) throw new Error('Langage indisponible dans la sandbox.')
  const networkPolicy = packages.length ? { allow: ['pypi.org', 'files.pythonhosted.org'] } : program.package ? 'allow-all' : 'deny-all'
  const sandbox = await createSandbox({
    persistent: false, timeout: 100000, resources: { vcpus: 1 },
    networkPolicy, signal,
  })
  try {
    if (program.package) {
      const command = (program.build || program.run)[0]
      const setup = await sandbox.runCommand({
        cmd: 'bash', args: ['-c', 'command -v "$1" >/dev/null || (apt-get update -qq && apt-get install -y --no-install-recommends "$2")', 'ocean', command, program.package],
        sudo: true, env: { DEBIAN_FRONTEND: 'noninteractive' }, timeoutMs: 65000, signal,
      })
      if (setup.exitCode !== 0) return { error: `Impossible de préparer ${target.label} dans la sandbox.` }
    }
    if (packages.length) {
      const install = await sandbox.runCommand({
        cmd: 'python3', args: ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--only-binary=:all:',
          '--index-url', 'https://pypi.org/simple', '--target', '.ocean-deps', '--', ...packages],
        env: { PIP_CONFIG_FILE: '/dev/null' }, timeoutMs: 65000, signal,
      })
      if (install.exitCode !== 0) return {
        error: 'Impossible d’installer les paquets Python demandés. Vérifie leurs noms et versions.',
        output: (await install.stderr()).slice(-3000),
      }
    }
    if (networkPolicy !== 'deny-all') await sandbox.update({ networkPolicy: 'deny-all' }, { signal })

    const javaClass = language === 'java' && code.match(/\bpublic\s+(?:(?:final|abstract)\s+)?class\s+([A-Za-z_$][\w$]*)/)
    const file = javaClass ? `${javaClass[1]}.java` : language === 'javascript' ? 'main.mjs' : target.file
    await sandbox.runCommand({ cmd: 'mkdir', args: ['-p', 'artifacts'], timeoutMs: 2000, signal })
    await sandbox.writeFiles([{ path: file, content: code }, { path: '.ocean-stdin', content: stdin }], { signal })

    const build = program.build && await stage(sandbox, program.build, '/dev/null', '.ocean-compile', { timeoutMs: 20000, fileLimit: 16384, signal })
    if (build && build.exitCode !== 0) return { output: build.output, error: 'Échec de la compilation.' }

    const command = javaClass ? ['java', file] : program.run
    const run = await stage(sandbox, command, '.ocean-stdin', '.ocean-output', { timeoutMs: 8000, fileLimit: 2048, signal })
    const artifacts = await collectArtifacts(sandbox, language, signal)
    const output = [build?.output, run.output].filter(Boolean).join('\n').slice(0, 12000)
    return { output, artifacts, ...(run.exitCode !== 0 && { error: `Le programme s’est arrêté (code ${run.exitCode}).` }) }
  } finally {
    await sandbox.delete({ signal: AbortSignal.timeout(5000) }).catch(() => {})
  }
}
