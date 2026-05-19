import picomatch from 'picomatch'

export function createPathGuard(allowedPaths) {
  // allowedPaths = array of relative file paths from SeedWorkspace.files keys
  const isAllowed = picomatch(allowedPaths, { dot: true, matchBase: false })
  return {
    isAllowed(relativePath) {
      return isAllowed(relativePath)
    },
    checkPatch(unifiedDiff) {
      // Extract all paths from diff headers (--- a/... and +++ b/...)
      // Return { allowed: string[], blocked: string[] }
      const paths = []
      for (const line of unifiedDiff.split('\n')) {
        if (line.startsWith('--- a/')) paths.push(line.slice(6).trim())
        if (line.startsWith('+++ b/')) paths.push(line.slice(6).trim())
      }
      const unique = [...new Set(paths.filter(p => p !== '/dev/null'))]
      const blocked = unique.filter(p => !isAllowed(p))
      return { allowed: unique.filter(p => isAllowed(p)), blocked }
    }
  }
}
