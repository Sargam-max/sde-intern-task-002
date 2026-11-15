/**
 * Raised whenever the API changes in a way the web page depends on. The page compares it
 * with its own copy and warns when an old API process is still running.
 * (Not exported from index.ts: a Worker's main module may only export handlers.)
 */
export const API_VERSION = 3
