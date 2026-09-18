---
name: shared-name
description: User-scope half of a fixture name collision; Pi 0.84.2 keeps the first skill it finds for a given name and reports this one as the loser diagnostic.
---

# Shared Name (user scope)

Pairs with `../../../workspace/.pi/skills/shared-name-project/SKILL.md`, which
declares the same `name: shared-name` frontmatter field from a differently named
directory (Pi allows a skill's name to differ from its parent directory). Pi's
`DefaultResourceLoader` scans project-scope skills before user-scope skills, so the
project copy wins the collision and this user-scope copy is reported as the loser.
