---
description: review the most recently changed file for bugs and style
argument-hint: [path?]
allowed-tools: read_file,grep,bash
---

You are reviewing code. If $ARGUMENTS is empty, run `git diff --name-only HEAD~1` to find the most recently changed file. Otherwise read $ARGUMENTS.

Then:
1. Read the file.
2. List 3-5 specific issues (bugs, style, edge cases) with line references.
3. Suggest concrete fixes.

Be terse. Use bullet points.
