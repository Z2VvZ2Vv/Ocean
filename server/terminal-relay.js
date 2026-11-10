// Frame output as complete log lines so prompts without a newline arrive immediately.
export const relaySource = String.raw`
const { spawn } = require('node:child_process')
const { StringDecoder } = require('node:string_decoder')
const child = spawn('stdbuf', ['-o0', '-e0', 'timeout', '--kill-after=1s', '60s', ...process.argv.slice(1)])
const stdout = new StringDecoder('utf8')
const stderr = new StringDecoder('utf8')
let remaining = 12000
let truncated = false

function send(output) {
  if (output) process.stdout.write(JSON.stringify({ output }) + '\n')
}

function relay(chunk, decoder) {
  const length = Math.min(remaining, chunk.length)
  remaining -= length
  send(decoder.write(chunk.subarray(0, length)))
  if (length < chunk.length && !truncated) {
    truncated = true
    send('\n… (sortie tronquée)\n')
  }
}

child.stdout.on('data', chunk => relay(chunk, stdout))
child.stderr.on('data', chunk => relay(chunk, stderr))
child.stdin.on('error', () => {})
process.stdin.pipe(child.stdin)
child.on('error', error => send(error.message + '\n'))
child.on('close', (code, signal) => {
  if (!truncated) send(stdout.end() + stderr.end())
  process.stdin.destroy()
  process.exitCode = code ?? (signal ? 137 : 1)
})
`
