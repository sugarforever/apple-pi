export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Release automation derives the changelog from these types.
    "type-enum": [2, "always", ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "security", "style", "test"]],
    "header-max-length": [2, "always", 72],
    "subject-case": [2, "always", ["sentence-case", "lower-case", "start-case"]],
    "body-max-line-length": [0, "always"],
  },
};
