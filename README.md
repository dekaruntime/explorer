# cqx-web

The web explorer for [cqx](https://github.com/samifouad/cqx): a CodeQuality Score
and a navigable map of a codebase, rendered from a cqx fact stream.

It is a separate repository because it is a separate artefact. cqx is a Rust
toolchain that produces facts; this reads them. Keeping the two apart means the
index stays useful with no UI at all, which is the point of the split.

## Status

A working mockup over real data, pending a design pass. Four zoom levels —
system, packages, files, symbols — with grid and graph views over the same facts,
and a scoring band where every deduction opens to the file and line that caused
it.

```
cqx extract /path/to/workspace --out facts.ndjson
```

The page currently embeds a snapshot; loading a stream at runtime is next.

## Licence

Apache-2.0.
