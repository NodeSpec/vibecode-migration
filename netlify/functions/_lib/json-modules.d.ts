// build-info.json is written by the `postbuild` script and is not committed, so describe its shape
// here. This lets the type check run before any build; once the file exists TypeScript uses it.
declare module '*/build-info.json' {
  const info: { branch: string; commitRef: string }
  export default info
}
