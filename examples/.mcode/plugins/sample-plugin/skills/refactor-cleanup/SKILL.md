---
name: refactor-cleanup
description: Use when the user asks to "clean up", "refactor for readability", or "simplify" existing code. Provides specific guidelines for safe refactors.
---

When refactoring existing code, follow these rules:

1. **Never change behavior**. Run tests before and after — if no tests, write a smoke test first.
2. **One concern per commit**. Don't mix renames, restructuring, and bug fixes.
3. **Prefer subtraction**. Delete dead code, collapse duplicates, remove unused exports before adding abstractions.
4. **Names over comments**. If a comment explains *what* the code does, rename the function/variable instead.
5. **Limit scope**. Touch only files relevant to the request. No "drive-by" reformatting.

Workflow:
- Read the file(s) in question
- Identify the specific smell (long function, duplicated block, deep nesting, mystery name)
- Propose the smallest possible change
- Apply with edit_file
- Run tests / type-check / lint to verify nothing broke
