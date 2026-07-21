#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { build } from 'esbuild'
import { createExtensionPackage, EXTENSION_PACKAGE_SUFFIX, EXTENSION_SIGNATURE_PATH, validateExtensionPackageManifest } from '../dist/index.js'

const cwd = resolve(process.argv[3] || process.cwd())
const command = process.argv[2] || 'help'
const browserNodeShimPlugin = {
  name: 'neo-anki-browser-node-shims',
  setup(context) {
    context.onResolve({ filter: /^node:(?:crypto|fs)$/ }, ({ path }) => ({ path, namespace: 'neo-anki-browser-node-shim' }))
    context.onLoad({ filter: /.*/, namespace: 'neo-anki-browser-node-shim' }, ({ path }) => ({
      loader: 'js',
      contents: path === 'node:crypto'
        ? "export const randomFillSync = (value) => globalThis.crypto.getRandomValues(value); export default { randomFillSync }"
        : "const unavailable = () => { throw new Error('Node filesystem APIs are unavailable in Neo Anki extensions.') }; export default new Proxy({}, { get: () => unavailable })",
    }))
  },
}

const readProject = async () => {
  const manifest = validateExtensionPackageManifest(JSON.parse(await readFile(join(cwd, 'manifest.json'), 'utf8')))
  const packageJson = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'))
  const entries = []
  if (manifest.workerEntry) entries.push({ packagePath: manifest.workerEntry, source: resolve(cwd, packageJson.neoAnki?.workerEntry || 'src/worker.ts') })
  for (const ui of manifest.uiEntries || []) entries.push({ packagePath: ui.entry, source: resolve(cwd, packageJson.neoAnki?.uiEntries?.[ui.id] || `src/${ui.id}.ts`) })
  for (const entry of entries) if (!existsSync(entry.source)) throw new Error(`Extension source entry does not exist: ${entry.source}`)
  return { manifest, entries, packageJson }
}

const compile = async () => {
  const project = await readProject()
  const files = {}
  for (const entry of project.entries) {
    const result = await build({
      entryPoints: [entry.source], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', minify: false, sourcemap: false,
      plugins: [browserNodeShimPlugin],
      outfile: basename(entry.packagePath), write: false, logLevel: 'silent',
    })
    const module = result.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
    if (!module) throw new Error(`The extension compiler did not produce ${entry.packagePath}.`)
    files[entry.packagePath] = module
  }
  return { ...project, files }
}

const signPackage = async (compiled) => {
  const sourceCommit = process.env.NEO_ANKI_EXTENSION_SOURCE_COMMIT?.trim()
  const coreCommit = process.env.NEO_ANKI_EXTENSION_CORE_COMMIT?.trim()
  const provenance = { ...compiled.manifest.provenance, ...(sourceCommit ? { sourceCommit } : {}), ...(coreCommit ? { coreCommit } : {}) }
  const manifest = validateExtensionPackageManifest({ ...compiled.manifest, provenance })
  const configured = compiled.packageJson.neoAnki?.signingKey
  const environmentKey = process.env.NEO_ANKI_EXTENSION_SIGNING_KEY
  const keySource = environmentKey || (configured ? await readFile(resolve(cwd, configured), 'utf8') : '')
  if (!keySource) throw new Error('Extension packages require NEO_ANKI_EXTENSION_SIGNING_KEY or neoAnki.signingKey.')
  const privateKey = createPrivateKey(keySource)
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64')
  if (!environmentKey && publicKey !== manifest.publisherKey) throw new Error('Signing key does not match manifest.publisherKey.')
  const signedManifest = environmentKey ? { ...manifest, publisherKey: publicKey } : manifest
  const unsigned = createExtensionPackage(signedManifest, compiled.files)
  const unsignedDigest = createHash('sha256').update(unsigned).digest('hex')
  const signature = sign(null, Buffer.from(unsignedDigest, 'hex'), privateKey).toString('base64')
  return createExtensionPackage(signedManifest, { ...compiled.files, [EXTENSION_SIGNATURE_PATH]: `${JSON.stringify({ version: 1, algorithm: 'ed25519', publicKey, unsignedDigest, signature }, null, 2)}\n` })
}

const run = async () => {
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write('Usage: neo-anki-extension <check|build> [extension-directory]\n')
    return
  }
  if (!['check', 'build'].includes(command)) throw new Error(`Unknown command: ${command}`)
  const compiled = await compile()
  const files = { ...compiled.files }
  const readme = join(cwd, 'README.md')
  if (existsSync(readme)) files['README.md'] = await readFile(readme)
  const archive = await signPackage({ ...compiled, files })
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
