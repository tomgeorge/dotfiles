---
name: google-style
description: Apply Google's developer documentation style conventions (https://developers.google.com/style) when writing or editing docs, READMEs, API references, user guides, changelogs, or error messages. Also use when the user asks about writing style, tone, formatting, capitalization, inclusive language, or how to structure technical content.
---

# Google developer documentation style

Apply the conventions of Google's developer documentation style guide (https://developers.google.com/style). Project-specific guidelines win: for Chainguard docs, https://github.com/chainguard-dev/edu/wiki/Style-Guide. For sentence-level rules (active voice, concision, positive form), use the `writing-clearly-and-concisely` skill.

## Voice and tone
- Address the reader as "you", not "we".
- Use the active voice, so it's clear who acts.
- Be conversational but professional: no slang, and use common contractions ("you're", "don't", "it's").

## What to Avoid

- **Jargon and buzzwords**: "leverage," "utilize," "synergy"
- **Filler phrases**: "please note that," "it should be noted"
- **Exclamation marks**: Don't use them outside code samples and quoted strings
- **Implying simplicity**: "simply," "just," "easy" (frustrates struggling
  readers)
- **Latin abbreviations**: Write "for example" not "e.g.", "that is" not "i.e."
- **Directional language**: Use "earlier/later" not "above/below"
- **Anthropomorphic language**: Don't attribute human qualities to software
  ("the system wants," "the server thinks")
- **Skipping articles**: Always include "a," "an," and "the"—even in headings

## Inclusive Language

| Avoid               | Use Instead                            |
| ------------------- | -------------------------------------- |
| blacklist/whitelist | denylist/allowlist, blocklist/safelist |
| master/slave        | primary/replica, leader/follower       |
| man-hours           | person-hours                           |
| guys                | everyone, folks, team                  |
| sanity check        | quick check, coherence check           |

## Capitalization

- **Sentence case** for headings: Capitalize only the first word and proper
  nouns
- **Product names**: Always capitalize (Google Chrome, Kubernetes, Docker)
- **Acronyms**: Use standard capitalization (API, HTTP, JSON)

## Headings

- **Task headings**: Use imperative verbs ("Create an instance")
- **Concept headings**: Use noun phrases ("User authentication")
- **Hierarchy**: Don't skip levels (h1 to h3 without h2)
- **No links**: Avoid hyperlinks within headings

## Lists

**Numbered lists**: For sequential steps or ordered items.

**Bulleted lists**: For non-sequential items.

**List guidelines**:

- Introduce with a complete sentence followed by a colon
- Start each item with a capital letter
- Use parallel structure across items
- End with periods if items contain verbs or are complete sentences
- Don't use single-item lists

## Procedures

**Structure**:

1. Introduce with context
2. Number each step
3. Start steps with imperative verbs
4. State location before action

**Guidelines**:

- "In the Settings panel, click **Save**." (location before action)
- Mark optional steps with "Optional:" at the start
- Document one accessible procedure, not multiple alternatives
- Avoid "please" in instructions

## Code in Text

**Use code font** (backticks) for:

- Command-line input and output
- Filenames and paths
- Class, method, and function names
- Keywords, variables, and parameters
- HTTP status codes and methods

**Don't use code font** for:

- Product names and services
- URLs meant to be followed in a browser
- Domain names

**Grammar**: Don't inflect code elements. Write "send a `POST` request" not
"`POST` the data."

## Word Choices

| Avoid                   | Use Instead                       |
| ----------------------- | --------------------------------- |
| aka                     | also known as, or use parentheses |
| allows you to           | lets you                          |
| config                  | configuration                     |
| admin                   | administrator                     |
| click on                | click                             |
| check (checkbox)        | select                            |
| uncheck                 | clear                             |
| higher/lower (versions) | later/earlier                     |

## Formatting

- **UI elements**: Bold (**File > Save**)
- **User input**: Code font or bold, depending on context
- **New terms**: Italics on first use
- **Emphasis**: Use sparingly; prefer restructuring sentences

## Links

- Use descriptive link text that makes sense out of context
- Avoid "click here" or "this page"
- Good: "See the [authentication guide](...)."
- Bad: "Click [here](...) for more information."
