// Builds the static export (`out/`) for the portable edition: sets NEXT_OUTPUT=export, then runs `next build`.
// Plain Node so it behaves the same on Windows and Linux (no `VAR=x cmd` / `set VAR=x&&` shell syntax).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Run next's own entry point with the current node: no shell, no .cmd shim, no PATH lookup.
const nextBin = require.resolve('next/dist/bin/next')

const child = spawn(process.execPath, [nextBin, 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_OUTPUT: 'export' },
})

child.on('error', (err) => {
  console.error(err)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
