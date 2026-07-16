#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { createExtensionPackage, EXTENSION_PACKAGE_SUFFIX, validateExtensionPackageManifest } from '../dist/index.js'

const cwd = resolve(process.argv[3] || process.cwd())
const command = process.argv[2] || 'help'

const reactHostPlugin = {
  name: 'neo-anki-react-host',
  setup(buildApi) {
    const host = {
      react: 'neoanki://app/extension-host/react.js',
      'react/jsx-runtime': 'neoanki://app/extension-host/jsx-runtime.js',
      'react/jsx-dev-runtime': 'neoanki://app/extension-host/jsx-dev-runtime.js',
    }
    buildApi.onResolve({ filter: /^react(?:\/jsx-(?:dev-)?runtime)?$/ }, (args) => ({ path: host[args.path], external: true }))
  },
}

const readProject = async () => {
  const manifest = validateExtensionPackageManifest(JSON.parse(await readFile(join(cwd, 'manifest.json'), 'utf8')))
  const packageJson = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'))
  const source = resolve(cwd, packageJson.neoAnki?.entry || (existsSync(join(cwd, 'src/index.tsx')) ? 'src/index.tsx' : 'src/index.ts'))
  if (!existsSync(source)) throw new Error(`Extension source entry does not exist: ${source}`)
  return { manifest, source }
}

const compile = async () => {
  const project = await readProject()
  const result = await build({
    entryPoints: [project.source],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    minify: false,
    sourcemap: false,
    outfile: 'index.js',
    write: false,
    plugins: [reactHostPlugin],
    logLevel: 'silent',
  })
  const module = result.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
  if (!module) throw new Error('The extension compiler did not produce a JavaScript module.')
  return { ...project, module }
}

const run = async () => {
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write('Usage: neo-anki-extension <check|build> [extension-directory]\n')
    return
  }
  if (!['check', 'build'].includes(command)) throw new Error(`Unknown command: ${command}`)
  const compiled = await compile()
  const files = { [compiled.manifest.entry]: compiled.module }
  const readme = join(cwd, 'README.md')
  if (existsSync(readme)) files['README.md'] = await readFile(readme)
  const archive = createExtensionPackage(compiled.manifest, files)
  if (command === 'check') {
    process.stdout.write(`✓ ${compiled.manifest.id} v${compiled.manifest.version} is valid (${Math.ceil(archive.byteLength / 1024)} KB)\n`)
    return
  }
  const outputDirectory = join(cwd, 'build')
  await mkdir(outputDirectory, { recursive: true })
  const output = join(outputDirectory, `${compiled.manifest.id}-${compiled.manifest.version}${EXTENSION_PACKAGE_SUFFIX}`)
  await writeFile(output, archive)
  process.stdout.write(`✓ Built ${basename(output)} (${Math.ceil(archive.byteLength / 1024)} KB)\n${output}\n`)
}

run().catch((error) => {
  process.stderr.write(`Extension build failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
