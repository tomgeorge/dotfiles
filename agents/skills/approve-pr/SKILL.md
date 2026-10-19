---
name: approve-pr
description: Approve a GitHub pull request with the user's signature rocket-frog image as the review body. Use whenever the user asks to approve, LGTM, ship, or stamp a PR (by URL, number, or the current branch's PR).
argument-hint: <pr-url-or-number>
---

# Approve PR

Approve the PR and attach the rocket-frog image as the approval comment.

## Steps

1. Resolve the PR. Accept a URL, `owner/repo#123`, a number (current repo), or
   nothing (PR for the current branch). Confirm it is open:

   ```bash
   gh pr view <pr> --json url,state,author,title --jq '{url,state,author:.author.login,title}'
   ```

   If it is closed/merged, or the author is the current user (`gh api user --jq .login`),
   stop and tell the user — GitHub rejects self-approval.

2. Approve with the image as the review body:

   ```bash
   gh pr review <pr> --approve --body '![rocket-frog](https://github.com/user-attachments/assets/eacbe96a-fe74-4b61-9fc8-a56a46f898fc)'
   ```

   If the user supplies extra text, put it on a line above the image.

3. Report the PR URL. Don't merge or do anything else.

## Notes

- The image is a GitHub `user-attachments` asset uploaded from a private repo,
  so it renders only for viewers with access to that context (fine for org
  repos; it may show as a broken link on public or external repos).
- A local copy lives at `rocket-frog.png` next to this file. If the link stops
  rendering, re-upload it by dragging it into any GitHub comment box and replace
  the URL above.
