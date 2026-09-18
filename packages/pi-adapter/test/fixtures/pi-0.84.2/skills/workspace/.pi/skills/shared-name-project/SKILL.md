---
name: shared-name
description: Project-scope half of a fixture name collision; Pi 0.84.2 scans project skills before user skills, so this copy wins and the user-scope copy is reported as the loser diagnostic.
---

# Shared Name (project scope, directory name differs from the skill name)

Pairs with `../../../../agent/skills/shared-name/SKILL.md`. Both declare
`name: shared-name`, but this directory is named `shared-name-project` — Pi 0.84.2
does not require a skill's frontmatter `name` to match its parent directory (see
`docs/skills.md`), which this fixture exercises deliberately alongside the
collision itself.
