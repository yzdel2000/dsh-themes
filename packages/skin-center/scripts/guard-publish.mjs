// Publish guard for packages/skin-center.
//
// The package is published from the repository root (root package.json is the
// bundle manifest); this source directory is `private: true`. npm's dry-run
// does not always refuse private packages, so fail loudly before any upload.
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (pkg.private) {
  console.error(
    '[skin-center] packages/skin-center is not a publish source.\n' +
    'Publish from the repository root instead: npm publish',
  )
  process.exit(1)
}
