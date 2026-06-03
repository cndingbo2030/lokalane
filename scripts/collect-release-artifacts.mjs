import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = process.argv[2]
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const releaseDir = join(projectRoot, 'artifacts', 'releases')
const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const version = packageJson.version

await mkdir(releaseDir, { recursive: true })

if (target === 'android') {
  await copyIfExists(
    join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    join(releaseDir, `LokaLane-${version}-android-debug.apk`),
  )
} else if (target === 'mac') {
  await copyMatching(join(projectRoot, 'artifacts', 'electron'), ['.dmg', '.zip'])
} else {
  throw new Error('Usage: node scripts/collect-release-artifacts.mjs <android|mac>')
}

async function copyMatching(sourceDir, extensions) {
  const entries = await readdir(sourceDir)
  for (const entry of entries) {
    const source = join(sourceDir, entry)
    const metadata = await stat(source)
    if (metadata.isFile() && extensions.some((extension) => entry.endsWith(extension))) {
      await copyIfExists(source, join(releaseDir, basename(entry)))
    }
  }
}

async function copyIfExists(source, destination) {
  await copyFile(source, destination)
  console.log(`Copied ${source} -> ${destination}`)
}
