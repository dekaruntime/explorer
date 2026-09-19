// The coordinator, whose body lives in cqx-kit. This file exists so that the
// bundler has a URL to rewrite: `new URL('./analyse.worker.ts', import.meta.url)`
// is a literal resolved at build time, and no bundler can resolve one that
// lives inside a dependency.
import 'cqx-kit/workers/analyse';
