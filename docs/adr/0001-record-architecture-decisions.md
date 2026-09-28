# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

GigMap is built by one developer against a PRD that already disagrees with
the code in several places (see the README's "Divergences from the PRD").
The reasons for those choices lived in the README and in commit messages.
Neither is a good place to look up why something is the way it is.

## Decision

Keep Architecture Decision Records in `docs/adr/`, numbered, one decision per
file, in the format of [template.md](template.md). Code that encodes a
non-obvious decision links to its ADR in a comment.

## Consequences

- A decision that gets revisited is superseded by a new ADR, not rewritten,
  so the history of the reasoning survives.
- Writing one is a small cost per significant change. Most changes do not
  need one: a bug fix that restores intended behaviour is recorded in its
  commit message.
