export function isTestFile(filePath: string): boolean {
  return (
    /(^|\/)(tests?|__tests__|spec|e2e)\//i.test(filePath) ||
    /\.(test|spec)\.[a-z]+$/i.test(filePath) ||
    /(^|\/)(test_|conftest\.py)/i.test(filePath)
  );
}
