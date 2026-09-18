---
name: missing-description
---

# Missing Description

This fixture deliberately omits the required `description` frontmatter field. Per
Pi 0.84.2's skill validation (see `@earendil-works/pi-coding-agent`'s
`docs/skills.md`, "Validation" section), a missing description is the one violation
Pi does not merely warn about: the skill is dropped entirely rather than loaded, and
`loadSkillFromFile` reports a `{ type: "warning", message: "description is required" }`
diagnostic instead of a skill.
