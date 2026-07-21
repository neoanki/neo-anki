import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import process from 'node:process'
import console from 'node:console'

const root = process.cwd()
const failures = []
const markdownFiles = []

const collect = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (entry.name.endsWith('.md')) markdownFiles.push(path)
  }
}

await collect(join(root, 'docs'))
markdownFiles.push(join(root, 'README.md'), join(root, 'CONTRIBUTING.md'), join(root, 'SECURITY.md'), join(root, 'packages/extension-sdk/README.md'))

const packageFiles = [join(root, 'package.json')]
for (const directory of ['apps', 'packages', 'examples']) {
  const base = join(root, directory)
  for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) packageFiles.push(join(base, entry.name, 'package.json'))
  }
}
const scripts = new Set()
for (const path of packageFiles) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  Object.keys(value.scripts || {}).forEach((name) => scripts.add(name))
}

for (const file of markdownFiles) {
  const source = await readFile(file, 'utf8')
  const display = relative(root, file)
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '').split(/\s+['"]/)[0]
    if (!rawTarget || /^(?:https?:|mailto:|#)/i.test(rawTarget)) continue
    const decoded = decodeURIComponent(rawTarget.split('#')[0])
    const target = normalize(resolve(dirname(file), decoded))
    if (!target.startsWith(root)) {
      failures.push(`${display} links outside the repository: ${rawTarget}`)
      continue
    }
    await access(target).catch(() => failures.push(`${display} has a broken local link: ${rawTarget}`))
  }
  for (const match of source.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
    if (!scripts.has(match[1])) failures.push(`${display} documents missing npm script: ${match[1]}`)
  }
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
await access(join(root, `docs/releases/v${packageJson.version}.md`)).catch(() => failures.push(`Missing release note for package version ${packageJson.version}.`))

const acceptance = await readFile(join(root, 'docs/product-acceptance.md'), 'utf8')
for (const required of ['Contract tests', 'Packaged-core acceptance', 'Signed-extension acceptance', 'Distribution acceptance', 'headless']) {
  if (!acceptance.toLocaleLowerCase().includes(required.toLocaleLowerCase())) failures.push(`Product acceptance documentation is missing required concept: ${required}`)
}

if (failures.length) {
  console.error(`Documentation contract failed:\n- ${failures.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`Documentation contract verified across ${markdownFiles.length} Markdown files.`)
}
