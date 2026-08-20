// Stub for ESM-only @octokit/* packages
// These packages use ES module syntax which Jest/CommonJS cannot parse.
// This stub prevents parse errors when running NestJS integration tests
// that indirectly depend on octokit through GithubService.
module.exports = {};
