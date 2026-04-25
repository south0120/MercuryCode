---
description: run the project's test suite and explain failures
argument-hint: [filter?]
---

Detect the project's test runner (npm test / pytest / cargo test / go test / etc.) by reading package.json or other manifest files, then run it (with optional filter $ARGUMENTS). If tests fail, explain each failure with the relevant file path and a one-line fix suggestion.
